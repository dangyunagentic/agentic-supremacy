# DESIGN.md — NFT Mint Automation Bot

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│                                                               │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │ Telegram │    │ Web Dashboard │    │ REST API          │  │
│  │ Bot      │    │ (Next.js 14)  │    │ (NestJS)          │  │
│  └────┬─────┘    └──────┬───────┘    └────────┬──────────┘  │
│       │                 │                      │              │
└───────┼─────────────────┼──────────────────────┼─────────────┘
        │                 │                      │
        ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                     API GATEWAY (NestJS)                     │
│                                                               │
│  Auth Guard → RBAC → Request Validation → Controller → Service│
│       │                                         │            │
│       ▼                                         ▼            │
│  ┌─────────┐    ┌───────────┐    ┌──────────┐  ┌────────┐  │
│  │ JWT     │    │ WebSocket │    │ Bot      │  │ Task   │  │
│  │ Passport│    │ Gateway   │    │ Service  │  │Service │  │
│  └─────────┘    └───────────┘    └──────────┘  └────┬───┘  │
│                                                      │       │
└──────────────────────────────────────────────────────┼───────┘
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION LAYER                            │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ BullMQ       │  │ Task Runner   │  │ Mint Engine        │  │
│  │ (Scheduler)  │  │ (Worker)      │  │ (ethers.js v6)     │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬─────────┘  │
│         │                │                     │             │
│         ▼                ▼                     ▼             │
│  ┌───────────┐    ┌──────────────┐    ┌───────────────────┐ │
│  │ Redis      │    │ Log Stream    │    │ RPC Blast         │ │
│  │ (Queue)    │    │ (Socket.io)   │    │ (Multi-endpoint)  │ │
│  └───────────┘    └──────────────┘    └───────────────────┘ │
└─────────────────────────────────────────────────────────────┘
        │                                              │
        ▼                                              ▼
┌──────────────┐                           ┌──────────────────┐
│ PostgreSQL   │                           │ EVM RPC Endpoints  │
│ (Prisma ORM) │                           │ (Multi-chain)     │
└──────────────┘                           └──────────────────┘
```

---

## 2. Tech Stack

### 2.1 Core

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| **Runtime** | Node.js | 20 LTS | LTS, native fetch, WebSocket built-in |
| **Language** | TypeScript | 5.4+ | Type safety; both reference repos are TS |
| **Backend framework** | NestJS | 10 | Modular DI, guards, pipes, WebSocket gateway; structured for scale |
| **Frontend framework** | Next.js | 14 (App Router) | SSR, RSC, file-based routing, API routes if needed |
| **UI library** | shadcn/ui + Tailwind CSS | latest | Clean, professional, composable; no lock-in |
| **Database** | PostgreSQL | 16 | Relational integrity for tasks/wallets/users; JSONB for audit metadata |
| **ORM** | Prisma | 5.10+ | Type-safe schema, migrations, excellent DX with NestJS |
| **Cache/Queue** | Redis | 7 | BullMQ job queue + Socket.io adapter + rate limiting |
| **Job queue** | BullMQ | 4 | Redis-backed; delayed jobs, priorities, retries, concurrency control |

### 2.2 Web3

| Layer | Technology | Why |
|-------|-----------|-----|
| **ethers.js** | v6.9+ | Same as nft-public-mint; `Contract`, `Interface`, `Wallet`, `JsonRpcProvider` |
| **SeaDrop ABI** | Inline ABI (from seadrop-public.ts) | `mintPublic`, `getPublicDrop`, `getAllowedFeeRecipients` |
| **SeaDrop address** | `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5` | Canonical singleton across all chains |

### 2.3 Infrastructure

| Component | Technology | Why |
|-----------|-----------|-----|
| **Telegram bot** | Telegraf 4 | Most mature Node.js Telegram framework; scenes for wizard flows |
| **WebSocket** | Socket.io | NestJS native gateway support; rooms per task for log streaming |
| **Auth** | Passport-JWT + bcrypt | Standard; NestJS has first-class Passport integration |
| **Validation** | class-validator + class-transformer | NestJS native DTO validation |
| **Encryption** | Node.js `crypto` (AES-256-GCM) | No extra deps; OS-level AES-NI acceleration |
| **Logging** | Pino | Fastest Node.js logger; structured JSON |
| **Testing** | Vitest + Supertest | Fast, modern; NestJS testing module compatible |
| **Containerization** | Docker + docker-compose | Single command dev/prod parity |

### 2.4 Frontend Libraries

| Library | Purpose |
|---------|---------|
| TanStack Query (React Query) | Server state, caching, optimistic updates |
| Zustand | Lightweight client state (auth, UI toggles) |
| recharts | Dashboard charts (success rate, gas tracker) |
| lucide-react | Icon set (matches shadcn/ui) |
| sonner | Toast notifications |
| date-fns | Date formatting (countdowns, timestamps) |

---

## 3. Project Structure

### 3.1 Monorepo Layout

```
agentic-supremacy/
├── apps/
│   ├── api/                    # NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── auth/           # JWT, Passport, guards
│   │   │   ├── users/          # User CRUD, RBAC
│   │   │   ├── wallets/        # Wallet CRUD, encryption
│   │   │   ├── tasks/          # Task CRUD, status management
│   │   │   ├── chains/         # Chain config
│   │   │   ├── admin/          # Admin-only endpoints
│   │   │   ├── config/         # System config
│   │   │   ├── bot/            # Telegraf bot module
│   │   │   ├── webhooks/       # Telegram webhook
│   │   │   └── websocket/      # Socket.io gateway
│   │   ├── test/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── Dockerfile
│   │   └── tsconfig.json
│   │
│   ├── web/                    # Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/            # App router pages
│   │   │   │   ├── (auth)/     # Login, register
│   │   │   │   ├── dashboard/  # User dashboard
│   │   │   │   ├── tasks/      # Task list + detail
│   │   │   │   ├── wallets/    # Wallet management
│   │   │   │   └── admin/      # Admin panel
│   │   │   ├── components/      # UI components
│   │   │   ├── hooks/          # React hooks
│   │   │   ├── lib/            # API client, utils
│   │   │   └── stores/         # Zustand stores
│   │   ├── Dockerfile
│   │   └── tsconfig.json
│   │
│   └── worker/                 # BullMQ task runner
│       ├── src/
│       │   ├── main.ts         # Worker bootstrap
│       │   ├── processors/     # Job processors
│       │   │   ├── mint.processor.ts
│       │   │   ├── preflight.processor.ts
│       │   │   └── receipt.processor.ts
│       │   └── mint-engine/    # Core mint logic
│       │       ├── seadrop-public.ts   # On-chain calldata builder
│       │       ├── seadrop-signed.ts   # WL/FCFS via OpenSea API
│       │       ├── rpc-blast.ts         # Multi-RPC tx dispatcher
│       │       ├── connection-warmer.ts  # TCP/TLS pre-warm
│       │       ├── timer.ts             # Precision countdown
│       │       └── receipt-poller.ts    # Tx receipt tracker
│       ├── Dockerfile
│       └── tsconfig.json
│
├── packages/
│   ├── shared/                 # Shared types, enums, utils
│   │   ├── src/
│   │   │   ├── types/
│   │   │   ├── enums/
│   │   │   ├── constants/      # Chain profiles, SeaDrop address, ABIs
│   │   │   └── utils/
│   │   └── tsconfig.json
│   │
│   └── config/                 # Shared configs
│       ├── eslint/
│       ├── tsconfig/
│       └── docker/
│
├── docker-compose.yml
├── package.json                # Workspaces root
└── turbo.json                  # Turborepo pipeline
```

### 3.2 Why Turborepo

- Parallel builds across `api`, `web`, `worker`
- Shared `packages/shared` consumed by all three apps without publishing
- Incremental builds — only rebuild what changed
- Single dev command: `turbo dev`

---

## 4. Database Schema (Prisma)

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  user
  admin
}

enum UserStatus {
  active
  suspended
}

model User {
  id           String       @id @default(uuid())
  telegramId   BigInt?      @unique
  username     String       @unique
  email        String       @unique
  passwordHash String
  role         Role         @default(user)
  status       UserStatus   @default(active)
  wallets      Wallet[]
  tasks        Task[]
  auditLogs    AuditLog[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@index([telegramId])
}

model Wallet {
  id            String   @id @default(uuid())
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  address       String   @unique
  encryptedKey  String
  label         String?
  chainId       Int      @default(1)
  createdAt     DateTime @default(now())

  @@index([userId])
}

enum MintMode {
  public
  allowlist
  fcfs
  auto
}

enum WalletMode {
  single
  self_funded
  sponsored
}

enum TimingMode {
  wait_for_stage
  fire_now
  custom_time
}

enum TaskStatus {
  draft
  scheduled
  pre_flight
  calldata
  pre_sign
  dispatching
  awaiting_receipt
  completed
  failed
  cancelled
}

model Task {
  id                String       @id @default(uuid())
  userId            String
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  name              String
  collection        String
  chainKey          String
  walletIds         String[]
  quantity          Int
  mintMode          MintMode     @default(auto)
  walletMode        WalletMode   @default(single)
  maxFeeGwei        Float
  maxPriorityGwei   Float
  gasLimit          Int          @default(250000)
  rpcUrls           String[]
  timingMode        TimingMode   @default(wait_for_stage)
  customFireTime    DateTime?
  recipientAddress  String?
  sponsorWalletId   String?
  status            TaskStatus   @default(draft)
  results           TaskResult[]
  logs              TaskLog[]
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  startedAt         DateTime?
  completedAt       DateTime?

  @@index([userId])
  @@index([status])
  @@index([chainKey])
}

enum WalletResultStatus {
  pending
  success
  reverted
  rejected
  timeout
}

model TaskResult {
  id            String           @id @default(uuid())
  taskId        String
  task          Task             @relation(fields: [taskId], references: [id], onDelete: Cascade)
  walletAddress String
  walletIndex   Int
  txHash        String?
  blockNumber   Int?
  status        WalletResultStatus @default(pending)
  gasUsed       Int?
  errorMessage  String?
  nftTokenIds   String[]
  createdAt     DateTime         @default(now())

  @@index([taskId])
}

enum LogLevel {
  info
  warn
  error
  success
}

model TaskLog {
  id          String   @id @default(uuid())
  taskId      String
  task        Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  level       LogLevel
  message     String
  walletIndex Int?
  timestamp   DateTime @default(now())

  @@index([taskId])
  @@index([level])
}

model Chain {
  id                Int      @id @default(autoincrement())
  key               String   @unique
  chainId           Int      @unique
  name              String
  explorer          String
  nativeSymbol      String
  publicRpcs        String[]
  defaultPrivateRpc String?
  seadropAddress    String   @default("0x00005EA00Ac477B1030CE78506496e8C2dE24bf5")
  isActive          Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model AuditLog {
  id          String   @id @default(uuid())
  adminId     String
  admin       User     @relation(fields: [adminId], references: [id])
  action      String
  targetType  String
  targetId    String
  metadata    Json
  createdAt   DateTime @default(now())

  @@index([adminId])
  @@index([createdAt])
}

model SystemConfig {
  id                    Int      @id @default(1)
  defaultGasLimit       Int      @default(250000)
  defaultMaxFeeGwei     Float    @default(2)
  defaultPriorityGwei   Float    @default(0.05)
  scheduleRefreshSec    Int      @default(600)
  txMaxAttempts         Int      @default(3)
  pendingTimeoutSec     Int      @default(20)
  receiptPollBaseMs     Int      @default(250)
  receiptPollMaxMs      Int      @default(2000)
  replacementBumpBps     Int      @default(11250)
  openseaApiKeyEnc      String?
  updatedAt             DateTime @updatedAt
}
```

---

## 5. Core Engine Design

### 5.1 Mint Engine Module

The mint engine is the heart of the worker. It ports the logic from both reference repos into a service-oriented architecture.

```
packages/worker/src/mint-engine/
├── seadrop-public.ts        ← Ported from nft-public-mint
├── seadrop-signed.ts       ← Ported from osnm-z (WL/FCFS path)
├── rpc-blast.ts            ← Ported from nft-public-mint
├── connection-warmer.ts    ← Ported from nft-public-mint
├── timer.ts                ← Ported from nft-public-mint
├── receipt-poller.ts       ← Ported from nft-public-mint
├── eligibility-checker.ts  ← Ported from osnm-z
├── opensea-api.ts          ← Ported from osnm-z
└── index.ts                ← Orchestrator
```

### 5.2 Execution Pipeline

```typescript
// mint.processor.ts — BullMQ job processor

import { Job } from 'bullmq';
import { MintEngine } from '../mint-engine';

@Processor('mint-tasks')
export class MintProcessor {
  constructor(
    private engine: MintEngine,
    private logService: LogService,
    private taskService: TaskService,
  ) {}

  @Process({ concurrency: 10 })
  async process(job: Job<TaskJobData>): Promise<void> {
    const { taskId } = job.data;
    const task = await this.taskService.findById(taskId);

    // ── Phase 1: Pre-flight ──
    await this.log(taskId, 'info', 'Pre-flight: resolving collection, validating RPC, checking balances');
    const chain = await this.engine.resolveChain(task.chainKey);
    const contract = await this.engine.resolveCollection(task.collection, chain);
    const wallets = await this.engine.loadWallets(task.walletIds);
    await this.engine.validateBalances(wallets, task, chain);
    await this.taskService.updateStatus(taskId, 'pre_flight');

    // ── Phase 2: Build calldata ──
    await this.log(taskId, 'info', 'Building calldata from on-chain SeaDrop state');
    const plan = await this.engine.buildMintPlan(contract, task.quantity, chain, task.mintMode);
    await this.taskService.updateStatus(taskId, 'calldata');

    // ── Phase 3: Pre-sign ──
    const targetStart = await this.engine.resolveStartTime(plan, task.timingMode, task.customFireTime);
    await this.log(taskId, 'info', `Pre-signing ${wallets.length} transaction(s)`);
    await this.engine.warmConnections(chain);
    const signed = await this.engine.signAll(wallets, plan, task, chain);
    await this.taskService.updateStatus(taskId, 'pre_sign');

    // ── Phase 4: Wait + Dispatch ──
    if (targetStart) {
      await this.log(taskId, 'info', `Waiting for stage open at ${targetStart.toISOString()}`);
      await this.engine.waitForMintTime(targetStart);
    }
    await this.taskService.updateStatus(taskId, 'dispatching');
    const dispatched = await this.engine.blastToAll(signed, chain);
    await this.log(taskId, 'success', `Dispatched ${dispatched.length} tx(s)`);

    // ── Phase 5: Receipts ──
    await this.taskService.updateStatus(taskId, 'awaiting_receipt');
    const results = await this.engine.collectReceipts(dispatched, chain);
    for (const r of results) {
      await this.taskService.saveResult(taskId, r);
      await this.log(taskId, r.status === 'success' ? 'success' : 'error',
        `[W${r.walletIndex}] ${r.walletAddress} ${r.status} tx: ${r.txHash}`,
        r.walletIndex);
    }

    // ── Phase 6: Forward NFTs (multi-wallet) ──
    if (task.walletMode !== 'single' && task.recipientAddress) {
      await this.engine.forwardNfts(results, task.recipientAddress, chain);
    }

    await this.taskService.updateStatus(taskId,
      results.every(r => r.status === 'success') ? 'completed' : 'failed');
  }
}
```

### 5.3 On-Chain Calldata Builder (Public Mint)

Directly adapted from `seadrop-public.ts`:

```typescript
// seadrop-public.ts

import { Contract, Interface, JsonRpcProvider, formatEther } from 'ethers';

export const SEADROP_ADDRESS = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';

const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719';

const PUBLIC_ABI = [
  'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable',
  'function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
  'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
];

const IFACE = new Interface(PUBLIC_ABI);

export interface PublicDrop {
  mintPrice: bigint;
  startTime: number;
  endTime: number;
  maxTotalMintableByWallet: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

export interface LocalMintPlan {
  to: string;
  data: string;
  value: bigint;
  drop: PublicDrop;
  feeRecipient: string;
}

export async function fetchPublicDrop(rpcUrl: string, nftContract: string): Promise<PublicDrop | null> {
  const provider = new JsonRpcProvider(rpcUrl);
  const seadrop = new Contract(SEADROP_ADDRESS, PUBLIC_ABI, provider);
  const raw = await seadrop.getPublicDrop(nftContract);
  const drop: PublicDrop = {
    mintPrice: BigInt(raw.mintPrice),
    startTime: Number(raw.startTime),
    endTime: Number(raw.endTime),
    maxTotalMintableByWallet: Number(raw.maxTotalMintableByWallet),
    feeBps: Number(raw.feeBps),
    restrictFeeRecipients: Boolean(raw.restrictFeeRecipients),
  };
  if (drop.startTime === 0 && drop.endTime === 0 && drop.maxTotalMintableByWallet === 0) return null;
  return drop;
}

export async function buildLocalMintPlan(rpcUrl: string, nftContract: string, quantity: number): Promise<LocalMintPlan | null> {
  const drop = await fetchPublicDrop(rpcUrl, nftContract);
  if (!drop) return null;
  const fee = await resolveFeeRecipient(rpcUrl, nftContract, drop.restrictFeeRecipients);
  if (!fee) return null;
  return {
    to: SEADROP_ADDRESS,
    data: encodeMintPublic(nftContract, fee.address, quantity),
    value: drop.mintPrice * BigInt(quantity),
    drop,
    feeRecipient: fee.address,
  };
}
```

### 5.4 RPC Blast Dispatcher

Directly adapted from `rpc-blast.ts`:

```typescript
// rpc-blast.ts

export interface PreparedBlast {
  txHash: string;
  body: string;
}

export function prepareBlast(rawTx: string): PreparedBlast {
  return {
    txHash: keccak256(rawTx),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: [rawTx],
      id: 1,
    }),
  };
}

export function blastToAll(
  prepared: PreparedBlast,
  endpoints: RpcEndpoint[],
): { txHash: string; responsePromise: Promise<BlastResult[]> } {
  const { txHash, body } = prepared;
  const firePromises = endpoints.map((ep) =>
    fetch(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );

  const responsePromise = Promise.allSettled(firePromises).then(async (settled) => {
    const results: BlastResult[] = [];
    for (let i = 0; i < settled.length; i++) {
      // ... parse response, extract txHash or error
    }
    return results;
  });

  return { txHash, responsePromise };
}
```

### 5.5 Precision Timer

Directly adapted from `timer.ts`:

```typescript
// timer.ts

export async function waitForMintTime(mintTime: Date, earlyFireMs = 0): Promise<void> {
  const fireTime = new Date(mintTime.getTime() - earlyFireMs);
  const diff = fireTime.getTime() - Date.now();

  if (diff <= 0) return;

  // Long wait: setTimeout-based
  if (diff > 10000) {
    await new Promise((r) => setTimeout(r, diff - 100));
  }

  // Spin-wait final milliseconds for sub-ms precision
  while (Date.now() < fireTime.getTime()) {
    // burns CPU but gives sub-ms precision — critical for competitive mints
  }
}
```

### 5.6 Allowlist/FCFS Path (OpenSea API)

Adapted from osnm-z's approach — fetches per-wallet mint actions from OpenSea's GraphQL:

```typescript
// seadrop-signed.ts

export async function fetchWalletMintAction(
  wallet: Wallet,
  collection: string,
  chain: ChainProfile,
  authToken: string,
): Promise<MintAction | null> {
  // Query OpenSea GraphQL for wallet-specific mint calldata
  // This requires an authenticated OpenSea session token per wallet
  // The action includes: target address, calldata, value, deadline
  const query = `
    query WalletMintAction($collection: String!, $chain: String!) {
      collection(slug: $collection, chain: $chain) {
        activeStage { ... on MintStage {
          actions { ... on WalletMintAction {
            target calldata value deadline
          }}
        }}
      }
    }`;

  // ... fetch and validate
}
```

### 5.7 Wallet Encryption

```typescript
// wallet-crypto.ts

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;

export function encryptPrivateKey(privateKey: string, masterKey: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(masterKey, salt, KEY_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

export function decryptPrivateKey(ciphertext: string, masterKey: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = scryptSync(masterKey, salt, KEY_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
```

---

## 6. API Design

### 6.1 Conventions

- Base URL: `/api/v1`
- Auth: `Authorization: Bearer <JWT>`
- Content-Type: `application/json`
- Errors: `{ error: { code: string, message: string, details?: any } }`
- Pagination: `?page=1&limit=20` → `{ data: [], meta: { page, limit, total, totalPages } }`
- Timestamps: ISO 8601 UTC

### 6.2 Task Creation Example

```
POST /api/v1/tasks
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "Bored Apes Public Mint",
  "collection": "0x1234567890abcdef1234567890abcdef12345678",
  "chain": "ethereum",
  "walletIds": ["uuid-1", "uuid-2", "uuid-3"],
  "quantity": 1,
  "mintMode": "auto",
  "walletMode": "self_funded",
  "maxFeeGwei": 80,
  "maxPriorityGwei": 5,
  "gasLimit": 250000,
  "rpcUrls": ["https://eth-mainnet.g.alchemy.com/v2/KEY"],
  "timingMode": "wait_for_stage",
  "recipientAddress": "0xabc...def"
}

Response: 201 Created
{
  "id": "task-uuid",
  "status": "scheduled",
  "createdAt": "2026-08-16T10:00:00Z"
}
```

### 6.3 WebSocket Events

```
Connection: ws://api/socket.io?task=<taskId>&token=<jwt>

Events (server → client):
  task:status      { taskId, status, timestamp }
  task:log         { taskId, level, message, walletIndex, timestamp }
  task:wallet      { taskId, walletIndex, address, status, txHash }
  task:complete    { taskId, summary: { total, success, failed } }

Events (client → server):
  join             { taskId }   // subscribe to task room
  leave            { taskId }
```

---

## 7. Frontend Design

### 7.1 Design Principles

| Principle | Implementation |
|-----------|---------------|
| Clean | Generous whitespace, limited color palette, no decorative elements |
| Professional | System font stack, monospace for addresses/tx hashes, subtle borders |
| Functional | Every element serves a purpose; no decorative animation |
| Responsive | Mobile-first; works on phone for bot users who need web fallback |
| Dark mode | Default dark; optional light toggle |

### 7.2 Color Palette

```
Dark theme (default):
  Background       #0a0a0a   (near-black)
  Surface          #141414   (cards, panels)
  Border           #262626   (subtle dividers)
  Text Primary     #fafafa   (high contrast)
  Text Secondary   #a3a3a3   (labels, hints)
  Text Muted       #525252   (timestamps)

  Accent           #3b82f6   (blue — primary actions)
  Success          #22c55e   (green — completed, success)
  Warning          #f59e0b   (amber — pending, caution)
  Danger           #ef4444   (red — failed, reverted)

Light theme (optional):
  Background       #ffffff
  Surface          #f8f9fa
  Border           #e5e7eb
  Text Primary     #111827
  Text Secondary   #6b7280
  (accents same as dark)
```

### 7.3 Typography

```
Font stack:      ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif
Monospace:       ui-monospace, SFMono-Regular, Menlo, Consolas, monospace

Headings:        600 weight, tracking-tight
Body:            400 weight, 15px base, 1.6 line-height
Labels:          500 weight, 12px, uppercase tracking-wide, text-secondary
Code/Address:    monospace, 13px, text-secondary
```

### 7.4 Page Layouts

```
Dashboard (User)
┌─────────────────────────────────────────────┐
│  Sidebar  │  Main Content                   │
│           │                                  │
│  ◉ Tasks  │  ┌──────────────────────────┐  │
│  ◉ Wallets│  │ Stats Cards               │  │
│  ◉ Profile│  │ [Active] [Completed] [Failed]│ │
│           │  └──────────────────────────┘  │
│  Admin:   │  ┌──────────────────────────┐  │
│  ◉ Users  │  │ Active Tasks Table         │  │
│  ◉ Chains │  │ Name | Chain | Status |   │  │
│  ◉ Config │  │ Countdown | Wallets       │  │
│  ◉ Logs   │  └──────────────────────────┘  │
└─────────────────────────────────────────────┘

Task Detail
┌─────────────────────────────────────────────┐
│  ← Back   Task: "Bored Apes Public Mint"    │
│            Status: ● DISPATCHING             │
│                                                     │
│  ┌─────────────┐  ┌──────────────────────┐ │
│  │ Config Panel  │  │ Live Log Stream       │ │
│  │ Chain: Eth    │  │ [10:00:01] Pre-flight  │ │
│  │ Wallets: 3    │  │ [10:00:02] Calldata   │ │
│  │ Qty: 1        │  │ [10:00:03] Pre-sign   │ │
│  │ Gas: 80/5     │  │ [10:00:04] Dispatched │ │
│  │ Timing: Wait  │  │ [W0] ✓ SUCCESS 0xhash│ │
│  └─────────────┘  │ [W1] ✓ SUCCESS 0xhash│ │
│                   │ [W2] ✗ REVERTED     │ │
│  ┌─────────────┐  └──────────────────────┘ │
│  │ Wallet Table  │                            │
│  │ W0 addr ✓ tx │                            │
│  │ W1 addr ✓ tx │                            │
│  │ W2 addr ✗ —  │                            │
│  └─────────────┘                            │
└─────────────────────────────────────────────┘
```

### 7.5 Component Library

Built on shadcn/ui with these custom compositions:

| Component | Purpose |
|-----------|---------|
| `TaskCard` | Compact task summary with status badge + countdown |
| `StatusBadge` | Color-coded: draft(gray), scheduled(blue), dispatching(amber pulse), success(green), failed(red) |
| `WalletRow` | Address (mono, truncated), balance, status icon |
| `LogStream` | Auto-scroll terminal-style log viewer with level colors |
| `GasGauge` | Visual: base fee vs max fee vs tip |
| `CountdownTimer` | MM:SS countdown with pulse animation < 10s |
| `TaskWizard` | Multi-step form: Collection → Wallets → Gas → Timing → Confirm |
| `ChainSelector` | Dropdown with chain icon + chain ID |
| `AddressDisplay` | Monospace, truncated, copy button, explorer link |

---

## 8. Security

### 8.1 Private Key Handling

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│ User Input   │────▶│ API (TLS)         │────▶│ Encrypt     │
│ (key paste)  │     │ In-memory only    │     │ AES-256-GCM │
└──────────────┘     │ Never logged      │     │ + scrypt    │
                     │ Never returned    │     └──────┬──────┘
                     └──────────────────┘            │
                                                       ▼
                     ┌──────────────────┐     ┌─────────────┐
                     │ Task Execution    │◀────│ Decrypt     │
                     │ In-memory only    │     │ (on demand) │
                     │ Zeroized after    │     └─────────────┘
                     │ completion        │
                     └──────────────────┘
```

**Rules:**
1. Private keys are encrypted before DB write — plaintext never touches disk
2. Decrypted only in the worker process during task execution
3. Worker holds key in memory; `zeroize()` buffer after tx is signed
4. API never returns `encrypted_key` field — only `address`
5. Master encryption key from environment variable (`MASTER_KEY`), rotated periodically
6. All API endpoints behind JWT auth + RBAC guard

### 8.2 Auth Flow

```
Register → bcrypt hash password → store user
Login    → verify bcrypt → issue JWT (15min access + 7d refresh)
API call → AuthGuard → validate JWT → attach user to request
RBAC     → @Roles decorator → RolesGuard checks user.role
```

### 8.3 Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `/auth/login` | 5/min per IP |
| `/auth/register` | 3/hour per IP |
| `/tasks` (POST) | 10/hour per user |
| All other API | 100/min per user |

---

## 9. Deployment (VPS)

### 9.1 VPS Requirements

| Spec | Minimum | This Project's VPS |
|------|---------|--------------------|
| CPU | 2 vCPU | 2 Core Xeon Platinum 8255C @ 2.50GHz |
| RAM | 3 GB | 3.6 GB (2.6 GB available) |
| Swap | 1 GB | 2 GB |
| Storage | 30 GB | 49 GB (32 GB free) |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04/24.04 LTS |
| Docker | 24+ | 26+ |
| Docker Compose | v2.20+ | v2.29+ |

All services run with memory limits totaling approximately 1.6 GB at the hard ceiling. Normal usage should be lower, leaving headroom for the OS, Docker, build operations, and the existing 2 GB swap.

| Service | Memory limit | Notes |
|---------|--------------|-------|
| PostgreSQL | 200 MB | Suitable for a small-to-medium task history |
| Redis | 300 MB | Redis data capped at 256 MB |
| NestJS API | 350 MB | Node heap capped at 256 MB |
| Worker | 350 MB | One worker instance initially |
| Next.js | 350 MB | Node heap capped at 256 MB |
| Caddy | 100 MB | Reverse proxy and TLS |
| **Total hard limit** | **1.65 GB** | Leaves room for OS and Docker |

For this VPS, run one worker instance. Add worker replicas only after monitoring RAM usage and confirming the VPS has enough headroom.

### 9.2 Architecture on VPS

```
Internet
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  Caddy (reverse proxy + auto HTTPS)                  │
│  mint.yourdomain.com  → localhost:3000 (Next.js)     │
│  api.yourdomain.com   → localhost:3001 (NestJS)       │
│  ws.yourdomain.com    → localhost:3001 (WebSocket)     │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│  Docker Compose (single VPS)                          │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ web      │  │ api      │  │ worker   │           │
│  │ :3000    │  │ :3001    │  │ (no port) │           │
│  │ Next.js  │  │ NestJS   │  │ BullMQ    │           │
│  └──────────┘  └────┬─────┘  └────┬─────┘           │
│                     │              │                   │
│              ┌──────┴──────────────┘                  │
│              ▼                                        │
│  ┌──────────┐  ┌──────────┐                           │
│  │ postgres │  │ redis    │                           │
│  │ :5432    │  │ :6379    │                           │
│  └──────────┘  └──────────┘                           │
└──────────────────────────────────────────────────────┘
```

**Why Caddy?** Automatic HTTPS via Let's Encrypt, single binary, zero config restart needed. Nginx is fine too but Caddy is one Caddyfile line per domain.

### 9.3 Docker Compose (Production)

```yaml
# docker-compose.prod.yml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-mintbot}
      POSTGRES_USER: ${DB_USER:-mintbot}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${DB_USER:-mintbot}']
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 200M
    networks:
      - internal

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction
    volumes:
      - redisdata:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 300M
    networks:
      - internal

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    env_file: .env.production
    environment:
      DATABASE_URL: postgresql://${DB_USER:-mintbot}:${DB_PASSWORD}@postgres:5432/${DB_NAME:-mintbot}
      REDIS_URL: redis://redis:6379
      NODE_OPTIONS: '--max-old-space-size=256'
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - '127.0.0.1:3001:3000'  # only localhost, Caddy proxies
    deploy:
      resources:
        limits:
          memory: 350M
    networks:
      - internal
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    restart: unless-stopped
    env_file: .env.production
    environment:
      DATABASE_URL: postgresql://${DB_USER:-mintbot}:${DB_PASSWORD}@postgres:5432/${DB_NAME:-mintbot}
      REDIS_URL: redis://redis:6379
      NODE_OPTIONS: '--max-old-space-size=256'
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 350M
    networks:
      - internal

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        NEXT_PUBLIC_API_URL: https://api.${DOMAIN}
    restart: unless-stopped
    environment:
      NODE_OPTIONS: '--max-old-space-size=256'
    depends_on:
      - api
    ports:
      - '127.0.0.1:3000:3000'  # only localhost, Caddy proxies
    deploy:
      resources:
        limits:
          memory: 350M
    networks:
      - internal

  # Caddy is lightweight; leave it without a strict limit for reliable TLS renewal.

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    deploy:
      resources:
        limits:
          memory: 100M
    networks:
      - internal
    depends_on:
      - web
      - api

networks:
  internal:

volumes:
  pgdata:
  redisdata:
  caddy_data:
  caddy_config:
```

### 9.4 Caddyfile

```
# Caddyfile — automatic HTTPS via Let's Encrypt

# Web dashboard
mint.{$DOMAIN} {
    reverse_proxy web:3000
}

# API + WebSocket
api.{$DOMAIN} {
    reverse_proxy api:3000
}

# Alternative: single domain with path-based routing
# {$DOMAIN} {
#     handle /api/* {
#         reverse_proxy api:3000
#     }
#     handle /socket.io/* {
#         reverse_proxy api:3000
#     }
#     handle {
#         reverse_proxy web:3000
#     }
# }
```

### 9.5 Environment Variables (.env.production)

```bash
# ── Domain ──
DOMAIN=yourdomain.com

# ── Database ──
DB_NAME=mintbot
DB_USER=mintbot
DB_PASSWORD=<strong-password>

# ── Redis ──
REDIS_URL=redis://redis:6379

# ── API ──
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://mintbot:<password>@postgres:5432/mintbot
JWT_SECRET=<64-char-hex>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
MASTER_KEY=<32-char-string>

# ── Telegram ──
TELEGRAM_BOT_TOKEN=<from-botfather>
TELEGRAM_WEBHOOK_URL=https://api.yourdomain.com/bot/webhook

# ── OpenSea (optional) ──
OPENSEA_API_KEY=

# ── Frontend ──
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

### 9.6 VPS Setup Script

```bash
#!/usr/bin/env bash
# scripts/vps-setup.sh — run on fresh Ubuntu VPS as root
set -euo pipefail

# ── System update ──
apt update && apt upgrade -y
apt install -y curl git ufw fail2ban

# ── Firewall ──
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# ── Docker ──
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# ── Project directory ──
mkdir -p /opt/mintbot
cd /opt/mintbot

# ── SSH key for deploy (add to GitHub as deploy key) ──
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
echo "Add this key to GitHub repo deploy keys:"
cat ~/.ssh/deploy_key.pub

# ── Clone repo ──
git clone git@github.com:youruser/agentic-supremacy.git .

# ── Create env file ──
cp .env.example .env.production
echo "Edit .env.production before starting:"
echo "  nano .env.production"

# ── Start everything ──
docker compose -f docker-compose.prod.yml up -d --build

echo "Done. Caddy will provision SSL automatically."
```

### 9.7 Deploy Script (from local machine)

```bash
#!/usr/bin/env bash
# scripts/deploy.sh — run from local machine
set -euo pipefail

VPS_IP=${1:?'Usage: ./deploy.sh <vps-ip>'}
REMOTE_DIR=/opt/mintbot

echo "Deploying to $VPS_IP:$REMOTE_DIR ..."

# ── Push code to VPS ──
rsync -avz --exclude node_modules --exclude .git --exclude dist \
  ./ "$VPS_IP:$REMOTE_DIR/"

# ── Rebuild and restart ──
ssh "$VPS_IP" bash -c "
  cd $REMOTE_DIR
  docker compose -f docker-compose.prod.yml up -d --build
  docker image prune -f
"

echo "Deployed."
```

### 9.8 Useful Management Commands

```bash
# View logs (all services)
ssh root@vps 'cd /opt/mintbot && docker compose -f docker-compose.prod.yml logs -f'

# View logs (single service)
ssh root@vps 'cd /opt/mintbot && docker compose -f docker-compose.prod.yml logs -f api'
ssh root@vps 'cd /opt/mintbot && docker compose -f docker-compose.prod.yml logs -f worker'

# Restart a service
ssh root@vps 'cd /opt/mintbot && docker compose -f docker-compose.prod.yml restart api'

# Run Prisma migrate
ssh root@vps 'cd /opt/mintbot && docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy'

# Backup database
ssh root@vps 'docker exec mintbot-postgres pg_dump -U mintbot mintbot' > backup_$(date +%Y%m%d).sql

# Restore database
cat backup.sql | ssh root@vps 'docker exec -i mintbot-postgres psql -U mintbot mintbot'

# Scale workers only after checking available RAM
ssh root@vps 'free -h && cd /opt/mintbot && docker compose -f docker-compose.prod.yml up -d --scale worker=2'

# Check service status
ssh root@vps 'cd /opt/mintbot && docker compose -f docker-compose.prod.yml ps'

# Caddy logs (SSL troubleshooting)
ssh root@vps 'cd /opt/mintbot && docker compose -f docker-compose.prod.yml logs -f caddy'
```

### 9.9 Dockerfiles

```dockerfile
# apps/api/Dockerfile
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app .
COPY . .
RUN pnpm run build --filter=api...

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app .
RUN corepack enable && pnpm install --frozen-lockfile --prod
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
```

```dockerfile
# apps/worker/Dockerfile
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app .
COPY . .
RUN pnpm run build --filter=worker...

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app .
RUN corepack enable && pnpm install --frozen-lockfile --prod
CMD ["node", "apps/worker/dist/main.js"]
```

```dockerfile
# apps/web/Dockerfile
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY --from=deps /app .
COPY . .
RUN pnpm run build --filter=web...

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app .
RUN corepack enable && pnpm install --frozen-lockfile --prod
EXPOSE 3000
CMD ["node", "apps/web/.next/standalone/server.js"]
```

### 9.10 Estimated Cost

| Component | Cost |
|-----------|------|
| VPS (4 vCPU, 8GB RAM) | $6-12/month (Hetzner, Contabo, OVH) |
| Domain | $10/year |
| SSL | Free (Caddy + Let's Encrypt) |
| PostgreSQL | Included (Docker) |
| Redis | Included (Docker) |
| **Total** | **~$7-13/month** |

---

## 10. Testing Strategy

| Level | Tool | Coverage |
|-------|------|----------|
| Unit | Vitest | Mint engine functions, encryption, utils |
| Integration | Vitest + Supertest | API endpoints with test DB |
| E2E | Playwright | Web dashboard flows |
| Contract | Vitest + local node | SeaDrop calldata against forked mainnet |

### Key Test Cases

```
Mint Engine:
  ✓ buildLocalMintPlan — returns correct calldata for known contract
  ✓ fetchPublicDrop — returns null for non-SeaDrop contract
  ✓ resolveFeeRecipient — uses allowed list when restricted
  ✓ prepareBlast — computes correct txHash from rawTx
  ✓ blastToAll — dispatches to all endpoints in parallel
  ✓ waitForMintTime — fires within 1ms of target

Wallet Crypto:
  ✓ encrypt → decrypt round-trip recovers original key
  ✓ decrypt with wrong master key throws
  ✓ ciphertext is non-deterministic (random IV/salt)

API:
  ✓ POST /tasks — creates task with valid config
  ✓ POST /tasks — rejects missing required fields
  ✓ GET /tasks — user sees only own tasks
  ✓ GET /tasks — admin sees all tasks
  ✓ DELETE /wallets/:id — user can delete own, not others'
```
