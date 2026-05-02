import { Module } from '@nestjs/common';
import { DevToolsController } from './dev-tools.controller.js';
import { DevToolsService } from './dev-tools.service.js';

@Module({
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
