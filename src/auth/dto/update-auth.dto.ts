import { PartialType } from '@nestjs/mapped-types';
import { RegisterDTO } from './register.dto.js';

export class UpdateAuthDTO extends PartialType(RegisterDTO) {}
