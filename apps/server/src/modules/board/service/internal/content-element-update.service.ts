import { ObjectId } from '@mikro-orm/mongodb';
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sanitizeRichText } from '@shared/controller/transformer';
import { InputFormat } from '@shared/domain/types';
import {
	type AnyElementContentBody,
	AssignmentContentBody,
	AiQuestionContentBody,
	DrawingContentBody,
	ExternalToolContentBody,
	FileContentBody,
	FileFolderContentBody,
	H5pContentBody,
	LinkContentBody,
	PollContentBody,
	type PollQuestionBody,
	RichTextContentBody,
	VideoConferenceContentBody,
} from '../../controller/dto';
import type {
	AssignmentElement,
	AiQuestionElement,
	AnyContentElement,
	DrawingElement,
	ExternalToolElement,
	FileElement,
	FileFolderElement,
	LinkElement,
	PollElement,
	PollQuestion,
	PollQuestionResult,
	PollResultSnapshot,
	RichTextElement,
	UserWithBoardRoles,
	VideoConferenceElement,
} from '../../domain';
import {
	countEligibleVoters,
	H5pElement,
	isAssignmentElement,
	isAiQuestionElement,
	isDrawingElement,
	isExternalToolElement,
	isFileElement,
	isFileFolderElement,
	isH5pElement,
	isLinkElement,
	isPollElement,
	isPollVote,
	isRichTextElement,
	isVideoConferenceElement,
	PollAnswerMode,
	PollAudience,
	PollStatus,
} from '../../domain';
import { BoardNodeRepo } from '../../repo';

@Injectable()
export class ContentElementUpdateService {
	constructor(private readonly boardNodeRepo: BoardNodeRepo) {}

	// authorizableUsers is only meaningful for a poll (see updatePollElement) - the room's
	// current membership, needed to both enforce U-R4 (audience is locked once votes exist)
	// and to freeze the right participantCount into the result snapshot if this update
	// closes the poll (see U-R3/U1: it must be "eligible voters", not "votes cast").
	public async updateContent(
		element: AnyContentElement,
		content: AnyElementContentBody,
		authorizableUsers?: UserWithBoardRoles[]
	): Promise<void> {
		// TODO refactor if ... else to e.g. discriminated union or non-exhaustive check
		if (isFileElement(element) && content instanceof FileContentBody) {
			this.updateFileElement(element, content);
		} else if (isLinkElement(element) && content instanceof LinkContentBody) {
			this.updateLinkElement(element, content);
		} else if (isRichTextElement(element) && content instanceof RichTextContentBody) {
			this.updateRichTextElement(element, content);
		} else if (isDrawingElement(element) && content instanceof DrawingContentBody) {
			this.updateDrawingElement(element, content);
		} else if (isExternalToolElement(element) && content instanceof ExternalToolContentBody) {
			this.updateExternalToolElement(element, content);
		} else if (isVideoConferenceElement(element) && content instanceof VideoConferenceContentBody) {
			this.updateVideoConferenceElement(element, content);
		} else if (isFileFolderElement(element) && content instanceof FileFolderContentBody) {
			this.updateFileFolderElement(element, content);
		} else if (isH5pElement(element) && content instanceof H5pContentBody) {
			this.updateH5pElement(element, content);
		} else if (isPollElement(element) && content instanceof PollContentBody) {
			this.updatePollElement(element, content, authorizableUsers ?? []);
		} else if (isAssignmentElement(element) && content instanceof AssignmentContentBody) {
			this.updateAssignmentElement(element, content);
		} else if (isAiQuestionElement(element) && content instanceof AiQuestionContentBody) {
			this.updateAiQuestionElement(element, content);
		} else {
			throw new Error(`Cannot update element of type: '${element.constructor.name}'`);
		}

		await this.boardNodeRepo.save(element);
	}

	public updateFileElement(element: FileElement, content: FileContentBody): void {
		element.caption = sanitizeRichText(content.caption, InputFormat.PLAIN_TEXT);
		element.alternativeText = sanitizeRichText(content.alternativeText, InputFormat.PLAIN_TEXT);
	}

	public updateLinkElement(element: LinkElement, content: LinkContentBody): void {
		element.url = new URL(content.url).toString();
		element.title = content.title ?? '';
		element.description = content.description ?? '';
		if (content.imageUrl) {
			const isRelativeUrl = (url: string): boolean => {
				const fallbackHostname = 'https://www.fallback-url-if-url-is-relative.org';
				const imageUrlObject = new URL(url, fallbackHostname);
				return imageUrlObject.origin === fallbackHostname;
			};

			if (isRelativeUrl(content.imageUrl)) {
				element.imageUrl = content.imageUrl;
			}
		} else {
			element.imageUrl = '';
		}
	}

	public updateRichTextElement(element: RichTextElement, content: RichTextContentBody): void {
		element.text = sanitizeRichText(content.text, content.inputFormat);
		element.inputFormat = content.inputFormat;
	}

	public updateDrawingElement(element: DrawingElement, content: DrawingContentBody): void {
		element.description = content.description;
	}

	public updateExternalToolElement(element: ExternalToolElement, content: ExternalToolContentBody): void {
		if (content.contextExternalToolId !== undefined && element.contextExternalToolId === undefined) {
			// Updates should not remove an existing reference to a tool, to prevent orphan tool instances
			element.contextExternalToolId = content.contextExternalToolId;
		}
	}

	public updateVideoConferenceElement(element: VideoConferenceElement, content: VideoConferenceContentBody): void {
		element.title = content.title;
	}

	public updateFileFolderElement(element: FileFolderElement, content: FileFolderContentBody): void {
		element.title = content.title;
	}

	public updateH5pElement(element: H5pElement, content: H5pContentBody): void {
		if (content.contentId !== undefined && element.contentId === undefined) {
			element.contentId = content.contentId;
		}
	}

	// Covers everything a teacher can change on a poll: questions/options/answer & chart
	// types, the anonymous/live-results switches, target audience, status and deadline - all
	// through the generic element update path, which is why voting itself needs its own
	// (socket) path instead of going through here.
	public updatePollElement(
		element: PollElement,
		content: PollContentBody,
		authorizableUsers: UserWithBoardRoles[]
	): void {
		const wasClosed = element.pollStatus === PollStatus.CLOSED;

		// U-R4: once a poll has votes, changing who is eligible to vote would silently
		// invalidate/orphan them relative to the audience they were cast under (a "3 of 5"
		// quota that no longer matches who actually could have voted). Locked here, not just
		// in the client, so a stale form or a direct API call can't get around it.
		const newAudience = content.audience ?? PollAudience.STUDENTS;
		const hasVotes = element.children.some(isPollVote);
		if (hasVotes && newAudience !== element.audience) {
			throw new ConflictException("Cannot change a poll's audience once votes have been cast");
		}

		// Same reasoning as the audience lock above, for the questions/options themselves: an
		// existing PollVote's answers reference question/option ids directly (see
		// normalizePollAnswers), so removing an existing one or changing a question's answerMode
		// once votes exist would either orphan those answers or silently reinterpret them (e.g. a
		// SINGLE-turned-MULTIPLE question's old single answer now aggregated as if it always
		// allowed several). Editing the *text* of an existing question/option, or its chartType,
		// stays free - neither is referenced by a stored answer. Appending a brand-new question or
		// option is free too, even with votes already cast: nothing existing is renumbered or
		// reinterpreted, and PollUc.vote's mergePollAnswers lets a voter fill in exactly such a
		// newly-added question without touching their earlier, locked-in answers.
		if (hasVotes) {
			this.assertPollStructureOnlyGrew(element, content.questions);
		}

		element.title = content.title ? sanitizeRichText(content.title, InputFormat.PLAIN_TEXT) : undefined;
		element.questions = content.questions.map((question): PollQuestion => {
			return {
				id: question.id ?? new ObjectId().toHexString(),
				text: sanitizeRichText(question.text, InputFormat.PLAIN_TEXT),
				answerMode: question.answerMode,
				chartType: question.chartType,
				options: question.options.map((option) => {
					return {
						id: option.id ?? new ObjectId().toHexString(),
						text: sanitizeRichText(option.text, InputFormat.PLAIN_TEXT),
					};
				}),
			};
		});
		element.isAnonymous = content.isAnonymous;
		element.showResultsLive = content.showResultsLive;
		element.pollStatus = content.pollStatus;
		element.allowVoteChange = content.allowVoteChange ?? false;

		const opensAt = content.opensAt ? new Date(content.opensAt) : undefined;
		const closesAt = content.closesAt ? new Date(content.closesAt) : undefined;
		// Otherwise the poll would never actually be open, with no error anywhere telling the
		// teacher why - the same "silent 0 of 0" concern as the empty-CUSTOM-audience check below.
		if (opensAt && closesAt && opensAt.getTime() >= closesAt.getTime()) {
			throw new UnprocessableEntityException('A poll must open before it closes.');
		}
		element.opensAt = opensAt;
		element.closesAt = closesAt;
		// A CUSTOM audience with no roles selected would open (isEligibleVoter checks
		// `(element.audienceRoles ?? []).some(...)`, which is always false for an empty array)
		// but accept no one's vote at all - saved successfully, with no error anywhere telling
		// the teacher why nobody can vote. Caught here rather than left to be discovered as a
		// silent, unexplained "0 of 0 voted".
		if (newAudience === PollAudience.CUSTOM && (content.audienceRoles ?? []).length === 0) {
			throw new UnprocessableEntityException('At least one role must be selected for a custom poll audience.');
		}

		element.audience = newAudience;
		element.audienceRoles = newAudience === PollAudience.CUSTOM ? content.audienceRoles : undefined;

		const isClosingNow = !wasClosed && element.pollStatus === PollStatus.CLOSED;
		if (isClosingNow) {
			const participantCount = countEligibleVoters(element, authorizableUsers);
			element.resultSnapshot = this.buildPollResultSnapshot(element, participantCount);
		}

		// The snapshot is embedded straight into the element's content, which every board client
		// receives regardless of showResultsLive/permission (see PollElementResponseMapper) - a
		// closed poll's numbers are meant to be public once closed, but reopening it must not leave
		// last round's counts and free-text answers sitting in students' clients until they happen
		// to vote or a live update overwrites it. Cleared unconditionally on any reopen (not just
		// wasClosed -> now OPEN in one step) so a snapshot left over from further back can't linger
		// through an intermediate DRAFT either.
		const isReopeningNow = wasClosed && element.pollStatus !== PollStatus.CLOSED;
		if (isReopeningNow) {
			element.resultSnapshot = undefined;
		}
	}

	// Rejects removing an existing question/option, or changing an existing question's answer
	// mode, once the poll has votes - see updatePollElement. Appending brand-new ones is fine.
	// A question or option without an id is a brand-new one (see the id ?? new ObjectId()
	// fallback below); conversely, an existing id missing from the new list counts as "removed".
	private assertPollStructureOnlyGrew(element: PollElement, questions: PollQuestionBody[]): void {
		const existingQuestionIds = new Set(element.questions.map((question) => question.id));
		const newQuestionIds = new Set(questions.map((question) => question.id).filter((id): id is string => !!id));

		if ([...existingQuestionIds].some((id) => !newQuestionIds.has(id))) {
			throw new ConflictException("Cannot remove a poll's questions once votes have been cast");
		}

		for (const existingQuestion of element.questions) {
			const questionBody = questions.find((question) => question.id === existingQuestion.id);
			/* istanbul ignore next - unreachable: every id here was just verified to exist above */
			if (!questionBody) continue;

			if (existingQuestion.answerMode !== questionBody.answerMode) {
				throw new ConflictException("Cannot change a poll question's answer mode once votes have been cast");
			}

			const existingOptionIds = new Set(existingQuestion.options.map((option) => option.id));
			const newOptionIds = new Set(questionBody.options.map((option) => option.id).filter((id): id is string => !!id));

			if ([...existingOptionIds].some((id) => !newOptionIds.has(id))) {
				throw new ConflictException("Cannot remove a poll question's options once votes have been cast");
			}
		}
	}

	// Counts votes once at close time and freezes the numbers into the element - see
	// PollElement/PollResultSnapshot: the rendered result no longer depends on the
	// individual PollVote nodes afterwards. Anonymous, aggregated numbers only, never raw
	// voter identities - those are derived live from PollVote children by the results
	// endpoint for non-anonymous, still-open-in-the-UI polls, never stored here.
	private buildPollResultSnapshot(element: PollElement, participantCount: number): PollResultSnapshot {
		const votes = element.children.filter(isPollVote);

		const perQuestion: PollQuestionResult[] = element.questions.map((question) => {
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

		return { frozenAt: new Date(), participantCount, perQuestion };
	}

	public updateAssignmentElement(element: AssignmentElement, content: AssignmentContentBody): void {
		element.title = sanitizeRichText(content.title, InputFormat.PLAIN_TEXT);
		element.text = sanitizeRichText(content.text, content.inputFormat);
		element.inputFormat = content.inputFormat;
		element.startDate = content.startDate ? new Date(content.startDate) : undefined;
		element.dueDate = content.dueDate ? new Date(content.dueDate) : undefined;
		element.graceMinutes = content.graceMinutes;
		// when criteria are set, the client already computed maxPoints as their sum - the
		// element stays dumb and just stores whatever it is sent, see AssignmentUc for the
		// per-criterion grading logic that actually depends on this
		element.maxPoints = content.maxPoints;
		element.criteria = content.criteria;
	}

	// The broadcast element content (and therefore every autosave PATCH) carries only
	// question/allowMultipleAttempts - the private aiInstructions/expectedAnswer are
	// served to editors through the AI module's config endpoint instead. Absent fields
	// therefore mean "unchanged" (otherwise every keystroke on the question would wipe
	// the teacher's instructions); an empty string clears the field.
	public updateAiQuestionElement(element: AiQuestionElement, content: AiQuestionContentBody): void {
		element.question = sanitizeRichText(content.question, InputFormat.PLAIN_TEXT);
		if (content.aiInstructions !== undefined) {
			element.aiInstructions = content.aiInstructions
				? sanitizeRichText(content.aiInstructions, InputFormat.PLAIN_TEXT)
				: undefined;
		}
		if (content.expectedAnswer !== undefined) {
			element.expectedAnswer = content.expectedAnswer
				? sanitizeRichText(content.expectedAnswer, InputFormat.PLAIN_TEXT)
				: undefined;
		}
		element.allowMultipleAttempts = content.allowMultipleAttempts ?? false;
	}
}
