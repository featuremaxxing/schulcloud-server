import type { CopyFileDto } from '@infra/files-storage-amqp-client/dto';
import { CopyContentParams, CopyContentParentType, H5pEditorProducer } from '@infra/h5p-editor-client';
import { ObjectId } from '@mikro-orm/mongodb';
import { BOARD_CONFIG_TOKEN, BoardConfig } from '@modules/board/board.config';
import { CopyElementType, CopyHelperService, CopyMapper, type CopyStatus, CopyStatusEnum } from '@modules/copy-helper';
import { ContextExternalToolService } from '@modules/tool/context-external-tool';
import {
	type ContextExternalTool,
	CopyContextExternalToolRejectData,
} from '@modules/tool/context-external-tool/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { EntityId } from '@shared/domain/types';
import {
	type AnyBoardNode,
	AiQuestionAnswer,
	AiQuestionElement,
	AssignmentElement,
	AssignmentFeedback,
	AssignmentSubmission,
	BoardNodeType,
	Card,
	CheckboxElement,
	CollaborativeTextEditorElement,
	Column,
	ColumnBoard,
	ContentElementType,
	DeletedElement,
	DrawingElement,
	ExternalToolElement,
	FileElement,
	FileElementFactory,
	FileFolderElement,
	FileFolderElementFactory,
	getBoardNodeType,
	H5pElement,
	handleNonExhaustiveSwitch,
	LinkElement,
	type MediaBoard,
	type MediaExternalToolElement,
	type MediaLine,
	type PinnedCard,
	PollElement,
	PollStatus,
	PollVote,
	RichTextElement,
	VideoConferenceElement,
} from '../../domain';

export interface CopyContext {
	targetSchoolId: EntityId;
	userId: EntityId;
	copyFilesOfParent(sourceParentId: EntityId, targetParentId: EntityId): Promise<CopyFileDto[]>;
}

@Injectable()
export class BoardNodeCopyService {
	constructor(
		@Inject(BOARD_CONFIG_TOKEN)
		private readonly config: BoardConfig,
		private readonly contextExternalToolService: ContextExternalToolService,
		private readonly copyHelperService: CopyHelperService,
		private readonly h5pEditorProducer: H5pEditorProducer
	) {}

	public async copy(boardNode: AnyBoardNode, context: CopyContext): Promise<CopyStatus> {
		const type = getBoardNodeType(boardNode);

		let result!: CopyStatus;

		switch (type) {
			case BoardNodeType.COLUMN_BOARD:
				result = await this.copyColumnBoard(boardNode as ColumnBoard, context);
				break;
			case BoardNodeType.COLUMN:
				result = await this.copyColumn(boardNode as Column, context);
				break;
			case BoardNodeType.CARD:
				result = await this.copyCard(boardNode as Card, context);
				break;
			case BoardNodeType.FILE_ELEMENT:
				result = await this.copyFileElement(boardNode as FileElement, context);
				break;
			case BoardNodeType.LINK_ELEMENT:
				result = await this.copyLinkElement(boardNode as LinkElement, context);
				break;
			case BoardNodeType.RICH_TEXT_ELEMENT:
				result = await this.copyRichTextElement(boardNode as RichTextElement, context);
				break;
			case BoardNodeType.DRAWING_ELEMENT:
				result = await this.copyDrawingElement(boardNode as DrawingElement, context);
				break;
			case BoardNodeType.EXTERNAL_TOOL:
				result = await this.copyExternalToolElement(boardNode as ExternalToolElement, context);
				break;
			case BoardNodeType.COLLABORATIVE_TEXT_EDITOR:
				result = await this.copyCollaborativeTextEditorElement(boardNode as CollaborativeTextEditorElement, context);
				break;
			case BoardNodeType.VIDEO_CONFERENCE_ELEMENT:
				result = await this.copyVideoConferenceElement(boardNode as VideoConferenceElement, context);
				break;
			case BoardNodeType.DELETED_ELEMENT:
				result = await this.copyDeletedElement(boardNode as DeletedElement, context);
				break;
			case BoardNodeType.MEDIA_BOARD:
				result = await this.copyMediaBoard(boardNode as MediaBoard, context);
				break;
			case BoardNodeType.MEDIA_LINE:
				result = await this.copyMediaLine(boardNode as MediaLine, context);
				break;
			case BoardNodeType.MEDIA_EXTERNAL_TOOL_ELEMENT:
				result = await this.copyMediaExternalToolElement(boardNode as MediaExternalToolElement, context);
				break;
			case BoardNodeType.FILE_FOLDER_ELEMENT:
				result = await this.copyFileFolderElement(boardNode as FileFolderElement, context);
				break;
			case BoardNodeType.H5P_ELEMENT:
				result = await this.copyH5pElement(boardNode as H5pElement, context);
				break;
			case BoardNodeType.POLL_ELEMENT:
				result = await this.copyPollElement(boardNode as PollElement, context);
				break;
			case BoardNodeType.CHECKBOX_ELEMENT:
				result = this.copyCheckboxElement(boardNode as CheckboxElement, context);
				break;
			case BoardNodeType.POLL_VOTE:
				result = this.copyPollVote(boardNode as PollVote);
				break;
			case BoardNodeType.ASSIGNMENT_ELEMENT:
				result = await this.copyAssignmentElement(boardNode as AssignmentElement, context);
				break;
			case BoardNodeType.ASSIGNMENT_SUBMISSION:
				result = this.copyAssignmentSubmission(boardNode as AssignmentSubmission);
				break;
			case BoardNodeType.ASSIGNMENT_FEEDBACK:
				result = this.copyAssignmentFeedback(boardNode as AssignmentFeedback);
				break;
			case BoardNodeType.AI_QUESTION_ELEMENT:
				result = await this.copyAiQuestionElement(boardNode as AiQuestionElement, context);
				break;
			case BoardNodeType.AI_QUESTION_ANSWER:
				result = this.copyAiQuestionAnswer(boardNode as AiQuestionAnswer);
				break;
			case BoardNodeType.PINNED_CARD:
				result = this.copyPinnedCard(boardNode as PinnedCard);
				break;
			default:
				/* istanbul ignore next */
				handleNonExhaustiveSwitch(type);
		}

		return result;
	}

	public async copyColumnBoard(original: ColumnBoard, context: CopyContext): Promise<CopyStatus> {
		const childrenResults = await this.copyChildrenOf(original, context);
		const childrenCopyStatus = this.copyHelperService.deriveStatusFromElements(childrenResults);

		const copy = new ColumnBoard({
			...original.getProps(),
			...this.buildSpecificProps(childrenResults),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.COLUMNBOARD,
			status: childrenCopyStatus,
			elements: childrenResults,
			originalEntity: original,
		};

		return result;
	}

	public async copyColumn(original: Column, context: CopyContext): Promise<CopyStatus> {
		const childrenResults = await this.copyChildrenOf(original, context);
		const childrenCopyStatus = this.copyHelperService.deriveStatusFromElements(childrenResults);

		const copy = new Column({
			...original.getProps(),
			...this.buildSpecificProps(childrenResults),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.COLUMN,
			status: childrenCopyStatus,
			elements: childrenResults,
			originalEntity: original,
		};

		return result;
	}

	public async copyCard(original: Card, context: CopyContext): Promise<CopyStatus> {
		const childrenResults = await this.copyChildrenOf(original, context);
		const childrenCopyStatus = this.copyHelperService.deriveStatusFromElements(childrenResults);

		const copy = new Card({
			...original.getProps(),
			...this.buildSpecificProps(childrenResults),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.CARD,
			status: childrenCopyStatus,
			elements: childrenResults,
			originalEntity: original,
		};

		return result;
	}

	public async copyFileElement(original: FileElement, context: CopyContext): Promise<CopyStatus> {
		const copy = FileElementFactory.build({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const fileCopyStatus = await this.copyFilesOfParent(original, context, copy);

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.FILE_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
			elements: fileCopyStatus,
		};

		return result;
	}

	public async copyFileFolderElement(original: FileFolderElement, context: CopyContext): Promise<CopyStatus> {
		const copy = FileFolderElementFactory.build({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const fileCopyStatus = await this.copyFilesOfParent(original, context, copy);

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.FILE_FOLDER_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
			elements: fileCopyStatus,
		};

		return result;
	}

	private async copyFilesOfParent(
		original: FileElement | LinkElement | FileFolderElement,
		context: CopyContext,
		copy: FileFolderElement | FileElement
	): Promise<CopyStatus[]> {
		const fileCopies = await context.copyFilesOfParent(original.id, copy.id);
		const copyStatus = CopyMapper.mapFileDtosToCopyStatus(fileCopies);

		return copyStatus;
	}

	public async copyLinkElement(original: LinkElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new LinkElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.LINK_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
			originalEntity: original,
		};

		if (original.imageUrl) {
			const fileCopy = await context.copyFilesOfParent(original.id, copy.id);

			fileCopy.forEach((copyFileDto) => {
				if (copyFileDto.id) {
					if (copy.imageUrl.includes(copyFileDto.sourceId)) {
						copy.imageUrl = copy.imageUrl.replace(copyFileDto.sourceId, copyFileDto.id);
					} else {
						copy.imageUrl = '';
					}
				}
			});

			const fileCopyStatus = fileCopy.map((copyFileDto) => {
				return {
					type: CopyElementType.FILE,
					status: copyFileDto.id ? CopyStatusEnum.SUCCESS : CopyStatusEnum.FAIL,
					title: copyFileDto.name ?? `(old fileid: ${copyFileDto.sourceId})`,
				};
			});
			result.elements = fileCopyStatus;
		}

		return Promise.resolve(result);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public copyRichTextElement(original: RichTextElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new RichTextElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.RICHTEXT_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
		};

		return Promise.resolve(result);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public copyDrawingElement(original: DrawingElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new DrawingElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.DRAWING_ELEMENT,
			status: CopyStatusEnum.PARTIAL,
		};

		return Promise.resolve(result);
	}

	public async copyExternalToolElement(original: ExternalToolElement, context: CopyContext): Promise<CopyStatus> {
		let copy: ExternalToolElement | DeletedElement;
		copy = new ExternalToolElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		if (!this.config.featureCtlToolsCopyEnabled || !original.contextExternalToolId) {
			const copyStatus: CopyStatus = {
				copyEntity: copy,
				type: CopyElementType.EXTERNAL_TOOL_ELEMENT,
				status: CopyStatusEnum.SUCCESS,
			};

			return Promise.resolve(copyStatus);
		}

		const linkedTool = await this.contextExternalToolService.findById(original.contextExternalToolId);
		if (!linkedTool) {
			const copyStatus: CopyStatus = {
				copyEntity: copy,
				type: CopyElementType.EXTERNAL_TOOL_ELEMENT,
				status: CopyStatusEnum.FAIL,
			};

			return copyStatus;
		}

		const contextToolCopyResult: ContextExternalTool | CopyContextExternalToolRejectData =
			await this.contextExternalToolService.copyContextExternalTool(linkedTool, copy.id, context.targetSchoolId);

		let copyStatus: CopyStatusEnum = CopyStatusEnum.SUCCESS;
		if (contextToolCopyResult instanceof CopyContextExternalToolRejectData) {
			copy = new DeletedElement({
				id: new ObjectId().toHexString(),
				path: copy.path,
				level: copy.level,
				position: copy.position,
				children: [],
				createdAt: new Date(),
				updatedAt: new Date(),
				deletedElementType: ContentElementType.EXTERNAL_TOOL,
				title: contextToolCopyResult.externalToolName,
			});

			copyStatus = CopyStatusEnum.FAIL;
		} else {
			copy.contextExternalToolId = contextToolCopyResult.id;
		}

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.EXTERNAL_TOOL_ELEMENT,
			status: copyStatus,
		};

		return Promise.resolve(result);
	}

	public copyCollaborativeTextEditorElement(
		original: CollaborativeTextEditorElement,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		context: CopyContext
	): Promise<CopyStatus> {
		const copy = new CollaborativeTextEditorElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.COLLABORATIVE_TEXT_EDITOR_ELEMENT,
			status: CopyStatusEnum.PARTIAL,
		};
		return Promise.resolve(result);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public copyVideoConferenceElement(original: VideoConferenceElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new VideoConferenceElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.VIDEO_CONFERENCE_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
		};

		return Promise.resolve(result);
	}

	public async copyMediaBoard(original: MediaBoard, context: CopyContext): Promise<CopyStatus> {
		const childrenResults = await this.copyChildrenOf(original, context);

		const result: CopyStatus = {
			type: CopyElementType.MEDIA_BOARD,
			status: CopyStatusEnum.NOT_DOING,
			elements: childrenResults,
		};

		return Promise.resolve(result);
	}

	public async copyMediaLine(original: MediaLine, context: CopyContext): Promise<CopyStatus> {
		const childrenResults = await this.copyChildrenOf(original, context);

		const result: CopyStatus = {
			type: CopyElementType.MEDIA_LINE,
			status: CopyStatusEnum.NOT_DOING,
			elements: childrenResults,
		};

		return Promise.resolve(result);
	}

	public copyMediaExternalToolElement(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		original: MediaExternalToolElement,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		context: CopyContext
	): Promise<CopyStatus> {
		const result: CopyStatus = {
			type: CopyElementType.MEDIA_EXTERNAL_TOOL_ELEMENT,
			status: CopyStatusEnum.NOT_DOING,
		};

		return Promise.resolve(result);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public copyDeletedElement(original: DeletedElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new DeletedElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.DELETED_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
		};

		return Promise.resolve(result);
	}

	public async copyH5pElement(original: H5pElement, context: CopyContext): Promise<CopyStatus> {
		if (!original.contentId) {
			const copy = new H5pElement({
				...original.getProps(),
				...this.buildSpecificProps([]),
			});

			const result: CopyStatus = {
				copyEntity: copy,
				type: CopyElementType.H5P_ELEMENT,
				status: CopyStatusEnum.SUCCESS,
				elements: [],
			};

			return result;
		}

		const copiedContentId = new ObjectId().toHexString();
		const copy = new H5pElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
			contentId: copiedContentId,
		});

		const copyParams: CopyContentParams = {
			copiedContentId: copiedContentId,
			sourceContentId: original.contentId,
			userId: context.userId,
			schoolId: context.targetSchoolId,
			parentType: CopyContentParentType.BoardElement,
			parentId: copy.id,
		};
		await this.h5pEditorProducer.copyContent(copyParams);

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.H5P_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
			elements: [],
		};

		return result;
	}

	// Deliberately does NOT call copyChildrenOf: a copied assignment is copied without its
	// submissions. Carrying student submissions (files, points, feedback) into a copied
	// room/board would leak personal data of students who never joined the copy's target
	// context - see copyAssignmentSubmission below for the matching NOT_DOING case.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public copyAssignmentElement(original: AssignmentElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new AssignmentElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.ASSIGNMENT_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
			elements: [],
		};

		return Promise.resolve(result);
	}

	// A submission never gets copied - see copyAssignmentElement. This case only exists so
	// the type switch in copy() stays exhaustive; it must never be reached in practice
	// because copyAssignmentElement skips its children.
	/**
	 * Pinned cards are personal pointers into someone's learning room. Copying one
	 * would carry a reference into a context its new owner may not be allowed to
	 * see, so it is never copied - same reasoning as assignment submissions.
	 */
	public copyPinnedCard(original: PinnedCard): CopyStatus {
		const result: CopyStatus = {
			id: original.id,
			type: CopyElementType.PINNED_CARD,
			status: CopyStatusEnum.NOT_DOING,
		};

		return result;
	}

	public copyAssignmentSubmission(original: AssignmentSubmission): CopyStatus {
		const result: CopyStatus = {
			id: original.id,
			type: CopyElementType.ASSIGNMENT_SUBMISSION,
			status: CopyStatusEnum.NOT_DOING,
		};

		return result;
	}

	// Deliberately does NOT call copyChildrenOf: an AI question is copied without its
	// answers. Carrying student answers (and the AI's judgements of them) into a copied
	// room/board would leak personal data of students who never joined the copy's target
	// context - same reasoning as copyAssignmentElement above.
	public copyAiQuestionElement(original: AiQuestionElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new AiQuestionElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
			creatorId: context.userId,
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.AI_QUESTION_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
			elements: [],
		};

		return Promise.resolve(result);
	}

	// An answer never gets copied - see copyAiQuestionElement. This case only exists so
	// the type switch in copy() stays exhaustive; it must never be reached in practice
	// because copyAiQuestionElement skips its children.
	public copyAiQuestionAnswer(original: AiQuestionAnswer): CopyStatus {
		const result: CopyStatus = {
			id: original.id,
			type: CopyElementType.AI_QUESTION_ANSWER,
			status: CopyStatusEnum.NOT_DOING,
		};

		return result;
	}

	// Same reasoning as copyAssignmentSubmission above - never reached, exists only to keep
	// the type switch in copy() exhaustive.
	public copyAssignmentFeedback(original: AssignmentFeedback): CopyStatus {
		const result: CopyStatus = {
			id: original.id,
			type: CopyElementType.ASSIGNMENT_FEEDBACK,
			status: CopyStatusEnum.NOT_DOING,
		};

		return result;
	}

	private async copyChildrenOf(boardNode: AnyBoardNode, context: CopyContext): Promise<CopyStatus[]> {
		const allSettled = await Promise.allSettled(
			boardNode.children.map(async (child) => {
				return {
					id: child.id,
					status: await this.copy(child, context),
				};
			})
		);

		const resultMap = new Map<EntityId, CopyStatus>();
		allSettled.forEach((res, index) => {
			if (res.status === 'fulfilled') {
				resultMap.set(res.value.id, res.value.status);
			} else {
				const child = boardNode.children[index];
				if (child) {
					resultMap.set(child.id, {
						copyEntity: undefined,
						type: CopyElementType.LEAF,
						status: CopyStatusEnum.FAIL,
					});
				}
			}
		});

		const results: CopyStatus[] = [];
		boardNode.children.forEach((child) => {
			const childStatus = resultMap.get(child.id);
			if (childStatus) {
				results.push(childStatus);
			}
		});

		return results;
	}

	// Deliberately does NOT call copyChildrenOf: a copied poll is copied without its votes
	// and without its frozen resultSnapshot - a copy starts as an empty, unopened poll.
	// Carrying votes into a copied room/board would leak identifiable participation of
	// users who never joined the copy's target context. pollStatus/closesAt are reset for
	// the same reason the comment promises ("an empty, unopened poll") - without this a copy
	// of a currently-open poll would immediately start accepting votes, and a copy of a
	// closed poll would be closed with no snapshot (aggregateResults would then fall back to
	// counting the copy's own, empty vote list instead), and a copied deadline could already
	// be in the past.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public copyPollElement(original: PollElement, context: CopyContext): Promise<CopyStatus> {
		const copy = new PollElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
			resultSnapshot: undefined,
			pollStatus: PollStatus.DRAFT,
			opensAt: undefined,
			closesAt: undefined,
		});

		const result: CopyStatus = {
			copyEntity: copy,
			type: CopyElementType.POLL_ELEMENT,
			status: CopyStatusEnum.SUCCESS,
			elements: [],
		};

		return Promise.resolve(result);
	}

	public copyCheckboxElement(original: CheckboxElement, context?: CopyContext): CopyStatus {
		const copy = new CheckboxElement({
			...original.getProps(),
			...this.buildSpecificProps([]),
			creatorId: context?.userId ?? original.creatorId,
			entries: [],
		});
		return { copyEntity: copy, type: CopyElementType.CHECKBOX_ELEMENT, status: CopyStatusEnum.SUCCESS, elements: [] };
	}

	// A vote never gets copied - see copyPollElement. This case only exists so the type
	// switch in copy() stays exhaustive; it must never be reached in practice because
	// copyPollElement skips its children.
	public copyPollVote(original: PollVote): CopyStatus {
		const result: CopyStatus = {
			id: original.id,
			type: CopyElementType.POLL_VOTE,
			status: CopyStatusEnum.NOT_DOING,
		};

		return result;
	}

	private buildSpecificProps(childrenResults: CopyStatus[]): {
		id: EntityId;
		createdAt: Date;
		updatedAt: Date;
		children: AnyBoardNode[];
	} {
		return {
			id: new ObjectId().toHexString(),
			createdAt: new Date(),
			updatedAt: new Date(),
			children: childrenResults.map((r) => r.copyEntity).filter((c) => c !== undefined) as AnyBoardNode[],
		};
	}
}
