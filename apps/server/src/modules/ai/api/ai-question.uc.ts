import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	AiQuestionAnswer,
	AiQuestionElement,
	BoardNodeAuthorizableService,
	BoardNodeFactory,
	BoardNodeRule,
	BoardNodeService,
} from '@modules/board';
import { AuthorizationService } from '@modules/authorization';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { AI_CONFIG_TOKEN, AiConfig } from '../ai.config';
import { AiClientService } from '../ai-client.service';
import { AiQuestionConfigResponse, AiQuestionOwnAnswerResponse } from './dto/ai-question.response';

// The AI's persona: a friendly grader that gives exactly one short assessment - no chat,
// no follow-up questions, no repeating the student's text at length. The teacher's
// instructions and expected answer are injected as context; the response language follows
// the question.
const SYSTEM_PROMPT = [
	'Du bist ein prüfender Assistent und bewertest Antworten von Schülerinnen und Schülern sachlich und altersgerecht.',
	'Gib ausschließlich ein gültiges JSON-Objekt ohne Markdown aus:',
	'{"feedback":"kurze Rückmeldung","points":null,"flagged":false,"flagReason":null}.',
	'feedback enthält Urteil, kurze Begründung und bei Bedarf einen Tipp, höchstens 120 Wörter.',
	'Wenn eine Antwort vollständig am Thema vorbeigeht oder offensichtlich keinen ernsthaften Bezug zur Frage hat,',
	'setze flagged=true, erkläre dies kurz in flagReason und vergib bei aktivierter Punktebewertung 0 Punkte.',
	'Eine lediglich falsche oder unvollständige Antwort ist nicht automatisch themenfremd.',
].join(' ');

interface AiAssessment {
	feedback: string;
	points?: number;
	flagged: boolean;
	flagReason?: string;
}

const buildUserPrompt = (props: {
	question: string;
	aiInstructions?: string;
	expectedAnswer?: string;
	studentAnswer: string;
	gradeLevel?: number;
	subject?: string;
	maxPoints?: number;
}): string =>
	[
		`Frage: ${props.question}`,
		props.gradeLevel ? `Jahrgang: ${props.gradeLevel}. Passe Sprache und Anspruch daran an.` : undefined,
		props.subject ? `Fach: ${props.subject}` : undefined,
		props.aiInstructions ? `Hinweise der Lehrkraft an dich: ${props.aiInstructions}` : undefined,
		props.expectedAnswer ? `Erwartete Antwort (Bewertungsreferenz): ${props.expectedAnswer}` : undefined,
		props.maxPoints
			? `Punktebewertung ist aktiv. Vergib eine ganze Punktzahl von 0 bis ${props.maxPoints}.`
			: 'Punktebewertung ist nicht aktiv. Setze points auf null.',
		`Antwort des Schülers / der Schülerin: ${props.studentAnswer}`,
	]
		.filter((line): line is string => !!line)
		.join('\n');

const parseAssessment = (raw: string, maxPoints?: number): AiAssessment => {
	try {
		const start = raw.indexOf('{');
		const end = raw.lastIndexOf('}');
		const parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw) as Record<string, unknown>;
		if (typeof parsed.feedback !== 'string' || parsed.feedback.trim() === '') throw new Error('missing feedback');

		const flagged = parsed.flagged === true;
		const numericPoints =
			typeof parsed.points === 'number' && Number.isFinite(parsed.points) ? parsed.points : undefined;
		const points = !maxPoints
			? undefined
			: flagged
				? 0
				: numericPoints === undefined
					? undefined
					: Math.max(0, Math.min(maxPoints, Math.round(numericPoints)));

		return {
			feedback: parsed.feedback.trim(),
			points,
			flagged,
			flagReason: typeof parsed.flagReason === 'string' ? parsed.flagReason.trim() || undefined : undefined,
		};
	} catch {
		// Compatibility fallback for providers that ignore the requested JSON format.
		return { feedback: raw.trim(), flagged: false };
	}
};

@Injectable()
export class AiQuestionUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly boardNodeRule: BoardNodeRule,
		private readonly aiClientService: AiClientService,
		@Inject(AI_CONFIG_TOKEN) private readonly aiConfig: AiConfig
	) {}

	// Editor-only: the teacher's instructions and the expected answer. These fields are
	// deliberately withheld from the broadcast element response, so this endpoint is the
	// only way to read them back for the edit form.
	public async getConfig(userId: EntityId, elementId: EntityId): Promise<AiQuestionConfigResponse> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findByClassAndId(AiQuestionElement, elementId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('manageAiQuestion', user, boardNodeAuthorizable));

		return new AiQuestionConfigResponse({
			question: element.question,
			aiInstructions: element.aiInstructions ?? null,
			expectedAnswer: element.expectedAnswer ?? null,
			allowMultipleAttempts: element.allowMultipleAttempts,
		});
	}

	// Creates the caller's answer (first attempt) or replaces it (re-attempt, when the
	// element allows it). Answer and AI response are persisted together, AFTER the AI call
	// succeeded - a failing AI call leaves nothing behind, so the student can simply retry.
	public async submitAnswer(userId: EntityId, elementId: EntityId, answerText: string): Promise<AiQuestionAnswer> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findByClassAndId(AiQuestionElement, elementId, 1);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		const existing = element.getChildrenOfType(AiQuestionAnswer).find((candidate) => candidate.userId === userId);

		if (existing) {
			// Ownership is checked against the ANSWER's authorizable, not the element's:
			// updateOwnAiQuestionAnswer inspects the authorizable's boardNode itself, and only
			// the answer node can ever satisfy it (the element authorizable would 403 every
			// legitimate owner - the assignment module loads its submission node the same way).
			const answerAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(existing);
			throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnAiQuestionAnswer', user, answerAuthorizable));
			if (!element.allowMultipleAttempts) {
				// Conflict, not forbidden: the caller owns the answer and the data is safe -
				// a proxy timeout during the slow AI call can make the first POST appear failed
				// to the client (e.g. 408), so the retry must be able to distinguish "already
				// answered" (recover by GETting the answer) from a real permission problem.
				throw new ConflictException('This question has already been answered.');
			}
		} else {
			throwForbiddenIfFalse(this.boardNodeRule.can('createOwnAiQuestionAnswer', user, boardNodeAuthorizable));
		}

		const rawAssessment = await this.aiClientService.complete(
			SYSTEM_PROMPT,
			buildUserPrompt({
				question: element.question,
				aiInstructions: element.aiInstructions,
				expectedAnswer: element.expectedAnswer,
				studentAnswer: answerText,
				gradeLevel: element.gradeLevel,
				subject: element.subject,
				maxPoints: element.maxPoints,
			})
		);
		const assessment = parseAssessment(rawAssessment, element.maxPoints);

		const now = new Date();
		if (existing) {
			existing.answer = answerText;
			existing.aiResponse = assessment.feedback;
			existing.points = assessment.points;
			existing.maxPoints = element.maxPoints;
			existing.aiFlagged = assessment.flagged;
			existing.aiFlagReason = assessment.flagReason;
			existing.studentFlagged = false;
			existing.answeredAt = now;
			existing.attemptCount += 1;
			await this.boardNodeService.save(existing);

			return existing;
		}

		const answer = this.boardNodeFactory.buildAiQuestionAnswer(userId);
		answer.answer = answerText;
		answer.aiResponse = assessment.feedback;
		answer.points = assessment.points;
		answer.maxPoints = element.maxPoints;
		answer.aiFlagged = assessment.flagged;
		answer.aiFlagReason = assessment.flagReason;
		answer.studentFlagged = false;
		answer.answeredAt = now;
		answer.attemptCount = 1;
		await this.boardNodeService.addToParent(element, answer);

		return answer;
	}

	// The caller's own answer, or null when they have not answered yet. Ownership is
	// enforced by the rule, not just by the query - a forged id can never leak someone
	// else's answer.
	public async getOwnAnswer(userId: EntityId, elementId: EntityId): Promise<AiQuestionOwnAnswerResponse> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findByClassAndId(AiQuestionElement, elementId, 1);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		const existing = element.getChildrenOfType(AiQuestionAnswer).find((candidate) => candidate.userId === userId);
		if (existing) {
			// Ownership check against the answer's own authorizable - see submitAnswer.
			const answerAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(existing);
			throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnAiQuestionAnswer', user, answerAuthorizable));

			return new AiQuestionOwnAnswerResponse({ answer: this.mapToResponse(existing) });
		}

		// No answer yet - any board reader may see "their" (empty) answer.
		throwForbiddenIfFalse(this.boardNodeRule.can('createOwnAiQuestionAnswer', user, boardNodeAuthorizable));

		return new AiQuestionOwnAnswerResponse({ answer: null });
	}

	public async setOwnAnswerFlag(userId: EntityId, elementId: EntityId, flagged: boolean): Promise<AiQuestionAnswer> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findByClassAndId(AiQuestionElement, elementId, 1);
		const answer = element.getChildrenOfType(AiQuestionAnswer).find((candidate) => candidate.userId === userId);
		if (!answer) {
			throw new NotFoundException('No answer exists for this user.');
		}

		const answerAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(answer);
		throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnAiQuestionAnswer', user, answerAuthorizable));
		answer.studentFlagged = flagged;
		await this.boardNodeService.save(answer);

		return answer;
	}

	// Teacher overview: every answer given, with the student's name. Names come from the
	// board authorizable's user list (the same source the assignment list uses), so answer
	// nodes for users who have since left the room still render, just without a name.
	public async listAnswers(
		userId: EntityId,
		elementId: EntityId
	): Promise<{
		answers: {
			answer: AiQuestionAnswer;
			firstName?: string;
			lastName?: string;
		}[];
	}> {
		this.checkFeatureEnabled();

		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findByClassAndId(AiQuestionElement, elementId, 1);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('manageAiQuestion', user, boardNodeAuthorizable));

		const answers = element.getChildrenOfType(AiQuestionAnswer);

		return {
			answers: answers.map((answer) => {
				const person = boardNodeAuthorizable.users.find((candidate) => candidate.userId === answer.userId);

				return {
					answer,
					firstName: person?.firstName,
					lastName: person?.lastName,
				};
			}),
		};
	}

	private mapToResponse(answer: AiQuestionAnswer): {
		id: EntityId;
		userId: EntityId;
		answer: string;
		aiResponse: string;
		answeredAt: string;
		attemptCount: number;
		points: number | null;
		maxPoints: number | null;
		aiFlagged: boolean;
		aiFlagReason: string | null;
		studentFlagged: boolean;
	} {
		return {
			id: answer.id,
			userId: answer.userId,
			answer: answer.answer ?? '',
			aiResponse: answer.aiResponse ?? '',
			answeredAt: (answer.answeredAt ?? new Date(0)).toISOString(),
			attemptCount: answer.attemptCount,
			points: answer.points ?? null,
			maxPoints: answer.maxPoints ?? null,
			aiFlagged: answer.aiFlagged,
			aiFlagReason: answer.aiFlagReason ?? null,
			studentFlagged: answer.studentFlagged,
		};
	}

	private checkFeatureEnabled(): void {
		// flag-on-but-key-missing counts as disabled: a half-finished setup must not
		// accept answers it could never evaluate
		if (!this.aiConfig.isConfigured()) {
			throw new NotFoundException('AI features are not enabled.');
		}
	}
}
