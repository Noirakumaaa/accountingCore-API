import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AccessUser } from '../auth/types/auth-user.js';
import { CheckVouchersService } from './check-vouchers.service.js';
import { CreateCheckVoucherDto } from './dto/create-check-voucher.dto.js';
import { UpdateCheckVoucherDto } from './dto/update-check-voucher.dto.js';

@Controller('check-vouchers')
@UseGuards(JwtAuthGuard)
export class CheckVouchersController {
  constructor(private readonly checkVouchersService: CheckVouchersService) {}

  @Post()
  create(@Body() dto: CreateCheckVoucherDto, @CurrentUser() user: AccessUser) {
    return this.checkVouchersService.create(dto, user.id);
  }

  @Get()
  findAll() {
    return this.checkVouchersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.checkVouchersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCheckVoucherDto) {
    return this.checkVouchersService.update(id, dto);
  }

  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'accountant')
  approve(@Param('id') id: string, @CurrentUser() user: AccessUser) {
    return this.checkVouchersService.approve(id, user.id);
  }

  @Patch(':id/issue')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'accountant')
  issue(@Param('id') id: string, @CurrentUser() user: AccessUser) {
    return this.checkVouchersService.issue(id, user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  remove(@Param('id') id: string) {
    return this.checkVouchersService.remove(id);
  }
}
