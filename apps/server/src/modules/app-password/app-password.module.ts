import { Module } from '@nestjs/common';
import { AppPasswordService } from './domain';
import { AppPasswordRepo } from './repo';

@Module({
	providers: [AppPasswordRepo, AppPasswordService],
	exports: [AppPasswordService],
})
export class AppPasswordModule {}
