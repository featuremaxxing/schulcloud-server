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
import { AppPasswordService } from '../../domain';

@Injectable()
export class DeleteUserAppPasswordDataStep extends SagaStep<'deleteUserData'> {
	private readonly moduleName = ModuleName.APP_PASSWORD;

	constructor(
		private readonly sagaService: SagaService,
		private readonly appPasswordService: AppPasswordService,
		private readonly logger: Logger
	) {
		super('deleteUserData');
		this.logger.setContext(DeleteUserAppPasswordDataStep.name);
		this.sagaService.registerStep(this.moduleName, this);
	}

	public async execute(params: { userId: EntityId }): Promise<StepReport> {
		const { userId } = params;

		const appPasswordsDeleted = await this.deleteAppPasswords(userId);

		const result = StepReportBuilder.build(this.moduleName, [appPasswordsDeleted]);

		return result;
	}

	private async deleteAppPasswords(userId: EntityId): Promise<StepOperationReport> {
		this.logger.info(
			new UserDeletionStepOperationLoggable(
				'Deleting app passwords of user',
				this.moduleName,
				userId,
				StepStatus.PENDING
			)
		);

		const deletedIds = await this.appPasswordService.deleteAllByUserId(userId);
		const deletedCount = deletedIds.length;

		const result = StepOperationReportBuilder.build(StepOperationType.DELETE, deletedCount, deletedIds);

		this.logger.info(
			new UserDeletionStepOperationLoggable(
				'Successfully deleted app passwords of user',
				this.moduleName,
				userId,
				StepStatus.FINISHED,
				0,
				deletedCount
			)
		);

		return result;
	}
}
