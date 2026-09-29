import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { type CopyFileDto, FilesStorageClientAdapterService } from '@infra/files-storage-amqp-client';
import { BoardExternalReferenceType, BoardLayout, BoardNodeType } from '@modules/board';
import { BoardNodeEntity } from '@modules/board/repo/entity/board-node.entity';
import {
	cardEntityFactory,
	columnBoardEntityFactory,
	columnEntityFactory,
	fileAreaFolderEntityFactory,
} from '@modules/board/testing';
import { type CopyStatus } from '@modules/copy-helper';
import { GroupEntityTypes } from '@modules/group/entity/group.entity';
import { groupEntityFactory } from '@modules/group/testing';
import { roomMembershipEntityFactory } from '@modules/room-membership/testing';
import { ROOM_PUBLIC_API_CONFIG_TOKEN, type RoomPublicApiConfig } from '@modules/room/room.config';
import { RoomRolesTestFactory } from '@modules/room/testing/room-roles.test.factory';
import { schoolEntityFactory } from '@modules/school/testing';
import { ServerTestModule } from '@modules/server';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { cleanupCollections } from '@testing/cleanup-collections';
import { UserAndAccountTestFactory } from '@testing/factory/user-and-account.test.factory';
import { TestApiClient } from '@testing/test-api-client';
import { roomEntityFactory } from '../../testing/room-entity.factory';

// In a copied room, links from cards into a file area must point to the copied file area.
describe('POST /rooms/:roomId/copy with file area links', () => {
	let app: INestApplication;
	let em: EntityManager;
	let testApiClient: TestApiClient;
	const fileId = new ObjectId().toHexString();
	const copiedFileId = new ObjectId().toHexString();

	const filesStorage = {
		// the one file lives in the file area; every copy of its parent gets the known copy id
		copyFilesOfParent: jest.fn((params: { source: { parentId: string } }): Promise<CopyFileDto[]> => {
			const isFileArea = copiedParents.has(params.source.parentId);
			return Promise.resolve(isFileArea ? [{ id: copiedFileId, sourceId: fileId, name: 'aufgabe.pdf' }] : []);
		}),
		deleteFilesOfParent: jest.fn().mockResolvedValue([]),
	};
	const copiedParents = new Set<string>();

	beforeAll(async () => {
		const moduleFixture = await Test.createTestingModule({ imports: [ServerTestModule] })
			.overrideProvider(FilesStorageClientAdapterService)
			.useValue(filesStorage)
			.compile();

		app = moduleFixture.createNestApplication();
		await app.init();
		em = app.get(EntityManager);
		testApiClient = new TestApiClient(app, 'rooms');
		moduleFixture.get<RoomPublicApiConfig>(ROOM_PUBLIC_API_CONFIG_TOKEN).featureRoomCopyEnabled = true;
	});

	beforeEach(async () => {
		await cleanupCollections(em);
		copiedParents.clear();
	});

	afterAll(async () => {
		await app.close();
	});

	const setup = async () => {
		const school = schoolEntityFactory.buildWithId();
		const { teacherAccount, teacherUser } = UserAndAccountTestFactory.buildTeacher({ school });
		const room = roomEntityFactory.build({ name: 'Physik', schoolId: school.id });
		const { roomOwnerRole } = RoomRolesTestFactory.createRoomRoles();
		const userGroup = groupEntityFactory.buildWithId({
			type: GroupEntityTypes.ROOM,
			users: [{ role: roomOwnerRole, user: teacherUser }],
		});
		const roomMembership = roomMembershipEntityFactory.build({
			roomId: room.id,
			userGroupId: userGroup.id,
			schoolId: school.id,
		});

		const context = { id: room.id, type: BoardExternalReferenceType.Room };
		const fileArea = columnBoardEntityFactory.build({ title: 'Dateien', layout: BoardLayout.FILES, context });
		const folder = fileAreaFolderEntityFactory.withParent(fileArea).build({ title: 'Material' });
		const board = columnBoardEntityFactory.build({ title: 'Unterricht', context });
		const column = columnEntityFactory.withParent(board).build();
		const card = cardEntityFactory.withParent(column).build();
		const linkBase = { path: `${card.path}${card.id},`, level: card.level + 1, children: [], position: 0 };
		const folderLink = Object.assign(new BoardNodeEntity(), {
			...linkBase,
			id: new ObjectId().toHexString(),
			type: BoardNodeType.FILE_AREA_LINK_ELEMENT,
			title: 'Material',
			fileAreaId: fileArea.id,
			targetType: 'folder',
			targetId: folder.id,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const fileLink = Object.assign(new BoardNodeEntity(), {
			...linkBase,
			position: 1,
			id: new ObjectId().toHexString(),
			type: BoardNodeType.FILE_AREA_LINK_ELEMENT,
			title: 'aufgabe.pdf',
			fileAreaId: fileArea.id,
			targetType: 'file',
			targetId: fileId,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		copiedParents.add(folder.id);

		await em
			.persist([
				school,
				room,
				roomOwnerRole,
				teacherAccount,
				teacherUser,
				userGroup,
				roomMembership,
				fileArea,
				folder,
				board,
				column,
				card,
				folderLink,
				fileLink,
			])
			.flush();
		em.clear();

		const loggedInClient = await testApiClient.login(teacherAccount);

		return { loggedInClient, room, fileArea, folder, folderLink, fileLink };
	};

	it('should point copied links to the copied file area, folder and file', async () => {
		const { loggedInClient, room, fileArea, folder, folderLink, fileLink } = await setup();

		const response = await loggedInClient.post(`${room.id}/copy`);
		expect(response.status).toBe(HttpStatus.CREATED);
		const copiedRoomId = (response.body as CopyStatus).id as string;

		em.clear();
		const copiedNodes = await em.find(BoardNodeEntity, {
			id: { $nin: [fileArea.id, folder.id, folderLink.id, fileLink.id] },
		});
		const copiedFileArea = copiedNodes.find((node) => node.layout === BoardLayout.FILES);
		const copiedFolder = copiedNodes.find((node) => node.type === BoardNodeType.FILE_AREA_FOLDER);
		const copiedLinks = copiedNodes.filter((node) => node.type === BoardNodeType.FILE_AREA_LINK_ELEMENT);

		expect(copiedFileArea?.context?.id).toEqual(copiedRoomId);
		expect(copiedLinks).toHaveLength(2);
		const copiedFolderLink = copiedLinks.find((node) => node.targetType === 'folder');
		const copiedFileLink = copiedLinks.find((node) => node.targetType === 'file');
		expect(copiedFolderLink?.fileAreaId).toEqual(copiedFileArea?.id);
		expect(copiedFolderLink?.targetId).toEqual(copiedFolder?.id);
		expect(copiedFileLink?.fileAreaId).toEqual(copiedFileArea?.id);
		expect(copiedFileLink?.targetId).toEqual(copiedFileId);
	});
});
