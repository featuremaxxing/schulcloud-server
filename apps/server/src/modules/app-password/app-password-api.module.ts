import { ConfigurationModule } from '@infra/configuration';
import { LoggerModule } from '@infra/logger';
import { SagaModule } from '@modules/saga';
import { UserModule } from '@modules/user';
import { Module } from '@nestjs/common';
import { AppPasswordController, AppPasswordUc } from './api';
import { DeleteUserAppPasswordDataStep } from './api/saga';
import { APP_PASSWORD_CONFIG_TOKEN, AppPasswordConfig } from './app-password.config';
import { AppPasswordModule } from './app-password.module';

@Module({
	imports: [
		ConfigurationModule.register(APP_PASSWORD_CONFIG_TOKEN, AppPasswordConfig),
		AppPasswordModule,
		LoggerModule,
		SagaModule,
		UserModule,
	],
	controllers: [AppPasswordController],
	providers: [AppPasswordUc, DeleteUserAppPasswordDataStep],
})
export class AppPasswordApiModule {}
