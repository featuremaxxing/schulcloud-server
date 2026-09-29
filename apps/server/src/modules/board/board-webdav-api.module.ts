import { RegisterTimeoutConfig } from '@core/interceptor/register-timeout-config.decorator';
import { ConfigurationModule } from '@infra/configuration';
import { LoggerModule } from '@infra/logger';
import { AppPasswordModule } from '@modules/app-password';
import { AuthenticationModule } from '@modules/authentication';
import { AuthorizationModule } from '@modules/authorization';
import { CourseModule } from '@modules/course';
import { RoomMembershipModule } from '@modules/room-membership';
import { HttpModule } from '@nestjs/axios';
import { forwardRef, Module } from '@nestjs/common';
import { BoardContextApiHelperModule } from '../board-context';
import { RoomModule } from '../room';
import { BOARD_CONFIG_TOKEN, BoardConfig } from './board.config';
import { BoardModule } from './board.module';
import { BoardUc, CardUc, ColumnUc, ElementUc, FileAreaUc } from './uc';
import {
	WEBDAV_CONFIG_TOKEN,
	WEBDAV_TIMEOUT_CONFIG_TOKEN,
	WebDavConfig,
	WebDavTimeoutConfig,
} from './webdav/webdav.config';
import { WebDavAuthService } from './webdav/webdav-auth.service';
import { WebDavFilesStorageClient } from './webdav/webdav-files-storage.client';
import { WebDavLockStore } from './webdav/webdav-lock.store';
import { WebDavResourceResolver } from './webdav/webdav-resource.resolver';
import { WebDavVirtualFileStore } from './webdav/webdav-virtual-file.store';
import { WebDavController } from './webdav/webdav.controller';
import { WebDavHandler } from './webdav/webdav.handler';

// Boards as a network drive (WebDAV, /api/v3/webdav). Board changes go through the same
// use cases as the board REST API; they are provided here again because the WebDAV drive
// authenticates differently (app passwords) and must not depend on the REST controllers.
@Module({
	imports: [
		ConfigurationModule.register(BOARD_CONFIG_TOKEN, BoardConfig),
		ConfigurationModule.register(WEBDAV_CONFIG_TOKEN, WebDavConfig),
		ConfigurationModule.register(WEBDAV_TIMEOUT_CONFIG_TOKEN, WebDavTimeoutConfig),
		AppPasswordModule,
		AuthenticationModule,
		forwardRef(() => AuthorizationModule),
		BoardContextApiHelperModule,
		BoardModule,
		CourseModule,
		HttpModule,
		LoggerModule,
		RoomMembershipModule,
		RoomModule,
	],
	controllers: [WebDavController],
	providers: [
		BoardUc,
		CardUc,
		ColumnUc,
		ElementUc,
		FileAreaUc,
		WebDavAuthService,
		WebDavFilesStorageClient,
		WebDavHandler,
		WebDavLockStore,
		WebDavResourceResolver,
		WebDavVirtualFileStore,
	],
})
@RegisterTimeoutConfig(WEBDAV_TIMEOUT_CONFIG_TOKEN)
export class BoardWebDavApiModule {}
