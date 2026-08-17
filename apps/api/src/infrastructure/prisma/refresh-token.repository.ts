import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { RefreshTokenRepositoryPort } from '../../domain/repositories/refresh-token.repository';
import { toRefreshTokenEntity } from '../../domain/entities/refresh-token.entity';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { tokenHash: string; userId: string; expiresAt: Date }) {
    const row = await this.prisma.refreshToken.create({ data });
    return toRefreshTokenEntity(row);
  }

  async findByHash(tokenHash: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return row ? toRefreshTokenEntity(row) : null;
  }

  async revoke(tokenHash: string, replacedBy?: string) {
    await this.prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date(), replacedBy: replacedBy ?? null },
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
