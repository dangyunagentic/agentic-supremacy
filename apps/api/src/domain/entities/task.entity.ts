import type { MintMode, TimingMode, WalletMode, TaskStatus } from '@mintbot/shared';

export interface TaskEntity {
  id: string;
  userId: string;
  name: string;
  collection: string;
  chainKey: string;
  walletIds: string[];
  quantity: number;
  mintMode: MintMode;
  walletMode: WalletMode;
  maxFeeGwei: number;
  maxPriorityGwei: number;
  gasLimit: number;
  rpcUrls: string[];
  timingMode: TimingMode;
  customFireTime: Date | null;
  recipientAddress: string | null;
  sponsorWalletId: string | null;
  pricePerNft: number | null;
  proxyGroup: string | null;
  fundedOnly: boolean;
  flashbots: boolean;
  nonce: number | null;
  fireTimestamp: number | null;
  delayMs: number;
  simulate: boolean;
  spam: boolean;
  action: boolean;
  status: TaskStatus;
  resolvedFireAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}
