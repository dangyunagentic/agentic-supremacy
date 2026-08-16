import type { Paged } from '../entities/common.entity';
import type { SafeUser, UserEntity } from '../entities/user.entity';
import type { Role } from '@mintbot/shared';

export interface UserRepository {
  create(data: {
    username: string;
    email: string;
    passwordHash: string;
    role?: Role;
    telegramId?: string | null;
  }): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findByUsername(username: string): Promise<UserEntity | null>;
  findByTelegramId(telegramId: string): Promise<UserEntity | null>;
  update(
    id: string,
    data: Partial<Pick<UserEntity, 'role' | 'status' | 'telegramId' | 'passwordHash'>>,
  ): Promise<UserEntity>;
  delete(id: string): Promise<void>;
  list(params: { page: number; limit: number; search?: string }): Promise<Paged<SafeUser>>;
  countAll(): Promise<number>;
}
