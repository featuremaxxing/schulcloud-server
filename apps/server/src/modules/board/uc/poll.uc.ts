import { AuthorizationService } from '@modules/authorization';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import {
	BoardNodeFactory,
	isPollElement,
	PollAnswer,
	PollAnswerMode,
	PollElement,
	PollQuestionResult,
	PollStatus,
	PollVote,
} from '../domain';
import { BoardNodeAuthorizableService, BoardNodeService } from '../service';

export interface PollVoteResult {
	element: PollElement;
	totalVotes: number;
}

export interface PollResults {
	totalVotes: number;
	participantCount: number;
	myVote?: PollAnswer[];
	results?: PollQuestionResult[];
	voters?: { userId: EntityId; firstName?: string; lastName?: string; answers: PollAnswer[] }[];
}

@Injectable()
export class PollUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly boardNodeRule: BoardNodeRule
	) {}

	// Creates or updates the caller's own PollVote child of the poll element - one vote
	// node per participant, all questions answered in one go. This is the only board-node
	// mutation that happens outside the generic element-update path (see plan: voting needs
	// its own socket message type), because it targets a *child* node the caller does not
	// otherwise have write access to, and needs the isOpen(now)/deadline check.
	public async vote(userId: EntityId, elementId: EntityId, answers: PollAnswer[]): Promise<PollVoteResult> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.findPollElement(elementId);

		const now = new Date();
		if (!element.isOpen(now)) {
			throw new ForbiddenException('This poll is not open for votes');
		}

		const existingVotes = await this.boardNodeService.findPollVotesByParentIds([elementId], userId);
		const existingVote = existingVotes[0];

		if (existingVote) {
			const authorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(existingVote);
			throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnPollVote', user, authorizable));

			existingVote.answers = answers;
			existingVote.votedAt = now;
			await this.boardNodeService.save(existingVote);
		} else {
			const elementAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);
			throwForbiddenIfFalse(this.boardNodeRule.can('createOwnPollVote', user, elementAuthorizable));

			const vote: PollVote = this.boardNodeFactory.buildPollVote(userId);
			vote.answers = answers;
			vote.votedAt = now;

			await this.boardNodeService.addToParent(element, vote);
		}

		const totalVotes = await this.countVotes(elementId);

		return { element, totalVotes };
	}

	public async getResults(userId: EntityId, elementId: EntityId): Promise<PollResults> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.findPollElement(elementId);
		const authorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('viewPollResults', user, authorizable));

		const votes = await this.boardNodeService.findPollVotesByParentIds([elementId]);
		const myVote = votes.find((vote) => vote.userId === userId)?.answers;

		const isManager = this.boardNodeRule.can('managePoll', user, authorizable);
		const canSeeResults = isManager || element.showResultsLive || element.pollStatus === PollStatus.CLOSED;

		const results = canSeeResults ? this.aggregateResults(element, votes) : undefined;
		const voters =
			canSeeResults && isManager && !element.isAnonymous
				? votes.map((vote) => {
						const voterInfo = authorizable.users.find((user) => user.userId === vote.userId);

						return {
							userId: vote.userId,
							firstName: voterInfo?.firstName,
							lastName: voterInfo?.lastName,
							answers: vote.answers,
						};
					})
				: undefined;

		return {
			totalVotes: votes.length,
			participantCount: votes.length,
			myVote,
			results,
			voters,
		};
	}

	private async countVotes(elementId: EntityId): Promise<number> {
		const votes = await this.boardNodeService.findPollVotesByParentIds([elementId]);

		return votes.length;
	}

	// A closed poll always reports its frozen resultSnapshot (numbers no longer depend on
	// the live votes at all, see PollElement/ContentElementUpdateService). Otherwise the
	// numbers are aggregated live from the current PollVote children.
	private aggregateResults(element: PollElement, votes: PollVote[]): PollQuestionResult[] {
		if (element.pollStatus === PollStatus.CLOSED && element.resultSnapshot) {
			return element.resultSnapshot.perQuestion;
		}

		return element.questions.map((question) => {
			const counts = question.options.map((option) => {
				return {
					optionId: option.id,
					count: votes.filter((vote) =>
						vote.answers.some(
							(answer) => answer.questionId === question.id && answer.selectedOptionIds.includes(option.id)
						)
					).length,
				};
			});

			const textAnswers =
				question.answerMode === PollAnswerMode.TEXT
					? votes
							.flatMap((vote) => vote.answers.filter((answer) => answer.questionId === question.id))
							.map((answer) => answer.textAnswer)
							.filter((textAnswer): textAnswer is string => !!textAnswer)
					: undefined;

			return { questionId: question.id, counts, textAnswers };
		});
	}

	private async findPollElement(elementId: EntityId): Promise<PollElement> {
		const element = await this.boardNodeService.findContentElementById(elementId, 0);

		if (!isPollElement(element)) {
			throw new NotFoundException('There is no poll element with this id');
		}

		return element;
	}
}
