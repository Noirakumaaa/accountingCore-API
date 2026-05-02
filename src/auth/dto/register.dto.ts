import {
  IsEmail,
  IsString,
  IsOptional,
  IsIn,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class RegisterDTO {
  @IsString()
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MaxLength(50)
  lastName: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username can only contain letters, numbers and underscores',
  })
  username: string;

  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  @IsString()
  @IsOptional()
  @IsIn(['owner', 'admin', 'accountant', 'viewer'])
  role?: string;
}
