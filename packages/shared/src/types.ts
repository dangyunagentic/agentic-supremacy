// Wire shapes shared between the API and the web dashboard.
import type {
  LogLevel,
  MintMode,
  Role,
  TaskStatus,
  TimingMode,
  UserStatus,
  WalletMode,
  WalletResultStatus,
} from './enums';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface UserView {
  id: string;
  telegramId: string | null;
  username: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface WalletView {
  id: string;
  address: string;
  label: string | null;
  chainId: number;
  createdAt: string;
  balance?: string | null;
}

export interface TaskView {
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
  customFireTime: string | null;
  resolvedFireAt: string | null;
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
  maxTx: number | null;
  earlyFireMs: number;
  status: TaskStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  walletCount?: number;
}

export interface TaskResultView {
  id: string;
  walletAddress: string;
  walletIndex: number;
  txHash: string | null;
  blockNumber: number | null;
  status: WalletResultStatus;
  gasUsed: number | null;
  errorMessage: string | null;
  nftTokenIds: string[];
}

export interface TaskLogView {
  id: string;
  level: LogLevel;
  message: string;
  walletIndex: number | null;
  timestamp: string;
}

export interface ChainView {
  id: number;
  key: string;
  chainId: number;
  name: string;
  explorer: string;
  nativeSymbol: string;
  publicRpcs: string[];
  defaultPrivateRpc: string | null;
  seadropAddress?: string;
  isActive: boolean;
  ownerId?: string | null;
}

export interface SystemConfigView {
  defaultGasLimit: number;
  defaultMaxFeeGwei: number;
  defaultPriorityGwei: number;
  scheduleRefreshSec: number;
  txMaxAttempts: number;
  pendingTimeoutSec: number;
  receiptPollBaseMs: number;
  receiptPollMaxMs: number;
  replacementBumpBps: number;
  openseaApiKeySet: boolean;
}

export interface AdminStatsView {
  totalUsers: number;
  totalWallets: number;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number; // 0..1
  totalMinted: number;
}

export interface AuditLogView {
  id: string;
  adminId: string;
  adminUsername?: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: unknown;
  createdAt: string;
}

// ── Realtime payloads (worker -> Redis pub/sub -> socket.io -> web) ──

export interface TaskStatusEvent {
  taskId: string;
  status: TaskStatus;
  timestamp: string;
}

export interface TaskLogEvent {
  taskId: string;
  level: LogLevel;
  message: string;
  walletIndex: number | null;
  timestamp: string;
}

export interface TaskWalletEvent {
  taskId: string;
  walletIndex: number;
  address: string;
  status: WalletResultStatus;
  txHash: string | null;
}

export interface TaskCompleteEvent {
  taskId: string;
  summary: { total: number; success: number; failed: number };
}

export type TaskEvent =
  | { type: 'status'; payload: TaskStatusEvent }
  | { type: 'log'; payload: TaskLogEvent }
  | { type: 'wallet'; payload: TaskWalletEvent }
  | { type: 'complete'; payload: TaskCompleteEvent };

// ── Task creation payload (web wizard + telegram wizard both produce this) ──

export interface CreateTaskInput {
  name: string;
  collection: string;
  chainKey: string;
  walletIds: string[];
  quantity: number;
  mintMode: MintMode;
  walletMode: WalletMode;
  maxFeeGwei?: number;
  maxPriorityGwei?: number;
  gasLimit?: number;
  rpcUrls?: string[];
  timingMode: TimingMode;
  customFireTime?: string | null;
  recipientAddress?: string | null;
  sponsorWalletId?: string | null;
  pricePerNft?: number | null;
  proxyGroup?: string | null;
  fundedOnly?: boolean;
  flashbots?: boolean;
  nonce?: number | null;
  fireTimestamp?: number | null;
  delayMs?: number;
  simulate?: boolean;
  spam?: boolean;
  action?: boolean;
  maxTx?: number | null;
  earlyFireMs?: number;
}

// ── Eligibility ──

export interface PublicDropInfo {
  mintPrice: string; // wei, decimal string
  startTime: number; // unix seconds
  endTime: number;
  maxTotalMintableByWallet: number;
}

export interface EligibilityWalletResult {
  address: string;
  eligible: boolean;
  reason: string;
}

export interface EligibilityReport {
  collection: string;
  chainKey: string;
  mode: 'public' | 'allowlist' | 'fcfs' | 'unknown';
  stageStart: string | null;
  stageEnd: string | null;
  /** Dev-provided stage display name from OpenSea (e.g. "Game WL", "Jacon List"). */
  stageName?: string | null;
  mintPrice: string | null; // ETH, decimal string
  maxPerWallet: number | null;
  wallets: EligibilityWalletResult[];
}

// ── Transfers (fund wallets / transfer NFTs) ──

export interface TransferResultEntry {
  address: string;
  txHash: string | null;
  status: 'success' | 'failed';
  detail?: string;
}

export interface TransferJobView {
  id: string;
  kind: 'fund' | 'transfer_nft' | 'disperse' | 'consolidate';
  chainKey: string;
  fromWalletAddress: string | null;
  recipientAddress: string | null;
  targetCount: number;
  amountEth: string | null;
  tokenContract: string | null;
  tokenSymbol: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  results: TransferResultEntry[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ── RPC endpoints ──

export interface RpcEndpointView {
  id: string;
  chainKey: string;
  label: string;
  url: string;
  provider: 'alchemy' | 'quicknode' | 'drpc' | 'custom';
  tier: 'free' | 'paid';
  lastLatencyMs: number | null;
  vpsLatencyMs: number | null;
  rpcLatencyMs: number | null;
  isDefault: boolean;
  createdAt: string;
}

// ── Wallet manager ──

export interface TokenBalance {
  symbol: string;
  address: string;
  decimals: number;
  balanceWei: string;
  balance: string;
}

export interface WalletBalanceView {
  id: string;
  address: string;
  label: string | null;
  chainId: number;
  chainKey: string;
  nativeSymbol: string;
  nativeBalanceWei: string;
  nativeBalance: string;
  tokens: TokenBalance[];
}

export interface DisperseEntry {
  address: string; // destination 0x address
  amountEth: string; // decimal ETH
}

export type ConsolidationMode = 'native' | 'erc20';

export interface ConsolidateInput {
  chainKey: string;
  mode: ConsolidationMode;
  tokenContract?: string; // required for erc20
  tokenSymbol?: string;
  fromWalletIds: string[]; // wallets to drain
  toAddress: string; // destination
}

export interface DisperseInput {
  chainKey: string;
  fromWalletId: string;
  entries: DisperseEntry[];
}

// ── Social automation ──

export type SocialPlatform = 'gmail' | 'x' | 'discord';

export type SocialActionType =
  | 'x_follow'
  | 'x_unfollow'
  | 'x_reply'
  | 'x_repost'
  | 'form_submit'
  | 'wallet_submit'
  | 'captcha_solve';

export interface SocialAccountView {
  id: string;
  platform: SocialPlatform;
  username: string;
  email: string | null;
  displayName: string | null;
  proxy: string | null;
  status: 'connected' | 'error' | 'disconnected';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SocialRunView {
  id: string;
  accountId: string | null;
  action: SocialActionType;
  proxy: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: unknown;
  result: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
