# Mintbot - NFT Mint Automation Platform

Web platform + Telegram bot + execution engine for SeaDrop NFT mints across EVM
chains. Wraps the logic of
[nft-public-mint](https://github.com/morsyxbt/nft-public-mint) (on-chain
calldata, pre-signed blasting, multi-RPC dispatch) and
[osnm-z](https://github.com/zunmax/osnm-z) (multi-wallet, allowlist/FCFS via
OpenSea, NFT forwarding) behind a dashboard and task queue.

## Stack

| Layer      | Technology                                          |
| ---------- | --------------------------------------------------- |
| Backend    | NestJS 10, Prisma, PostgreSQL 16, BullMQ + Redis    |
| Engine     | ethers.js v6, fire-and-forget multi-RPC blasting    |
| Frontend   | Next.js 14 (App Router), Tailwind CSS v4, shadcn-style UI |
| Realtime   | Socket.io (Redis pub/sub bridge from the worker)    |
| Bot        | Telegraf 4                                          |
| Deploy     | Docker Compose + Caddy (auto HTTPS)                 |

## Monorepo layout

```
apps/
  api/       NestJS REST + WebSocket + Telegram bot (clean architecture)
  worker/    BullMQ processors + the mint engine (ported reference logic)
  web/       Next.js dashboard (dark theme, task wizard, live logs)
packages/
  shared/    Enums, types, chain profiles, SeaDrop constants, utils
```

### Clean architecture (apps/api)

```
src/
  domain/         Entities, repository interfaces, ports, injection tokens
  application/    Use cases per feature (auth, wallets, tasks, admin)
  infrastructure/ Prisma repositories, bcrypt/JWT/AES-GCM, BullMQ, Redis,
                  Socket.io gateway, Telegraf bot
  presentation/   Controllers, DTOs, guards, exception filter
```

Dependency direction: `presentation -> application -> domain`;
`infrastructure` implements domain ports and is bound to tokens in the
composition root (`app.module.ts`).

## Getting started (development)

Requirements: Node 20+, pnpm 9, Docker (for Postgres/Redis).

```bash
# 1. Install pnpm if missing
npm install -g pnpm@9

# 2. Install dependencies
pnpm install

# 3. Start infrastructure
docker compose -f docker-compose.dev.yml up -d

# 4. Configure environment
cp .env.example .env   # then edit secrets

# 5. Database
pnpm db:generate       # prisma client
pnpm db:migrate        # create schema
pnpm db:seed           # admin user + chains + system config

# 6. Run everything
pnpm dev               # api :3001, web :3000, worker via turbo
```

Default admin credentials come from `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

## Production (single VPS)

```bash
# On a fresh Ubuntu VPS
./scripts/vps-setup.sh

# From your machine
./scripts/deploy.sh <vps-ip>
```

Services (with memory limits): postgres 200M, redis 300M, api 350M, worker
350M, web 350M, caddy 100M. Caddy fronts `mint.<domain>` (dashboard) and
`api.<domain>` (REST + WebSocket) with automatic TLS.

## How execution works

1. **Create task** via dashboard wizard or Telegram -> `scheduled`.
2. **Pre-flight (T-60s)**: resolves the fire time from on-chain
   `getPublicDrop()` or the OpenSea stage, validates RPC + chain id.
3. **Mint (T-10s)**: builds calldata locally (public) or fetches per-wallet
   signed actions (allowlist/FCFS), validates upfront balances
   (`gasLimit x maxFee + mint price`), warms RPC connections, pre-signs every
   transaction.
4. **T-0**: blasts signed txs to every RPC endpoint in parallel
   (fire-and-forget, local keccak as the canonical hash).
5. **Receipt**: polls with exponential backoff, records per-wallet outcomes,
   forwards minted NFTs to the recipient when configured.

All phases stream logs to the dashboard over Socket.io and send Telegram
notifications on task creation and completion.

## Security notes

- Private keys are AES-256-GCM encrypted (scrypt-derived key) before hitting
  the database; plaintext exists only in worker memory during signing.
- JWT access (15 min) + refresh (7 days); RBAC via roles guard.
- Rate limiting on auth endpoints (login 5/min, register 3/hour).
- The OpenSea API key is stored encrypted and never returned by the API.
