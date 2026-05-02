import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AccessUser } from '../auth/types/auth-user.js';
import { DevToolsService, type DevModelKey } from './dev-tools.service.js';

@Controller('dev-tools')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DevToolsController {
  constructor(private readonly devToolsService: DevToolsService) {}

  @Get('models')
  findModels() {
    return this.devToolsService.findModels();
  }

  @Post('models/:modelKey/seed')
  seedModel(
    @Param('modelKey') modelKey: DevModelKey,
    @CurrentUser() user: AccessUser,
  ) {
    return this.devToolsService.seedModel(modelKey, user);
  }

  @Delete('models/:modelKey')
  clearModel(@Param('modelKey') modelKey: DevModelKey) {
    return this.devToolsService.clearModel(modelKey);
  }
}
