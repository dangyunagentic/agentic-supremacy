// Enums shared by api, worker and web. Values match the Prisma enums 1:1.

export const Role = { User: 'user', Admin: 'admin' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = { Active: 'active', Suspended: 'suspended' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const MintMode = {
  Public: 'public',
  Allowlist: 'allowlist',
  Fcfs: 'fcfs',
  Auto: 'auto',
} as const;
export type MintMode = (typeof MintMode)[keyof typeof MintMode];

export const WalletMode = {
  Single: 'single',
  SelfFunded: 'self_funded',
  Sponsored: 'sponsored',
} as const;
export const WalletModeValues = Object.values(WalletMode);
export type WalletMode = (typeof WalletMode)[keyof typeof WalletMode];

export const TimingMode = {
  WaitForStage: 'wait_for_stage',
  FireNow: 'fire_now',
  CustomTime: 'custom_time',
} as const;
export type TimingMode = (typeof TimingMode)[keyof typeof TimingMode];

export const TaskStatus = {
  Draft: 'draft',
  Scheduled: 'scheduled',
  PreFlight: 'pre_flight',
  Calldata: 'calldata',
  PreSign: 'pre_sign',
  Dispatching: 'dispatching',
  AwaitingReceipt: 'awaiting_receipt',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const WalletResultStatus = {
  Pending: 'pending',
  Signed: 'signed',
  Dispatched: 'dispatched',
  Success: 'success',
  Reverted: 'reverted',
  Rejected: 'rejected',
  Timeout: 'timeout',
} as const;
export type WalletResultStatus = (typeof WalletResultStatus)[keyof typeof WalletResultStatus];

export const LogLevel = { Info: 'info', Warn: 'warn', Error: 'error', Success: 'success' } as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const TransferKind = { Fund: 'fund', TransferNft: 'transfer_nft' } as const;
export type TransferKind = (typeof TransferKind)[keyof typeof TransferKind];

export const TransferStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];

export const RpcProvider = {
  Alchemy: 'alchemy',
  QuickNode: 'quicknode',
  Drpc: 'drpc',
  Custom: 'custom',
} as const;
export const RpcProviderValues = Object.values(RpcProvider);
export type RpcProvider = (typeof RpcProvider)[keyof typeof RpcProvider];

export const RpcTier = { Free: 'free', Paid: 'paid' } as const;
export type RpcTier = (typeof RpcTier)[keyof typeof RpcTier];

export function isTaskTerminal(status: TaskStatus): boolean {
  return (
    status === TaskStatus.Completed ||
    status === TaskStatus.Failed ||
    status === TaskStatus.Cancelled
  );
}

export function isTaskCancellable(status: TaskStatus): boolean {
  return !isTaskTerminal(status);
}
