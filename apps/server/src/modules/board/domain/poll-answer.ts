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
