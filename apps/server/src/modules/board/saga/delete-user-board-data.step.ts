import { Logger } from '@infra/logger';
import {
	ModuleName,
	SagaService,
	SagaStep,
	StepOperationReport,
	StepOperationReportBuilder,
	StepOperationType,
	StepReport,
	StepReportBuilder,
	StepStatus,
	UserDeletionStepOperationLoggable,
} from '@modules/saga';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { BoardExternalReferenceType } from '../domain';
import { BoardCompletionRepo, LearningPathEnrollmentRepo } from '../repo';
import { BoardNodeService, MediaBoardService } from '../service';

@Injectable()
export class DeleteUserBoardDataStep extends SagaStep<'deleteUserData'> {
	private readonly moduleName = ModuleName.MEDIA_BOARD;

	constructor(
		private readonly sagaService: SagaService,
		private readonly boardNodeService: BoardNodeService,
		private readonly mediaBoardService: MediaBoardService,
		private readonly boardCompletionRepo: BoardCompletionRepo,
		private readonly learningPathEnrollmentRepo: LearningPathEnrollmentRepo,
		private readonly logger: Logger
	) {
		super('deleteUserData');
		this.logger.setContext(DeleteUserBoardDataStep.name);
		this.sagaService.registerStep(this.moduleName, this);
	}

	public async execute(params: { userId: EntityId }): Promise<StepReport> {
		const { userId } = params;

		const boardsDeleted = await this.deleteMediaBoardsOwnedByUser(userId);
		const completionsDeleted = await this.deleteBoardCompletionsOfUser(userId);
		// TODO: remove user references from boards

		const enrollmentsDeleted = await this.deleteLearningPathEnrollmentsOfUser(userId);

		const result = StepReportBuilder.build(this.moduleName, [boardsDeleted, completionsDeleted, enrollmentsDeleted]);

		return result;
	}

	// learning path completions are personal data of the user
	public async deleteBoardCompletionsOfUser(userId: EntityId): Promise<StepOperationReport> {
		const numberOfDeletedCompletions = await this.boardCompletionRepo.deleteByUserId(userId);

		return StepOperationReportBuilder.build(StepOperationType.DELETE, numberOfDeletedCompletions, []);
	}

	// so is the choice of the learning paths the user goes
	public async deleteLearningPathEnrollmentsOfUser(userId: EntityId): Promise<StepOperationReport> {
		const numberOfDeletedEnrollments = await this.learningPathEnrollmentRepo.deleteByUserId(userId);

		return StepOperationReportBuilder.build(StepOperationType.DELETE, numberOfDeletedEnrollments, []);
	}

	public async deleteMediaBoardsOwnedByUser(userId: EntityId): Promise<StepOperationReport> {
		this.logger.info(
			new UserDeletionStepOperationLoggable(
				'Deleting boards owned by user',
				this.moduleName,
				userId,
				StepStatus.PENDING
			)
		);

		const mediaBoards = await this.mediaBoardService.findByExternalReference({
			type: BoardExternalReferenceType.User,
			id: userId,
		});

		await Promise.all(
			mediaBoards.map(async (mb) => {
				await this.boardNodeService.delete(mb);
			})
		);

		const numberOfDeletedBoards = mediaBoards.length;
		const boardIds = mediaBoards.map((mb) => mb.id);

		const result = StepOperationReportBuilder.build(StepOperationType.DELETE, numberOfDeletedBoards, boardIds);

		this.logger.info(
			new UserDeletionStepOperationLoggable(
				'Successfully deleted boards owned by user',
				this.moduleName,
				userId,
				StepStatus.FINISHED,
				0,
				numberOfDeletedBoards
			)
		);

		return result;
	}
}
