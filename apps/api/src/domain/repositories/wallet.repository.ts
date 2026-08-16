import type { Paged } from '../entities/common.entity';
import type { WalletEntity } from '../entities/wallet.entity';

export interface WalletRepository {
  create(data: {
    userId: string;
    address: string;
    encryptedKey: string;
    label?: string | null;
    chainId?: number;
  }): Promise<WalletEntity>;
  findById(id: string): Promise<WalletEntity | null>;
  findByAddress(address: string): Promise<WalletEntity | null>;
  listByUser(userId: string): Promise<WalletEntity[]>;
  listAll(params: { page: number; limit: number; ownerId?: string }): Promise<Paged<WalletEntity>>;
  delete(id: string): Promise<void>;
  countAll(): Promise<number>;
  countByUser(userId: string): Promise<number>;
}
