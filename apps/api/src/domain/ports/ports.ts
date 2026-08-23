import type { SafeUser } from '../entities/user.entity';

/** Hashes and verifies passwords. Implemented in infrastructure (bcryptjs). */
export interface PasswordHasherPort {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Result of a refresh-token rotation: the fresh refresh token + owning user id. */
export interface RotationResult {
  sub: string;
  refreshToken: string;
}

/**
 * Issues and verifies JWTs. Implemented in infrastructure (@nestjs/jwt).
 * Refresh tokens are additionally persisted (hashed) so they can be rotated
 * and revoked server-side.
 */
export interface TokenServicePort {
  issuePair(user: SafeUser): Promise<TokenPair>;
  /** Signs a short-lived access token only (role comes from the caller's user). */
  issueAccess(user: SafeUser): Promise<string>;
  verifyAccess(token: string): Promise<{ sub: string; role: string }>;
  /** Validates a refresh token, rotates it (one-time use) and returns the fresh token + sub. */
  rotateRefresh(token: string): Promise<RotationResult>;
  /** Revokes a single refresh token (logout). */
  revokeRefresh(token: string): Promise<void>;
  /** Revokes every refresh token for a user (forced logout everywhere). */
  revokeAllForUser(userId: string): Promise<void>;
}

/** Encrypts wallet private keys at rest (AES-256-GCM + scrypt). */
export interface KeyEncryptionPort {
  encrypt(privateKey: string): string;
  decrypt(ciphertext: string): string;
}

export interface ScheduleInfo {
  taskId: string;
  fireAt: Date;
}

/** Enqueues execution jobs on the BullMQ queues consumed by the worker. */
export interface MintSchedulerPort {
  schedulePreflight(taskId: string, runAt: Date): Promise<void>;
  runNow(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  scheduleTransfer(transferJobId: string): Promise<void>;
}

/** Publishes realtime task events for the dashboard (Redis pub/sub). */
export interface TaskEventPublisherPort {
  publish(event: import('@mintbot/shared').TaskEvent): void;
}

/** Sends a notification to a user (Telegram when linked, no-op otherwise). */
export interface NotifierPort {
  notifyUser(userId: string, message: string): Promise<void>;
}

/** Short-lived pairing codes linking a Telegram account to a web account. */
export interface TelegramLinkPort {
  createCode(userId: string): { code: string; expiresAt: Date };
  consumeCode(code: string, telegramId: string): string | null; // returns userId
}

/** Read-only on-chain queries used by the API (balances, drop lookups). */
export interface ChainQueryPort {
  getNativeBalance(chainKey: string, address: string): Promise<bigint>;
  getPublicDropStart(chainKey: string, collection: string): Promise<number | null>;
  getPublicDrop(chainKey: string, collection: string): Promise<import('@mintbot/shared').PublicDropInfo | null>;
  pingRpc(url: string): Promise<{ vps: number; rpc: number }>;
}

/** Allowlist/FCFS (GTD) eligibility lookups through the OpenSea API. */
export interface EligibilityApiPort {
  configured: boolean;
  fetchStage(slug: string, chainKey: string): Promise<{
    kind: 'allowlist' | 'fcfs' | 'public' | 'none';
    startTime: string | null;
    endTime: string | null;
  }>;
  fetchWalletAction(slug: string, chainKey: string, address: string): Promise<{
    eligible: boolean;
    reason: string;
  }>;
}
