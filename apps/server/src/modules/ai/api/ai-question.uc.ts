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
	'Du bist ein prüfender Assistent für Schülerinnen und Schüler.',
	'Bewerte die gegebene Antwort auf die gestellte Frage in genau einer kurzen Rückmeldung.',
	'Struktur der Rückmeldung: 1) Urteil (richtig / falsch / teilweise richtig),',
	'2) kurze Begründung, 3) ein Tipp, falls die Antwort nicht vollständig richtig war.',
	'Antworte in höchstens 120 Wörtern, auf Deutsch, in einfacher Schüler-Sprache.',
	'Erfinde keine zusätzlichen Fragen, starte keinen Dialog und bewerte nichts außer der gegebenen Antwort.',
].join(' ');

const buildUserPrompt = (props: {
	question: string;
	aiInstructions?: string;
	expectedAnswer?: string;
	studentAnswer: string;
}): string =>
	[
		`Frage: ${props.question}`,
		props.aiInstructions ? `Hinweise der Lehrkraft an dich: ${props.aiInstructions}` : undefined,
		props.expectedAnswer ? `Erwartete Antwort (Bewertungsreferenz): ${props.expectedAnswer}` : undefined,
		`Antwort des Schülers / der Schülerin: ${props.studentAnswer}`,
	]
		.filter((line): line is string => !!line)
		.join('\n');

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
			throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnAiQuestionAnswer', user, boardNodeAuthorizable));
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

		const aiResponse = await this.aiClientService.complete(
			SYSTEM_PROMPT,
			buildUserPrompt({
				question: element.question,
				aiInstructions: element.aiInstructions,
				expectedAnswer: element.expectedAnswer,
				studentAnswer: answerText,
			})
		);

		const now = new Date();
		if (existing) {
			existing.answer = answerText;
			existing.aiResponse = aiResponse;
			existing.answeredAt = now;
			existing.attemptCount += 1;
			await this.boardNodeService.save(existing);

			return existing;
		}

		const answer = this.boardNodeFactory.buildAiQuestionAnswer(userId);
		answer.answer = answerText;
		answer.aiResponse = aiResponse;
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
			throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnAiQuestionAnswer', user, boardNodeAuthorizable));

			return new AiQuestionOwnAnswerResponse({ answer: this.mapToResponse(existing) });
		}

		// No answer yet - any board reader may see "their" (empty) answer.
		throwForbiddenIfFalse(this.boardNodeRule.can('createOwnAiQuestionAnswer', user, boardNodeAuthorizable));

		return new AiQuestionOwnAnswerResponse({ answer: null });
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
	} {
		return {
			id: answer.id,
			userId: answer.userId,
			answer: answer.answer ?? '',
			aiResponse: answer.aiResponse ?? '',
			answeredAt: (answer.answeredAt ?? new Date(0)).toISOString(),
			attemptCount: answer.attemptCount,
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
