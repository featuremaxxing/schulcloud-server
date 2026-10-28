# Feature „Dateibereich“

Stand, Funktionsweise, Grenzen und Gedanken zur Übernahme in die NBC. Stand: 28.10.2026.

## Stand der Branches

- **Auf main** (seit 29./30.09.2026):
  - WebDAV-Netzlaufwerk, Bereichstyp „Dateien“, Element „Datei-Bereich“, Verschieben ohne neue Datei-ID
  - schulcloud-server [#11](https://github.com/featuremaxxing/schulcloud-server/pull/11)–[#14](https://github.com/featuremaxxing/schulcloud-server/pull/14), nuxt-client [#20](https://github.com/featuremaxxing/nuxt-client/pull/20)–[#23](https://github.com/featuremaxxing/nuxt-client/pull/23), file-storage [#4](https://github.com/featuremaxxing/file-storage/pull/4)
- **Offen:**
  - ZIP-Download eines ganzen Bereichs und „Entpacken“, in nuxt-client [#24](https://github.com/featuremaxxing/nuxt-client/pull/24) und file-storage [#5](https://github.com/featuremaxxing/file-storage/pull/5)
  - Stand 28.10.: 28 Commits hinter main, braucht ein Rebase
- **Verworfen:**
  - Unterordner direkt in file-storage, in nuxt-client [#18](https://github.com/featuremaxxing/nuxt-client/pull/18) und file-storage [#3](https://github.com/featuremaxxing/file-storage/pull/3)
  - Ersetzt durch Ordner im Server

## So funktioniert es

- **Bereichstyp:** `layout: "files"`, Flag `FEATURE_BOARD_FILE_AREA_ENABLED`, nur in Räumen. Statt Spalten und Karten enthält ein Dateibereich beliebig tief verschachtelte Ordner (`FileAreaFolder`, Board-Knoten im Server, siehe `modules/board/domain/file-area-folder.do.ts`).
- **Dateien** liegen weiter in files-storage, ihr Eltern-Objekt ist der Ordner oder der Bereich.
  - Der Client lädt und schreibt sie direkt dort und meldet die Änderung danach dem Server (`FileAreaUc.notifyFilesChanged`).
  - Der Server verteilt sie live per Socket an alle offenen Ansichten.
- **Ansicht** wie im Finder: Spalten nebeneinander, rechts die Dateidetails.
- **Rechte** wie bei Bereichen: Wer bearbeiten darf, legt Ordner an und lädt hoch. Schüler:innen lesen.
- **Element „Datei-Bereich“** (`fileAreaLink`): verlinkt auf normalen Karten eine Datei oder einen Ordner des Raums.
  - Ein Ordner erscheint als Baum, bis Tiefe 3 und höchstens 50 Unterordner.
  - Ist er größer, erscheint ein Link.
- **Netzlaufwerk (WebDAV)** (`modules/board/webdav`):
  - Nur für Lehrkräfte, die Anmeldung läuft über ein App-Passwort.
  - Es zeigt Räume → Dateibereiche → Ordner.
  - Beim Verschieben behält die Datei ihre ID. Dafür ist der Move-Endpunkt in file-storage nötig.
- **Raum kopieren** kopiert Ordner und Dateien mit. Links auf Karten zeigen danach auf die Kopien.
- **Löschen** entfernt die Dateien in files-storage mit.

## Grenzen heute

- **Kontingent:** Es gibt kein Speicher-Kontingent pro Raum oder Schule.
- **Dateien eines Ordners:** Sie kommen alle in einer Abfrage, ohne Seitenaufteilung. Die files-storage-Doku sagt „defaults to 10“, ohne `limit` kommt aber alles.
- **Ordnerbaum:** Er wird bei jedem Öffnen komplett geladen. Hunderte Ordner gehen, Tausende würden spürbar langsam.
- **Fehlende Funktionen:** keine Suche, keine Versionen, kein Papierkorb im Dateibereich. Schüler:innen können nicht hochladen.
- **Netzlaufwerk:**
  - Sperren und macOS-Hilfsdateien (`._*`, `.DS_Store`) leben nur im Arbeitsspeicher eines Server-Prozesses.
  - Sperren werden nur zum Schein vergeben. Gleichzeitiges Bearbeiten über Web und Laufwerk ist nicht geschützt.
- **Löschen:** Es läuft im Hintergrund, ohne Wiederholung. Schlägt es fehl, bleiben die Dateien in S3 liegen.
- **Noch nicht geprüft:** wie sich Virenscan-Status und Collabora-Bearbeitung bei Dateien im Dateibereich verhalten.

## Was bei einer Übernahme in die NBC zu beachten wäre

1. **Produktfrage zuerst:** Die NBC hat schon das Element „Ordner“ auf Karten und die alten Kurs-Dateien. Ein dritter Ort für Dateien braucht eine klare Abgrenzung und eine Migrationsidee.
2. **Speicher und Kosten:**
   - Kontingente pro Schule oder Raum, Anzeige der Ordnergröße.
   - Raumkopien kopieren alle Dateien physisch. Bei Landesgröße gehört das in einen Hintergrundjob mit Fortschrittsanzeige.
3. **Mehrere Server-Instanzen:**
   - Der WebDAV-Zustand (Sperren, Hilfsdateien) muss in einen gemeinsamen Speicher, z. B. Redis oder Mongo.
   - Der Durchsatz der Live-Updates über die Mongo-Collection des Socket-Adapters muss unter Last geprüft werden.
4. **Seiten statt alles auf einmal:**
   - Dateien seitenweise laden.
   - Den Ordnerbaum nur für die geöffneten Ebenen laden.
   - Im Laufwerk die Pfade zwischenspeichern.
5. **Sicherheit und Datenschutz:**
   - App-Passwörter sind eine neue Art Zugangsdaten. Sie brauchen Rate-Limits, Ablauf, Widerruf durch Admins und ein Audit-Log.
   - Nötig sind ein Datenschutz- und ein Sicherheits-Review.
   - Der Betrieb muss Ingress/nginx für WebDAV-Methoden und große Uploads freischalten.
6. **Abhängigkeit file-storage:**
   - Der Move-Endpunkt (Datei behält ihre ID) ist eine Fork-Änderung und müsste zuerst upstream.
   - Für ZIP gilt dasselbe. Große ZIPs sollten im Hintergrund entstehen, nicht im Request.
7. **Aufräumen:** Ein Abgleich soll verwaiste Dateien finden, und das Löschen soll bei Fehlern wiederholt werden.
8. **Umfang:**
   - Etwa +7.000 Zeilen Server (davon etwa 3.800 WebDAV), +4.200 Zeilen Client und +180 Zeilen file-storage.
   - Der eigentliche Aufwand für die Übernahme sind das Review, die Feature-Flags, Tests mit echten Clients (Finder, Windows, iOS) und die Punkte 2 bis 7.
