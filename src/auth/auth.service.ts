import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDTO } from './dto/register.dto.js';
import { LoginDTO } from './dto/login.dto.js';
import { shouldUseSecureCookies } from '../config/runtime-env.js';

const COOKIE_BASE = {
  httpOnly: true,
  secure: shouldUseSecureCookies(),
  sameSite: 'lax' as const,
};

import { UserRole } from '@prisma/client';

const REGISTRABLE_ROLES: UserRole[] = [
  UserRole.owner,
  UserRole.admin,
  UserRole.accountant,
  UserRole.viewer,
];

const DEFAULT_ACCESS_TOKEN_MINUTES = 15;
const DEFAULT_REFRESH_TOKEN_DAYS = 7;

const withoutPassword = <T extends { password: string }>(
  user: T,
): Omit<T, 'password'> => {
  const { password, ...safeUser } = user;
  void password;
  return safeUser;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private normalizeRole(role?: string): UserRole {
    if (role && (REGISTRABLE_ROLES as string[]).includes(role)) {
      return role as UserRole;
    }
    return UserRole.viewer;
  }

  private assertCanCreateRole(creatorRole: UserRole, targetRole: UserRole) {
    const allowedByRole: Record<UserRole, UserRole[]> = {
      [UserRole.owner]: [UserRole.admin, UserRole.accountant, UserRole.viewer],
      [UserRole.admin]: [UserRole.accountant, UserRole.viewer],
      [UserRole.accountant]: [UserRole.viewer],
      [UserRole.viewer]: [],
    };

    if (!allowedByRole[creatorRole].includes(targetRole)) {
      throw new UnauthorizedException(
        'You are not allowed to create an account with this role.',
      );
    }
  }

  private async hasRegisteredCompany() {
    const [company, ownerCount] = await Promise.all([
      this.prisma.companyInfo.findUnique({
        where: { id: 'singleton' },
        select: { ownerId: true },
      }),
      this.prisma.user.count({
        where: { role: UserRole.owner },
      }),
    ]);

    return Boolean(company?.ownerId) || ownerCount > 0;
  }

  async companyStatus() {
    return { registered: await this.hasRegisteredCompany() };
  }

  async register(dto: RegisterDTO, res: Response) {
    try {
      const normalizedRole = this.normalizeRole(dto.role);

      if (normalizedRole === 'owner' && (await this.hasRegisteredCompany())) {
        throw new ConflictException(
          'This company is already registered. Contact your admin for access.',
        );
      }

      const emailTaken = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (emailTaken)
        throw new ConflictException(
          'An account with this email already exists',
        );

      const usernameTaken = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (usernameTaken)
        throw new ConflictException('Username is already taken');

      const hashed = await bcrypt.hash(dto.password, 12);
      const rest = { ...dto };
      delete rest.role;
      const user = await this.prisma.user.create({
        data: { ...rest, password: hashed, role: normalizedRole },
      });

      if (normalizedRole === UserRole.owner) {
        await this.prisma.companyInfo.upsert({
          where: { id: 'singleton' },
          create: {
            id: 'singleton',
            ownerId: user.id,
          },
          update: {
            ownerId: user.id,
          },
        });
      }

      await this.issueTokens(
        res,
        user.id,
        user.username,
        user.firstName,
        user.lastName,
      );
      return withoutPassword(user);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Unable to create your account at this time. Please try again later.',
      );
    }
  }

  async registerEmployee(dto: RegisterDTO, creatorRole: string) {
    try {
      const normalizedCreatorRole = this.normalizeRole(creatorRole);
      const targetRole = this.normalizeRole(dto.role);

      this.assertCanCreateRole(normalizedCreatorRole, targetRole);

      const emailTaken = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (emailTaken)
        throw new ConflictException(
          'An account with this email already exists',
        );

      const usernameTaken = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (usernameTaken)
        throw new ConflictException('Username is already taken');

      const hashed = await bcrypt.hash(dto.password, 12);
      const rest = { ...dto };
      delete rest.role;
      const user = await this.prisma.user.create({
        data: { ...rest, password: hashed, role: targetRole },
      });

      return withoutPassword(user);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Unable to create employee account at this time. Please try again later.',
      );
    }
  }

  async login(dto: LoginDTO, res: Response) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.issueTokens(
      res,
      user.id,
      user.username,
      user.firstName,
      user.lastName,
    );
    return withoutPassword(user);
  }

  async logout(sessionId: string, res: Response) {
    await this.prisma.session
      .delete({ where: { id: sessionId } })
      .catch(() => {});
    res.clearCookie('access_token', COOKIE_BASE);
    res.clearCookie('refresh_token', COOKIE_BASE);
    return { message: 'Logged out' };
  }

  async refresh(
    userId: string,
    username: string,
    firstName: string,
    lastName: string,
    oldSessionId: string,
    res: Response,
  ) {
    await this.prisma.session
      .delete({ where: { id: oldSessionId } })
      .catch(() => {});
    await this.issueTokens(res, userId, username, firstName, lastName);
    return { message: 'Tokens refreshed' };
  }

  async getMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, mustChangePassword: false },
    });
    return { ok: true };
  }

  private async loadSessionSettings() {
    const settings = await this.prisma.companyInfo.findUnique({
      where: { id: 'singleton' },
      select: {
        accountingAccessTokenMinutes: true,
        accountingRefreshTokenDays: true,
      },
    });

    return {
      accessTokenMinutes:
        settings?.accountingAccessTokenMinutes ?? DEFAULT_ACCESS_TOKEN_MINUTES,
      refreshTokenDays:
        settings?.accountingRefreshTokenDays ?? DEFAULT_REFRESH_TOKEN_DAYS,
    };
  }

  private async issueTokens(
    res: Response,
    userId: string,
    username: string,
    firstName: string,
    lastName: string,
  ) {
    const sessionSettings = await this.loadSessionSettings();
    const [session, userData] = await Promise.all([
      this.prisma.session.create({
        data: {
          userId,
          expiresAt: new Date(
            Date.now() + sessionSettings.refreshTokenDays * 24 * 60 * 60 * 1000,
          ),
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, mustChangePassword: true },
      }),
    ]);

    const accessPayload = {
      sub: userId,
      username,
      firstName,
      lastName,
      role: userData?.role ?? 'employee',
      mustChangePassword: userData?.mustChangePassword ?? false,
    };
    const refreshPayload = { ...accessPayload, sessionId: session.id };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: process.env.JWT_SECRET,
      expiresIn: `${sessionSettings.accessTokenMinutes}m`,
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: `${sessionSettings.refreshTokenDays}d`,
    });

    res.cookie('access_token', accessToken, {
      ...COOKIE_BASE,
      maxAge: sessionSettings.accessTokenMinutes * 60 * 1000,
    });
    res.cookie('refresh_token', refreshToken, {
      ...COOKIE_BASE,
      maxAge: sessionSettings.refreshTokenDays * 24 * 60 * 60 * 1000,
    });
  }
}
