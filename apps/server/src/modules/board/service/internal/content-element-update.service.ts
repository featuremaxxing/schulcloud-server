import { ObjectId } from '@mikro-orm/mongodb';
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sanitizeRichText } from '@shared/controller/transformer';
import { InputFormat } from '@shared/domain/types';
import {
	type AnyElementContentBody,
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
		// normalizePollAnswers), so removing/adding one or changing a question's answerMode once
		// votes exist would either orphan those answers or silently reinterpret them (e.g. a
		// SINGLE-turned-MULTIPLE question's old single answer now aggregated as if it always
		// allowed several). Editing the *text* of an existing question/option, or its chartType,
		// stays free - neither is referenced by a stored answer.
		if (hasVotes) {
			this.assertPollStructureUnchanged(element, content.questions);
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
		element.closesAt = content.closesAt ? new Date(content.closesAt) : undefined;
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

	// Rejects a question/option-structure change once the poll has votes - see updatePollElement.
	// A question or option without an id is a brand-new one (see the id ?? new ObjectId()
	// fallback below), which counts as "added" here exactly like an id that doesn't match an
	// existing one; conversely, an existing id missing from the new list counts as "removed".
	private assertPollStructureUnchanged(element: PollElement, questions: PollQuestionBody[]): void {
		const existingQuestionIds = new Set(element.questions.map((question) => question.id));
		const newQuestionIds = questions.map((question) => question.id);

		if (
			newQuestionIds.length !== existingQuestionIds.size ||
			newQuestionIds.some((id) => id === undefined || !existingQuestionIds.has(id))
		) {
			throw new ConflictException("Cannot add or remove a poll's questions once votes have been cast");
		}

		for (const questionBody of questions) {
			const existingQuestion = element.questions.find((question) => question.id === questionBody.id);
			/* istanbul ignore next - unreachable: every id here was just verified to exist above */
			if (!existingQuestion) continue;

			if (existingQuestion.answerMode !== questionBody.answerMode) {
				throw new ConflictException("Cannot change a poll question's answer mode once votes have been cast");
			}

			const existingOptionIds = new Set(existingQuestion.options.map((option) => option.id));
			const newOptionIds = questionBody.options.map((option) => option.id);

			if (
				newOptionIds.length !== existingOptionIds.size ||
				newOptionIds.some((id) => id === undefined || !existingOptionIds.has(id))
			) {
				throw new ConflictException("Cannot add or remove a poll question's options once votes have been cast");
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
}
