import type { SocialActionType, SocialPlatform } from '@mintbot/shared';

export interface SocialAccountEntity {
  id: string;
  userId: string;
  platform: SocialPlatform | string;
  username: string;
  email: string | null;
  displayName: string | null;
  /** AES-256-GCM ciphertext, base64. Never leaves infrastructure. */
  encryptedCredentials: string;
  proxy: string | null;
  status: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialRunEntity {
  id: string;
  userId: string;
  accountId: string | null;
  action: SocialActionType | string;
  proxy: string | null;
  status: string;
  input: unknown;
  result: unknown;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
