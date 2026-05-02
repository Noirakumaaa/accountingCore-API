import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import type { AccessUser } from '../types/auth-user.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    const extractAccessToken = (req: Request): string | null => {
      const cookies = req.cookies as Record<string, unknown> | undefined;
      const token = cookies?.access_token;
      return typeof token === 'string' ? token : null;
    };

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractAccessToken]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  validate(payload: {
    sub: string;
    username: string;
    firstName: string;
    lastName: string;
    role: string;
    mustChangePassword: boolean;
  }): AccessUser {
    return {
      id: payload.sub,
      username: payload.username,
      firstName: payload.firstName,
      lastName: payload.lastName,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
    };
  }
}
