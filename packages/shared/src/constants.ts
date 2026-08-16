// Chain profiles mirrored from the reference engine. Adding a network is a
// single entry here (plus a row in the chains table once the admin creates it).

export interface ChainProfile {
  key: string;
  chainId: number;
  name: string;
  explorer: string;
  nativeSymbol: string;
  rpc: {
    public: string[];
    defaultPrivate?: string;
  };
  seadropAddress: string;
}

export const SEADROP_ADDRESS = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
export const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719';

export const CHAIN_PROFILES: Record<string, ChainProfile> = {
  ethereum: {
    key: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    explorer: 'https://etherscan.io',
    nativeSymbol: 'ETH',
    rpc: {
      public: [
        'https://ethereum-rpc.publicnode.com',
        'https://eth.merkle.io',
        'https://cloudflare-eth.com',
      ],
      defaultPrivate: 'https://eth-mainnet.g.alchemy.com/v2/{ALCHEMY_KEY}',
    },
    seadropAddress: SEADROP_ADDRESS,
  },
  base: {
    key: 'base',
    chainId: 8453,
    name: 'Base',
    explorer: 'https://basescan.org',
    nativeSymbol: 'ETH',
    rpc: {
      public: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    },
    seadropAddress: SEADROP_ADDRESS,
  },
  robinhood: {
    key: 'robinhood',
    chainId: 4663,
    name: 'Robinhood Chain',
    explorer: 'https://robinhoodchain.blockscout.com',
    nativeSymbol: 'ETH',
    rpc: {
      public: ['https://rpc.mainnet.chain.robinhood.com'],
    },
    seadropAddress: SEADROP_ADDRESS,
  },
};

export function getChainProfile(key: string): ChainProfile | undefined {
  return CHAIN_PROFILES[key.toLowerCase()];
}

export function findChainKeyById(chainId: number): string | undefined {
  return Object.values(CHAIN_PROFILES).find((c) => c.chainId === chainId)?.key;
}

// ── BullMQ ──
export const QUEUES = {
  PREFLIGHT: 'preflight',
  MINT: 'mint-tasks',
  RECEIPT: 'receipt',
  TRANSFERS: 'transfers',
} as const;

// ── Redis pub/sub channel for worker -> api realtime events ──
export const TASK_EVENTS_CHANNEL = 'task:events';

// ── WebSocket event names (server -> client) ──
export const WS_EVENTS = {
  STATUS: 'task:status',
  LOG: 'task:log',
  WALLET: 'task:wallet',
  COMPLETE: 'task:complete',
  JOIN: 'join',
  LEAVE: 'leave',
} as const;

// ── Engine defaults (mirrored from SystemConfig) ──
export const ENGINE_DEFAULTS = {
  defaultGasLimit: 250_000,
  defaultMaxFeeGwei: 2,
  defaultPriorityGwei: 0.05,
  scheduleRefreshSec: 600,
  txMaxAttempts: 3,
  pendingTimeoutSec: 20,
  receiptPollBaseMs: 250,
  receiptPollMaxMs: 2000,
  replacementBumpBps: 11_250,
} as const;

export const PRE_FLIGHT_LEAD_MS = 60_000; // T-60s
export const PRE_SIGN_LEAD_MS = 10_000; // T-10s

// Max wallets per task, by wallet mode (from the PRD).
export const MAX_WALLETS_PER_TASK: Record<string, number> = {
  single: 1,
  self_funded: 10,
  sponsored: 25,
};
