import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SafeUser } from '../../domain/entities/user.entity';
import type { TokenPair, TokenServicePort } from '../../domain/ports/ports';

export interface AccessPayload {
  sub: string;
  role: string;
}

export interface RefreshPayload {
  sub: string;
  typ: 'refresh';
}

@Injectable()
export class JwtTokenService implements TokenServicePort {
  constructor(private readonly jwt: JwtService) {}

  issuePair(user: SafeUser): TokenPair {
    const payload: AccessPayload = { sub: user.id, role: user.role };
    const accessToken = this.jwt.sign(payload, { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' });
    const refreshToken = this.jwt.sign(
      { sub: user.id, typ: 'refresh' } satisfies RefreshPayload,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d' },
    );
    return { accessToken, refreshToken };
  }

  async verifyAccess(token: string): Promise<AccessPayload> {
    try {
      return await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  async verifyRefresh(token: string): Promise<RefreshPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshPayload>(token);
      if (payload.typ !== 'refresh') throw new Error('wrong token type');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
