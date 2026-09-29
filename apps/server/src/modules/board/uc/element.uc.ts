import { Logger } from '@infra/logger';
import { AuthorizationService } from '@modules/authorization';
import { BoardContextApiHelperService } from '@modules/board-context';
import { BadRequestException, Injectable } from '@nestjs/common';
import { throwForbiddenIfFalse } from '@shared/common/utils';
import { EntityId } from '@shared/domain/types';
import { BoardNodeRule } from '../authorisation/board-node.rule';
import { AnyElementContentBody, FileAreaLinkContentBody } from '../controller/dto';
import {
	AnyContentElement,
	BoardExternalReferenceType,
	BoardNodeFactory,
	ColumnBoard,
	ContentElementWithParentHierarchy,
	FileAreaFolder,
	FileAreaLinkElement,
	isAiQuestionElement,
	isFileAreaLinkElement,
} from '../domain';
import { BoardNodeAuthorizableService, BoardNodeService } from '../service';

@Injectable()
export class ElementUc {
	constructor(
		private readonly authorizationService: AuthorizationService,
		private readonly boardNodeAuthorizableService: BoardNodeAuthorizableService,
		private readonly boardNodeService: BoardNodeService,
		private readonly boardNodeFactory: BoardNodeFactory,
		private readonly boardContextApiHelperService: BoardContextApiHelperService,
		private readonly logger: Logger,
		private readonly boardNodeRule: BoardNodeRule
	) {
		this.logger.setContext(ElementUc.name);
	}

	public async getElementWithParentHierarchy(
		userId: EntityId,
		elementId: EntityId
	): Promise<ContentElementWithParentHierarchy> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findContentElementById(elementId);
		const boardNode = await this.boardNodeService.findRoot(element);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(boardNode);

		throwForbiddenIfFalse(this.boardNodeRule.can('viewElement', user, boardNodeAuthorizable));

		const parentHierarchy = await this.boardContextApiHelperService.getParentsOfElement(element.rootId);

		return { element, parentHierarchy };
	}

	public async updateElement(
		userId: EntityId,
		elementId: EntityId,
		content: AnyElementContentBody
	): Promise<AnyContentElement> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findContentElementById(elementId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('updateElement', user, boardNodeAuthorizable));

		if (isAiQuestionElement(element)) {
			const requestedRestriction = (content as { onlyCreatorCanEdit?: boolean }).onlyCreatorCanEdit;
			const changesRestriction =
				requestedRestriction !== undefined && requestedRestriction !== element.onlyCreatorCanEdit;
			throwForbiddenIfFalse(!changesRestriction || !element.creatorId || element.creatorId === userId);
			// Legacy elements predate creator tracking. The first teacher who updates one becomes
			// its creator and can subsequently enable the creator-only restriction.
			element.creatorId ??= userId;
		}

		if (isFileAreaLinkElement(element) && content instanceof FileAreaLinkContentBody) {
			await this.checkFileAreaLinkTarget(user, element, content);
		}

		// boardNodeAuthorizable.users is only used for polls (see
		// ContentElementUpdateService.updatePollElement) - already loaded above, so passing
		// it through here is free even for every other element type.
		await this.boardNodeService.updateContent(element, content, boardNodeAuthorizable.users);

		return element;
	}

	// The target must be a file area in the same room as the card, readable for the user. A linked
	// folder must belong to that file area and gives the link its name. Files are checked by the
	// file storage whenever they are read - its permission check follows the file area.
	private async checkFileAreaLinkTarget(
		user: Awaited<ReturnType<AuthorizationService['getUserWithPermissions']>>,
		element: FileAreaLinkElement,
		content: FileAreaLinkContentBody
	): Promise<void> {
		const board = await this.boardNodeService.findByClassAndId(ColumnBoard, element.rootId, 0);
		const fileArea = await this.boardNodeService.findByClassAndId(ColumnBoard, content.fileAreaId, 0);
		const isSameRoom =
			board.context.type === BoardExternalReferenceType.Room &&
			fileArea.context.type === BoardExternalReferenceType.Room &&
			fileArea.context.id === board.context.id;
		if (!fileArea.isFileArea() || !isSameRoom) {
			throw new BadRequestException('The target must be a file area in the same room');
		}

		const fileAreaAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(fileArea);
		throwForbiddenIfFalse(this.boardNodeRule.can('findBoard', user, fileAreaAuthorizable));

		if (content.targetType === 'folder') {
			const folder = await this.boardNodeService.findByClassAndId(FileAreaFolder, content.targetId, 0);
			if (folder.rootId !== fileArea.id) {
				throw new BadRequestException('The folder does not belong to this file area');
			}
			content.title = folder.title;
		}
	}

	public async deleteElement(userId: EntityId, elementId: EntityId): Promise<EntityId> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findContentElementById(elementId);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(element);

		throwForbiddenIfFalse(this.boardNodeRule.can('deleteElement', user, boardNodeAuthorizable));

		const { rootId } = element; // needs to be captured before deletion
		await this.boardNodeService.delete(element);

		return rootId;
	}

	public async checkElementReadPermission(userId: EntityId, elementId: EntityId): Promise<void> {
		const user = await this.authorizationService.getUserWithPermissions(userId);
		const element = await this.boardNodeService.findContentElementById(elementId);
		const boardNode = await this.boardNodeService.findRoot(element);
		const boardNodeAuthorizable = await this.boardNodeAuthorizableService.getBoardAuthorizable(boardNode);

		throwForbiddenIfFalse(this.boardNodeRule.can('viewElement', user, boardNodeAuthorizable));
	}
}
