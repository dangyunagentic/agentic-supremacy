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

// Max wallets per task, by wallet mode. Self-funded & sponsored are unlimited.
// `Infinity` keeps the `walletIds.length > limit` guard inert while still being
// a valid number for the `Record<string, number>` shape.
export const MAX_WALLETS_PER_TASK: Record<string, number> = {
  single: 1,
  self_funded: Infinity,
  sponsored: Infinity,
};

// ── Wallet manager: tracked ERC-20 tokens per chain (native + stablecoins) ──
export interface TrackedToken {
  symbol: string;
  address: string;
  decimals: number;
}

// Native token is always tracked (represented by address '0x0000...0000').
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

export const TRACKED_TOKENS: Record<string, TrackedToken[]> = {
  ethereum: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  ],
  base: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
  polygon: [
    { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'WETH', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
  ],
  arbitrum: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
  ],
  optimism: [
    { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
};
