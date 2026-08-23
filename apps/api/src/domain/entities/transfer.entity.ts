import type { RpcProvider, RpcTier, TransferKind, TransferStatus } from '@mintbot/shared';

export interface RpcEndpointEntity {
  id: string;
  userId: string;
  chainKey: string;
  label: string;
  url: string;
  provider: RpcProvider | string;
  tier: RpcTier | string;
  lastLatencyMs: number | null;
  vpsLatencyMs: number | null;
  rpcLatencyMs: number | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransferResultRow {
  address: string;
  txHash: string | null;
  status: 'success' | 'failed';
  detail?: string;
}

export interface TransferJobEntity {
  id: string;
  userId: string;
  kind: TransferKind | string;
  chainKey: string;
  fromWalletId: string | null;
  toWalletIds: string[];
  recipientAddress: string | null;
  amountEth: string | null;
  tokenContract: string | null;
  fromBlock: number | null;
  status: TransferStatus | string;
  results: TransferResultRow[];
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
