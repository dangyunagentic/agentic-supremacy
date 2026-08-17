import type { RefreshToken } from '@prisma/client';

/** Domain entity for a persisted refresh token (hash only, never raw). */
export interface RefreshTokenEntity {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
  createdAt: Date;
}

export function toRefreshTokenEntity(row: RefreshToken): RefreshTokenEntity {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    userId: row.userId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedBy: row.replacedBy,
    createdAt: row.createdAt,
  };
}
