import { AuthorizationService } from '@modules/authorization';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import {
	BoardNodeAuthorizable,
	BoardNodeFactory,
	countEligibleVoters,
	isPollElement,
	mergePollAnswers,
	normalizePollAnswers,
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
	// Whether the caller is eligible to vote at all, per the poll's own audience setting -
	// the client can't derive this from allowedOperations (that's board-wide, not per
	// element, see board-allowed-operations.composable.ts), so the server states it
	// explicitly. Reuses the same 'createOwnPollVote' check the vote() mutation itself
	// gates on, so this can never say yes when voting would actually be rejected.
	canVote: boolean;
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

		// Validated against the poll's actual questions/options before it is stored - see
		// normalizePollAnswers: the message params only bound sizes, not content, so a raw
		// payload could otherwise select every option of a single-choice question, answer the
		// same question twice, or reference an id that doesn't belong to this poll.
		const normalizedAnswers = normalizePollAnswers(element, answers);

		const existingVotes = await this.boardNodeService.findPollVotesByParentIds([elementId], userId);
		const existingVote = existingVotes[0];

		if (existingVote) {
			const authorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(existingVote);
			throwForbiddenIfFalse(this.boardNodeRule.can('updateOwnPollVote', user, authorizable));

			// Whether a *question* is still changeable is separate from the updateOwnPollVote
			// authorisation check above (ownership + continued audience eligibility): it depends
			// on the poll's allowVoteChange setting and, per question, whether it was already
			// answered - state the rule has no visibility into (see mergePollAnswers). Rejecting
			// is based on the *merged* outcome, not the raw payload: a payload that also answers a
			// newly-added question must still go through even if it additionally (and silently)
			// tries to change an old, locked answer - only a payload that changes nothing at all,
			// while clearly trying to (differs from what's stored), is treated as an error rather
			// than a no-op.
			const mergedAnswers = mergePollAnswers(element, existingVote.answers, normalizedAnswers);
			const triedButNothingChanged =
				this.answersMatchAll(existingVote.answers, mergedAnswers) &&
				!this.answersMatchAll(existingVote.answers, normalizedAnswers);
			if (!element.allowVoteChange && triedButNothingChanged) {
				throw new ForbiddenException('Answers can no longer be changed for this poll');
			}

			existingVote.answers = mergedAnswers;
			existingVote.votedAt = now;
			await this.boardNodeService.save(existingVote);
		} else {
			const elementAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);
			throwForbiddenIfFalse(this.boardNodeRule.can('createOwnPollVote', user, elementAuthorizable));

			const vote: PollVote = this.boardNodeFactory.buildPollVote(userId);
			vote.answers = normalizedAnswers;
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
			participantCount: this.getParticipantCount(element, authorizable),
			myVote,
			results,
			voters,
			canVote: this.boardNodeRule.can('createOwnPollVote', user, authorizable),
		};
	}

	// How many voters are actually eligible, not how many already voted (that's totalVotes) - the
	// status bar reads both together as "n of m voted". A closed poll reports the frozen count
	// from resultSnapshot instead of the room's current membership, so it stays correct even if
	// students later join or leave the room. Eligibility follows the poll's own audience
	// setting (isEligibleVoter/countEligibleVoters, see poll-audience.ts) - the same function
	// the authorisation rule uses to gate voting itself, so this count and the actual voting
	// gate can never drift apart.
	private getParticipantCount(element: PollElement, authorizable: BoardNodeAuthorizable): number {
		if (element.pollStatus === PollStatus.CLOSED && element.resultSnapshot) {
			return element.resultSnapshot.participantCount;
		}

		return countEligibleVoters(element, authorizable.users);
	}

	private async countVotes(elementId: EntityId): Promise<number> {
		const votes = await this.boardNodeService.findPollVotesByParentIds([elementId]);

		return votes.length;
	}

	// Whether two answer sets are equivalent question-by-question (order-independent). Used by
	// vote() to tell "nothing actually got written" from "something did" - see there.
	private answersMatchAll(a: PollAnswer[], b: PollAnswer[]): boolean {
		if (a.length !== b.length) {
			return false;
		}

		return a.every((answerA) => {
			const answerB = b.find((candidate) => candidate.questionId === answerA.questionId);
			return !!answerB && this.answersMatch(answerA, answerB);
		});
	}

	private answersMatch(a: PollAnswer, b: PollAnswer): boolean {
		const optionsA = [...a.selectedOptionIds].sort();
		const optionsB = [...b.selectedOptionIds].sort();
		const optionsMatch = optionsA.length === optionsB.length && optionsA.every((id, index) => id === optionsB[index]);

		return optionsMatch && (a.textAnswer ?? '') === (b.textAnswer ?? '');
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
