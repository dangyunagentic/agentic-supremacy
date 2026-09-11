import type { Paged } from '../entities/common.entity';
import type { SocialAccountEntity, SocialRunEntity } from '../entities/social.entity';

export interface SocialAccountRepository {
  create(data: {
    userId: string;
    platform: string;
    username: string;
    email?: string | null;
    displayName?: string | null;
    encryptedCredentials: string;
    proxy?: string | null;
  }): Promise<SocialAccountEntity>;
  findById(id: string): Promise<SocialAccountEntity | null>;
  listByUser(userId: string, platform?: string): Promise<SocialAccountEntity[]>;
  update(
    id: string,
    data: Partial<
      Pick<
        SocialAccountEntity,
        'username' | 'email' | 'displayName' | 'encryptedCredentials' | 'proxy' | 'status' | 'isActive'
      >
    >,
  ): Promise<SocialAccountEntity>;
  delete(id: string): Promise<void>;
}

export interface SocialRunRepository {
  create(data: {
    userId: string;
    accountId?: string | null;
    action: string;
    proxy?: string | null;
    input: unknown;
  }): Promise<SocialRunEntity>;
  findById(id: string): Promise<SocialRunEntity | null>;
  listByUser(userId: string, page: number, limit: number): Promise<Paged<SocialRunEntity>>;
  update(
    id: string,
    data: Partial<Pick<SocialRunEntity, 'status' | 'result' | 'error' | 'completedAt'>>,
  ): Promise<SocialRunEntity>;
  countAll(): Promise<number>;
}
