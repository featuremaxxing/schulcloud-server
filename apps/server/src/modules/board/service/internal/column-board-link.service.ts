import { Injectable } from '@nestjs/common';
import { AnyBoardNode, isFileAreaLinkElement, isLearningPathStep, isLinkElement } from '../../domain';
import { BoardNodeRepo } from '../../repo/board-node.repo';

@Injectable()
export class ColumnBoardLinkService {
	constructor(private readonly boardNodeRepo: BoardNodeRepo) {}

	public async rewriteLinkUrlsInBoardNode(
		boardNode: AnyBoardNode,
		replacementMap?: Record<string, string>
	): Promise<AnyBoardNode> {
		this.updateLinkElements(boardNode, replacementMap ?? {});
		await this.boardNodeRepo.save(boardNode);
		return boardNode;
	}

	private updateLinkElements(boardNode: AnyBoardNode, replacementMap: Record<string, string>): void {
		if (isLinkElement(boardNode)) {
			for (const [searchValue, replaceValue] of Object.entries(replacementMap)) {
				boardNode.url = boardNode.url.replace(searchValue, replaceValue);
			}
		}
		if (isFileAreaLinkElement(boardNode) && boardNode.fileAreaId && boardNode.targetType && boardNode.targetId) {
			// a copied room gets its own file areas: point the link to the copy of its file area and target
			const fileAreaId = replacementMap[boardNode.fileAreaId];
			const targetId = replacementMap[boardNode.targetId];
			if (fileAreaId && targetId) {
				boardNode.setTarget({ fileAreaId, targetType: boardNode.targetType, targetId, title: boardNode.title });
			}
		}
		if (isLearningPathStep(boardNode)) {
			// a copied room gets its own boards: the copied learning path leads through them
			const linkedBoardId = replacementMap[boardNode.linkedBoardId];
			if (linkedBoardId) {
				boardNode.linkedBoardId = linkedBoardId;
			}
		}
		boardNode.children.forEach((bn) => this.updateLinkElements(bn, replacementMap));
	}
}
