import { ObjectId } from '@mikro-orm/mongodb';
import { Injectable } from '@nestjs/common';
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
	VideoConferenceElement,
} from '../../domain';
import {
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
	PollStatus,
} from '../../domain';
import { BoardNodeRepo } from '../../repo';

@Injectable()
export class ContentElementUpdateService {
	constructor(private readonly boardNodeRepo: BoardNodeRepo) {}

	public async updateContent(element: AnyContentElement, content: AnyElementContentBody): Promise<void> {
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
			this.updatePollElement(element, content);
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
	// types, the anonymous/live-results switches, status and deadline - all through the
	// generic element update path, which is why voting itself needs its own (socket) path
	// instead of going through here.
	public updatePollElement(element: PollElement, content: PollContentBody): void {
		const wasClosed = element.pollStatus === PollStatus.CLOSED;

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

		const isClosingNow = !wasClosed && element.pollStatus === PollStatus.CLOSED;
		if (isClosingNow) {
			element.resultSnapshot = this.buildPollResultSnapshot(element);
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

	// Counts votes once at close time and freezes the numbers into the element - see
	// PollElement/PollResultSnapshot: the rendered result no longer depends on the
	// individual PollVote nodes afterwards. Anonymous, aggregated numbers only, never raw
	// voter identities - those are derived live from PollVote children by the results
	// endpoint for non-anonymous, still-open-in-the-UI polls, never stored here.
	private buildPollResultSnapshot(element: PollElement): PollResultSnapshot {
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

		return { frozenAt: new Date(), participantCount: votes.length, perQuestion };
	}
}
