import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { RegisterDTO } from './dto/register.dto.js';
import { LoginDTO } from './dto/login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard.js';
import type { Request, Response } from 'express';
import type { AccessUser, RefreshUser } from './types/auth-user.js';

@Controller(['auth', 'payroll/auth'])
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('company-status')
  companyStatus() {
    return this.authService.companyStatus();
  }

  @Post('register')
  @Throttle({ auth: { ttl: 60_000, limit: 5 } })
  register(
    @Body() dto: RegisterDTO,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.register(dto, res);
  }

  @Post('register-employee')
  @UseGuards(JwtAuthGuard)
  registerEmployee(@Body() dto: RegisterDTO, @Req() req: Request) {
    const { role } = req.user as AccessUser;
    return this.authService.registerEmployee(dto, role);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  login(@Body() dto: LoginDTO, @Res({ passthrough: true }) res: Response) {
    return this.authService.login(dto, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { sessionId } = req.user as RefreshUser;
    return this.authService.logout(sessionId, res);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { id, username, firstName, lastName, sessionId } =
      req.user as RefreshUser;
    return this.authService.refresh(
      id,
      username,
      firstName,
      lastName,
      sessionId,
      res,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    const { id } = req.user as AccessUser;
    return this.authService.getMe(id);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Req() req: Request,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
  ) {
    const { id } = req.user as AccessUser;
    return this.authService.changePassword(id, currentPassword, newPassword);
  }
}
