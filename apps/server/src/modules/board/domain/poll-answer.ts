import type { PollElement } from './poll-element.do';
import type { PollAnswer } from './types';
import { PollAnswerMode } from './types';

// Normalizes a vote's raw answers against the poll's actual questions/options before it is
// persisted. PollVoteMessageParams only bounds sizes (array lengths, string lengths), not
// content - without this, a single vote could inflate a single-choice question's counts by
// selecting every option at once, submit several answers for the same question (only the
// last of which the UI would ever show, but all of which aggregateResults would count), or
// reference an option/question id that no longer exists on the poll. One call, used by
// PollUc.vote for every vote (new or updated) before it reaches the board node - the read
// side (aggregateResults/buildPollResultSnapshot) can then trust the data it iterates.
export const normalizePollAnswers = (element: PollElement, rawAnswers: PollAnswer[]): PollAnswer[] => {
	const normalized: PollAnswer[] = [];

	for (const question of element.questions) {
		// first match wins - a second answer for the same question in the raw payload is
		// discarded rather than allowed to inflate a free-text question's answer count
		const answer = rawAnswers.find((candidate) => candidate.questionId === question.id);
		if (!answer) {
			continue;
		}

		if (question.answerMode === PollAnswerMode.TEXT) {
			normalized.push({ questionId: question.id, selectedOptionIds: [], textAnswer: answer.textAnswer });
			continue;
		}

		const validOptionIds = new Set(question.options.map((option) => option.id));
		const dedupedValidOptionIds = Array.from(new Set(answer.selectedOptionIds.filter((id) => validOptionIds.has(id))));

		const selectedOptionIds =
			question.answerMode === PollAnswerMode.SINGLE ? dedupedValidOptionIds.slice(0, 1) : dedupedValidOptionIds;

		normalized.push({ questionId: question.id, selectedOptionIds });
	}

	return normalized;
};

// Whether an answer actually holds a choice/text, as opposed to a placeholder entry for a
// question the voter hasn't gotten to yet. The client applies the same rule (see
// PollVoteForm.vue/PollContentElement.vue) so both sides agree on what counts as "answered".
export const isAnsweredPollQuestion = (answer?: PollAnswer): boolean =>
	!!answer && (answer.selectedOptionIds.length > 0 || !!answer.textAnswer?.trim());

// Merges an updated vote's (already-normalized) answers onto the existing, stored ones. When
// the poll allows changing an answer, the incoming answer always wins outright - today's
// behavior. Otherwise, a question that's already been answered keeps its stored answer no
// matter what the incoming payload says; only a question the voter hasn't answered yet -
// skipped originally, or added to the poll afterwards - takes the incoming answer. This is
// deliberately NOT part of the authorisation rule (updateOwnPollVote): whether a *question*
// is locked depends on its own answered/unanswered state, which the rule has no way to see -
// it only ever sees the vote node as a whole, the same reason isOpen(now) is checked in
// PollUc.vote rather than there.
export const mergePollAnswers = (
	element: PollElement,
	existing: PollAnswer[],
	incoming: PollAnswer[]
): PollAnswer[] => {
	if (element.allowVoteChange) {
		return incoming;
	}

	return element.questions.map((question): PollAnswer => {
		const existingAnswer = existing.find((answer) => answer.questionId === question.id);
		if (isAnsweredPollQuestion(existingAnswer)) {
			return existingAnswer as PollAnswer;
		}

		const incomingAnswer = incoming.find((answer) => answer.questionId === question.id);
		return incomingAnswer ?? { questionId: question.id, selectedOptionIds: [] };
	});
};
