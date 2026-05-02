import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RefreshUser } from '../types/auth-user.js';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private readonly prisma: PrismaService) {
    const extractRefreshToken = (req: Request): string | null => {
      const cookies = req.cookies as Record<string, unknown> | undefined;
      const token = cookies?.refresh_token;
      return typeof token === 'string' ? token : null;
    };

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractRefreshToken]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET!,
    });
  }

  async validate(payload: {
    sub: string;
    username: string;
    firstName: string;
    lastName: string;
    role: string;
    mustChangePassword: boolean;
    sessionId: string;
  }): Promise<RefreshUser> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
    });
    if (!session || session.expiresAt < new Date())
      throw new UnauthorizedException();

    return {
      id: payload.sub,
      username: payload.username,
      firstName: payload.firstName,
      lastName: payload.lastName,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
      sessionId: payload.sessionId,
    };
  }
}
