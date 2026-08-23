export interface ChainEntity {
  id: number;
  key: string;
  chainId: number;
  name: string;
  explorer: string;
  nativeSymbol: string;
  publicRpcs: string[];
  defaultPrivateRpc: string | null;
  seadropAddress: string;
  isActive: boolean;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogEntity {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface SystemConfigEntity {
  id: number;
  defaultGasLimit: number;
  defaultMaxFeeGwei: number;
  defaultPriorityGwei: number;
  scheduleRefreshSec: number;
  txMaxAttempts: number;
  pendingTimeoutSec: number;
  receiptPollBaseMs: number;
  receiptPollMaxMs: number;
  replacementBumpBps: number;
  openseaApiKeyEnc: string | null;
  updatedAt: Date;
}
