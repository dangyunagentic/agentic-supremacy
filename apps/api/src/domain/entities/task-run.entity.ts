import type { LogLevel, WalletResultStatus } from '@mintbot/shared';

export interface TaskResultEntity {
  id: string;
  taskId: string;
  walletAddress: string;
  walletIndex: number;
  txHash: string | null;
  blockNumber: number | null;
  status: WalletResultStatus;
  gasUsed: number | null;
  errorMessage: string | null;
  nftTokenIds: string[];
  createdAt: Date;
}

export interface TaskLogEntity {
  id: string;
  taskId: string;
  level: LogLevel;
  message: string;
  walletIndex: number | null;
  timestamp: Date;
}
