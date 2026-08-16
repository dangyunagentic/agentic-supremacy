# PRD — NFT Mint Automation Bot

## 1. Overview

A web-based NFT mint automation platform that lets users create, schedule, and execute SeaDrop NFT mint tasks across multiple EVM chains. The system wraps the core mint logic from [osnm-z](https://github.com/zunmax/osnm-z) (multi-wallet, allowlist/FCFS/public phases, EIP-7702 sponsored mode) and [nft-public-mint](https://github.com/morsyxbt/nft-public-mint) (on-chain calldata construction, pre-signed tx blasting, multi-RPC dispatch) behind a Telegram bot and web dashboard.

**Two roles:**
- **User** — create and monitor their own mint tasks, manage their own wallets
- **Admin** — everything a user can do, plus manage all users, wallets, system config, and global settings

---

## 2. Problem Statement

NFT minting on OpenSea SeaDrop is competitive. Manual minting loses to bots that pre-sign transactions and blast to multiple RPCs at T-0. Existing CLI tools (osnm-z, nft-public-mint) are powerful but require terminal knowledge, manual key entry, and constant supervision. This platform wraps that logic into an accessible bot + dashboard where users configure tasks once and the system executes automatically.

---

## 3. Goals

| # | Goal | Success Metric |
|---|------|----------------|
| G1 | Let users create mint tasks via bot or dashboard | Task creation < 60s end-to-end |
| G2 | Execute public mints with on-chain calldata (no OpenSea token needed) | Tx dispatched within 50ms of stage open |
| G3 | Support multi-wallet concurrent minting | Up to 10 self-funded or 25 sponsored wallets per task |
| G4 | Support allowlist/FCFS phases via OpenSea API | WL mints complete when stage is active |
| G5 | Admin can manage all users, wallets, and system config | Full CRUD on all entities |

---

## 4. Roles & Permissions

### 4.1 User

| Capability | Description |
|------------|-------------|
| Create mint task | Configure target collection, chain, wallets, quantity, gas, timing |
| Manage own wallets | Add/remove/import private keys (encrypted at rest) |
| View task status | Real-time execution logs, tx hashes, receipt status |
| View task history | Past tasks with success/fail/revert outcomes |
| Stop/cancel task | Abort a scheduled or in-progress task before broadcast |
| Manage own profile | Change display name, notification preferences |

### 4.2 Admin

| Capability | Description |
|------------|-------------|
| All user capabilities | Everything a user can do |
| Manage users | Create, suspend, delete users; reset passwords; change roles |
| Manage all wallets | View/import/remove wallets across all users |
| Manage chains | Add/remove/edit supported EVM chains (RPC, explorer, chain ID) |
| Manage system config | Global gas defaults, RPC fallbacks, scheduling intervals |
| View system dashboard | Aggregate stats: total tasks, success rate, active tasks, total minted |
| View all tasks | Monitor any user's task in real-time |
| Force-stop any task | Admin override to cancel any running task |
| View audit log | All admin actions and user activities |

---

## 5. Core Features

### 5.1 Mint Task Creation

A mint task is the central unit. Users configure:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | User-facing label for the task |
| `collection` | string | OpenSea slug, collection URL, or `0x` contract address |
| `chain` | enum | `ethereum` \| `base` \| `robinhood` (extensible) |
| `wallet_ids` | array | Selected wallet IDs from user's wallet pool |
| `quantity` | integer | NFTs per wallet |
| `mint_mode` | enum | `public` \| `allowlist` \| `fcfs` \| `auto` |
| `wallet_mode` | enum | `single` \| `self_funded` \| `sponsored` |
| `max_fee_per_gas_gwei` | float | Gas ceiling (gwei) |
| `max_priority_fee_gwei` | float | Priority tip (gwei) |
| `gas_limit` | integer | Gas limit per mint tx (default 250000) |
| `rpc_urls` | string[] | Custom RPC endpoints (optional; falls back to chain defaults) |
| `timing` | enum | `wait_for_stage` \| `fire_now` \| `custom_time` |
| `custom_fire_time` | datetime | When timing = `custom_time` |
| `recipient_address` | address | Where minted NFTs are forwarded (multi-wallet mode) |
| `sponsor_key_id` | wallet ID | Sponsor wallet for EIP-7702 mode (optional) |

**Mint mode resolution (`auto`):**
1. Query SeaDrop `getPublicDrop()` — if active, use `public` mode
2. Query OpenSea eligibility — if wallet is allowlisted, use `allowlist`
3. Fall back to `fcfs` if stage is FCFS

### 5.2 Wallet Management

| Action | User | Admin |
|--------|------|-------|
| Generate new wallet | Own | Own + any user's |
| Import private key | Own | Own + any user's |
| List wallets | Own | All |
| Delete wallet | Own | Own + any user's |
| Check balance | Own | Any |
| Fund wallet | Own (sponsored mode only) | Any |

Private keys are:
- Encrypted at rest with AES-256-GCM
- Held in memory only during task execution
- Never logged, never returned by API (only address shown)

### 5.3 Task Execution Flow

```
Task Created
    │
    ▼
┌─────────────────────────────────┐
│  PHASE 1: Pre-flight (T-60s)    │
│  • Resolve collection → address  │
│  • Validate chain RPC            │
│  • Check wallet balances         │
│  • Fetch drop config on-chain   │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  PHASE 2: Calldata (T-15s)     │
│  • PUBLIC: build from chain     │
│    (mintPublic calldata, no     │
│    OpenSea token needed)        │
│  • WL/FCFS: fetch from OpenSea  │
│    GraphQL per-wallet actions   │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  PHASE 3: Pre-sign (T-10s)      │
│  • Capture nonces               │
│  • Warm RPC connections          │
│  • Sign all transactions        │
│  • Compute tx hashes locally    │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  PHASE 4: Dispatch (T-0)        │
│  • Blast signed txs to all     │
│    RPC endpoints in parallel    │
│  • Fire-and-forget dispatch     │
│  • Sub-ms per-wallet dispatch   │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  PHASE 5: Receipt (T+30s)       │
│  • Poll for tx receipts         │
│  • Extract minted NFT assets    │
│  • Forward NFTs to recipient    │
│    (multi-wallet mode)          │
│  • Record final status          │
└─────────────────────────────────┘
```

### 5.4 Task Result Output

Each completed task produces a result record:

```
Task: "Bored Apes Public Mint"
Status: COMPLETED
Chain: Ethereum (1)
Collection: 0x1234...abcd
Wallets: 3
Quantity: 1 per wallet

Results:
  [W0] 0xabc...def  ✓ SUCCESS  tx: 0xhash1  block: 18923456  gas: 134,200
  [W1] 0xghi...jkl  ✓ SUCCESS  tx: 0xhash2  block: 18923456  gas: 135,100
  [W2] 0xmnop...rst ✗ REVERTED  tx: 0xhash3  reason: NotActive

Summary: 2/3 minted successfully
NFTs forwarded to: 0xrecipient...addr
```

### 5.5 Real-time Monitoring

- Live execution log stream (WebSocket) per task
- Gas tracker showing current base fee vs configured ceiling
- Countdown timer for scheduled tasks
- Per-wallet status badges: `pending` → `signed` → `dispatched` → `success` / `reverted` / `rejected`
- Transaction hash links to block explorer

### 5.6 Chain Management (Admin)

```typescript
interface ChainConfig {
  key: string;           // "ethereum" | "base" | "robinhood" | custom
  chainId: number;       // EVM chain ID
  name: string;          // Display name
  explorer: string;      // Block explorer base URL
  nativeSymbol: string;  // "ETH"
  rpc: {
    public: string[];      // Public RPC endpoints
    defaultPrivate?: string; // Default private RPC (Alchemy host)
  };
  seadropAddress: string; // Always 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
}
```

### 5.7 Notification System

Users receive notifications via:
- **Telegram bot** — task created, task starting (T-60s), task dispatched, task completed
- **Web dashboard** — in-app toast notifications
- **Optional email** — daily digest of task results

---

## 6. Bot Commands (Telegram)

### User Commands

| Command | Description |
|---------|-------------|
| `/start` | Register account, link Telegram to web account |
| `/tasks` | List my tasks (active + recent) |
| `/newtask` | Start interactive task creation wizard |
| `/task <id>` | View task detail & live status |
| `/stop <id>` | Cancel a scheduled/running task |
| `/wallets` | List my wallets (addresses only) |
| `/addwallet` | Generate or import a wallet |
| `/balance` | Check native balance for all wallets |
| `/help` | Show command list |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/users` | List all users |
| `/suspend <user_id>` | Suspend a user |
| `/stats` | System-wide statistics |
| `/active` | Show all currently running tasks |
| `/chains` | List configured chains |

---

## 7. API Endpoints

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/auth/telegram` | Link Telegram to account |
| GET | `/api/auth/me` | Current user profile |

### Tasks

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/tasks` | user+ | List tasks (users see own, admins see all) |
| POST | `/api/tasks` | user+ | Create a mint task |
| GET | `/api/tasks/:id` | user+ | Get task detail |
| POST | `/api/tasks/:id/stop` | user+ | Stop a task |
| GET | `/api/tasks/:id/logs` | user+ | Get execution logs |
| WS | `/api/tasks/:id/stream` | user+ | Live log stream |

### Wallets

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/wallets` | user+ | List wallets (own or all) |
| POST | `/api/wallets` | user+ | Generate or import wallet |
| DELETE | `/api/wallets/:id` | user+ | Remove wallet |
| GET | `/api/wallets/:id/balance` | user+ | Check balance |

### Admin

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | admin | List all users |
| POST | `/api/admin/users` | admin | Create user |
| PATCH | `/api/admin/users/:id` | admin | Update user (role, suspend) |
| DELETE | `/api/admin/users/:id` | admin | Delete user |
| GET | `/api/admin/stats` | admin | Aggregate dashboard stats |
| GET | `/api/admin/audit-log` | admin | Audit log entries |
| GET | `/api/admin/chains` | admin | List chains |
| POST | `/api/admin/chains` | admin | Add chain |
| PATCH | `/api/admin/chains/:id` | admin | Update chain |
| DELETE | `/api/admin/chains/:id` | admin | Remove chain |
| GET | `/api/admin/config` | admin | Global system config |
| PATCH | `/api/admin/config` | admin | Update system config |

---

## 8. Data Model

### User
```
id            UUID PK
telegram_id   BIGINT UNIQUE
username      VARCHAR
email         VARCHAR UNIQUE
password_hash VARCHAR
role          ENUM(user, admin)
status        ENUM(active, suspended)
created_at    TIMESTAMP
updated_at    TIMESTAMP
```

### Wallet
```
id             UUID PK
user_id        UUID FK → users
address        VARCHAR(42) UNIQUE
encrypted_key  TEXT          -- AES-256-GCM ciphertext
label          VARCHAR
chain_id       INT           -- preferred chain
created_at     TIMESTAMP
```

### Task
```
id               UUID PK
user_id          UUID FK → users
name             VARCHAR
collection       VARCHAR
chain_key        VARCHAR
wallet_ids       UUID[]
quantity         INT
mint_mode        ENUM(public, allowlist, fcfs, auto)
wallet_mode      ENUM(single, self_funded, sponsored)
max_fee_gwei     FLOAT
max_priority_gwei FLOAT
gas_limit        INT
rpc_urls         TEXT[]
timing_mode      ENUM(wait_for_stage, fire_now, custom_time)
custom_fire_time TIMESTAMP
recipient_address VARCHAR(42)
sponsor_wallet_id UUID NULLABLE
status           ENUM(draft, scheduled, pre_flight, calldata, pre_sign,
                      dispatching, awaiting_receipt, completed, failed,
                      cancelled)
created_at       TIMESTAMP
updated_at       TIMESTAMP
started_at       TIMESTAMP NULLABLE
completed_at     TIMESTAMP NULLABLE
```

### TaskResult
```
id              UUID PK
task_id         UUID FK → tasks
wallet_address  VARCHAR(42)
wallet_index    INT
tx_hash         VARCHAR NULLABLE
block_number    INT NULLABLE
status          ENUM(success, reverted, rejected, timeout, pending)
gas_used        INT NULLABLE
error_message   TEXT NULLABLE
nft_token_ids   TEXT[] NULLABLE
created_at      TIMESTAMP
```

### TaskLog
```
id          UUID PK
task_id     UUID FK → tasks
level       ENUM(info, warn, error, success)
message     TEXT
wallet_index INT NULLABLE
timestamp   TIMESTAMP
```

### Chain
```
id            SERIAL PK
key           VARCHAR UNIQUE
chain_id      INT
name          VARCHAR
explorer      VARCHAR
native_symbol VARCHAR
public_rpcs   TEXT[]
default_private_rpc VARCHAR NULLABLE
seadrop_address VARCHAR
is_active     BOOLEAN
created_at    TIMESTAMP
```

### AuditLog
```
id           UUID PK
admin_id     UUID FK → users
action       VARCHAR
target_type  VARCHAR
target_id    VARCHAR
metadata     JSONB
created_at   TIMESTAMP
```

### SystemConfig
```
id                    SERIAL PK
default_gas_limit     INT
default_max_fee_gwei  FLOAT
default_priority_gwei FLOAT
schedule_refresh_sec  INT
tx_max_attempts       INT
pending_timeout_sec   INT
receipt_poll_base_ms  INT
receipt_poll_max_ms   INT
replacement_bump_bps  INT
opensea_api_key       TEXT NULLABLE  -- encrypted
updated_at            TIMESTAMP
```

---

## 9. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Security | Private keys encrypted at rest (AES-256-GCM); never returned by API; memory-only during execution |
| Security | JWT auth with refresh tokens; rate limiting on auth endpoints |
| Performance | Task dispatch < 50ms after stage open; pre-sign all txs before T-0 |
| Performance | Support 50 concurrent tasks across all users |
| Reliability | Multi-RPC fallback; auto-retry transient failures up to 3 attempts |
| Scalability | Task execution engine is stateless per-task; horizontal scaling via job queue |
| Auditability | All admin actions logged; all task execution steps logged |
| Compatibility | Cross-platform: runs on Windows, Linux, macOS |

---

## 10. Tech Stack (Summary)

Full details in [DESIGN.md](./DESIGN.md). Key choices:

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | TypeScript (Node.js 20) | Both reference repos use TS; ethers.js ecosystem; fast development |
| Framework | NestJS (backend) + Next.js 14 (frontend) | NestJS for structured backend; Next.js for SSR dashboard |
| Database | PostgreSQL | Relational integrity for tasks/wallets/users |
| ORM | Prisma | Type-safe, migrations, excellent DX |
| Queue | BullMQ (Redis) | Task scheduling and job processing |
| WebSocket | Socket.io | Real-time task log streaming |
| Bot | Telegraf | Mature Telegram bot framework for Node.js |
| Web3 | ethers.js v6 | Same library as nft-public-mint; on-chain reads, tx signing |
| Auth | JWT + Passport | Standard, well-supported |

---

## 11. Milestones

| Phase | Deliverables | Duration |
|-------|-------------|----------|
| M1 | Project scaffold, auth system, user/admin RBAC | 1 week |
| M2 | Wallet management (CRUD, encryption, balance check) | 3 days |
| M3 | Chain config, SeaDrop on-chain reads, task creation | 1 week |
| M4 | Task execution engine (public mint path) | 1.5 weeks |
| M5 | Multi-wallet mode, sponsored mode (EIP-7702) | 1 week |
| M6 | Allowlist/FCFS path via OpenSea API | 4 days |
| M7 | Telegram bot (commands + notifications) | 1 week |
| M8 | Web dashboard (task list, detail, live monitor) | 1.5 weeks |
| M9 | Admin panel (users, chains, config, audit log) | 1 week |
| M10 | Testing, hardening, deployment | 1 week |

---

## 12. Open Questions

| # | Question |
|---|----------|
| Q1 | Should the platform support non-SeaDrop mint contracts (e.g., ERC-721A direct mint)? |
| Q2 | Should there be a credit/billing system for per-user resource limits? |
| Q3 | Should the Telegram bot support inline task creation (conversation flow) or redirect to web dashboard? |
| Q4 | Should we support EIP-7702 sponsored mode given its experimental nature and chain compatibility requirements? |
