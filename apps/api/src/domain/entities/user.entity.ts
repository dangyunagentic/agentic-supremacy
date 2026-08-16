import type { Role, UserStatus } from '@mintbot/shared';

export interface UserEntity {
  id: string;
  telegramId: string | null;
  username: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeUser {
  id: string;
  telegramId: string | null;
  username: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: Date;
}
