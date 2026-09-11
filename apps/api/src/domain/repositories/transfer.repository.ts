import type { TransferJobEntity, RpcEndpointEntity } from '../entities/transfer.entity';
import type { TransferResultRow } from '../entities/transfer.entity';
import type { Paged } from '../entities/common.entity';
import type { RpcProvider, RpcTier } from '@mintbot/shared';

export interface RpcEndpointRepository {
  create(data: {
    userId: string;
    chainKey: string;
    label: string;
    url: string;
    provider?: string;
    tier?: string;
    isDefault?: boolean;
  }): Promise<RpcEndpointEntity>;
  findById(id: string): Promise<RpcEndpointEntity | null>;
  listByUser(userId: string, chainKey?: string): Promise<RpcEndpointEntity[]>;
  update(id: string, data: Partial<Pick<RpcEndpointEntity, 'label' | 'lastLatencyMs' | 'vpsLatencyMs' | 'rpcLatencyMs' | 'isDefault'>>): Promise<RpcEndpointEntity>;
  delete(id: string): Promise<void>;
}

export interface TransferJobRepository {
  create(data: {
    userId: string;
    kind: 'fund' | 'transfer_nft' | 'disperse' | 'consolidate';
    chainKey: string;
    fromWalletId?: string | null;
    toWalletIds: string[];
    recipientAddress?: string | null;
    amountEth?: string | null;
    tokenContract?: string | null;
    tokenSymbol?: string | null;
    fromBlock?: number | null;
    results?: TransferResultRow[];
  }): Promise<TransferJobEntity>;
  findById(id: string): Promise<TransferJobEntity | null>;
  listByUser(userId: string, page: number, limit: number): Promise<Paged<TransferJobEntity>>;
  update(id: string, data: Partial<Pick<TransferJobEntity, 'status' | 'results' | 'error' | 'completedAt'>>): Promise<TransferJobEntity>;
}
