import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SafeUser } from '../../domain/entities/user.entity';
import type { RefreshTokenRepositoryPort } from '../../domain/repositories/refresh-token.repository';
import type { RotationResult, TokenPair, TokenServicePort } from '../../domain/ports/ports';
import { TOKENS } from '../../domain/tokens';

export interface AccessPayload {
  sub: string;
  role: string;
}

export interface RefreshPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
}

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches JWT_REFRESH_EXPIRES_IN

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class JwtTokenService implements TokenServicePort {
  constructor(
    private readonly jwt: JwtService,
    @Inject(TOKENS.RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepositoryPort,
  ) {}

  async issuePair(user: SafeUser): Promise<TokenPair> {
    const accessToken = this.signAccess(user);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  async issueAccess(user: SafeUser): Promise<string> {
    return this.signAccess(user);
  }

  async verifyAccess(token: string): Promise<AccessPayload> {
    try {
      return await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  async rotateRefresh(token: string): Promise<RotationResult> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = sha256(token);
    const stored = await this.refreshTokens.findByHash(tokenHash);

    // No record → token was never issued, already rotated, or already revoked.
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection: replaying an already-rotated token is a strong signal
    // that it leaked. Kill the whole session family.
    if (stored.revokedAt) {
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      await this.refreshTokens.revoke(tokenHash);
      throw new UnauthorizedException('Refresh token expired');
    }

    // Issue the successor before revoking the parent so we can link the chain.
    const next = await this.issueRefreshToken(stored.userId);
    await this.refreshTokens.revoke(tokenHash, sha256(next));

    return { sub: stored.userId, refreshToken: next };
  }

  async revokeRefresh(token: string): Promise<void> {
    await this.refreshTokens.revoke(sha256(token));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  private signAccess(user: SafeUser): string {
    const payload: AccessPayload = { sub: user.id, role: user.role };
    return this.jwt.sign(payload, { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    // jti makes every refresh token unique (two issued in the same second are
    // no longer identical), and the DB hash enables rotation + revocation.
    const jti = randomUUID();
    const refreshToken = this.jwt.sign(
      { sub: userId, typ: 'refresh', jti } satisfies RefreshPayload,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d' },
    );

    await this.refreshTokens.create({
      tokenHash: sha256(refreshToken),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });

    return refreshToken;
  }
}
