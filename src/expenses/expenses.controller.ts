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
import { ExpensesService } from './expenses.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { UpdateExpenseDto } from './dto/update-expense.dto.js';

@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AccessUser) {
    return this.expensesService.create(dto, user.id);
  }

  @Get()
  findAll() {
    return this.expensesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(id, dto);
  }

  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'accountant')
  approve(@Param('id') id: string, @CurrentUser() user: AccessUser) {
    return this.expensesService.approve(id, user.id);
  }

  @Patch(':id/post')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'accountant')
  post(@Param('id') id: string, @CurrentUser() user: AccessUser) {
    return this.expensesService.post(id, user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  remove(@Param('id') id: string) {
    return this.expensesService.remove(id);
  }
}
