import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ContactsService } from './contacts.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  findAll(@Query('kind') kind?: 'all' | 'customer' | 'vendor') {
    return this.contactsService.findAll(kind ?? 'all');
  }

  @Post()
  create(@Body() dto: CreateContactDto) {
    return this.contactsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  deactivate(@Param('id') id: string) {
    return this.contactsService.setActive(id, false);
  }

  @Patch(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  activate(@Param('id') id: string) {
    return this.contactsService.setActive(id, true);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  remove(@Param('id') id: string) {
    return this.contactsService.remove(id);
  }
}
