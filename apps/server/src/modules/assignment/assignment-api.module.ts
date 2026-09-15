import { ConfigurationModule } from '@infra/configuration';
import {
	FILES_STORAGE_AMQP_CLIENT_CONFIG_TOKEN,
	FilesStorageAMQPClientConfig,
	FilesStorageAMQPClientModule,
} from '@infra/files-storage-amqp-client';
import { LoggerModule } from '@infra/logger';
import { RABBITMQ_CONFIG_TOKEN, RabbitMQConfig } from '@infra/rabbitmq';
import { AuthorizationModule } from '@modules/authorization';
import { BOARD_PUBLIC_API_CONFIG_TOKEN, BoardModule, BoardPublicApiConfig } from '@modules/board';
import { RoomMembershipModule } from '@modules/room-membership';
import { Module } from '@nestjs/common';
import { AssignmentController, AssignmentUc } from './api';

@Module({
	imports: [
		ConfigurationModule.register(BOARD_PUBLIC_API_CONFIG_TOKEN, BoardPublicApiConfig),
		AuthorizationModule,
		BoardModule,
		RoomMembershipModule,
		LoggerModule,
		FilesStorageAMQPClientModule.register({
			exchangeConfigConstructor: FilesStorageAMQPClientConfig,
			exchangeConfigInjectionToken: FILES_STORAGE_AMQP_CLIENT_CONFIG_TOKEN,
			configInjectionToken: RABBITMQ_CONFIG_TOKEN,
			configConstructor: RabbitMQConfig,
		}),
	],
	controllers: [AssignmentController],
	providers: [AssignmentUc],
})
export class AssignmentApiModule {}
