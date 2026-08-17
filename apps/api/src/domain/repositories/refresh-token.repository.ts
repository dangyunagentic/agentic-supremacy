import type { RefreshTokenEntity } from '../entities/refresh-token.entity';

/**
 * Persistence for refresh tokens. Only SHA-256 hashes are ever written; the
 * raw token never touches the database. This is the server-side half of the
 * rotation/revocation scheme.
 */
export interface RefreshTokenRepositoryPort {
  create(data: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<RefreshTokenEntity>;

  findByHash(tokenHash: string): Promise<RefreshTokenEntity | null>;

  /** Marks `tokenHash` revoked and links it to its successor (rotation chain). */
  revoke(tokenHash: string, replacedBy?: string): Promise<void>;

  revokeAllForUser(userId: string): Promise<void>;
}
