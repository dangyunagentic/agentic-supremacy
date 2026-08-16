FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app .
COPY . .
RUN pnpm --filter api prisma:generate && pnpm run build --filter=api...

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app .
RUN corepack enable && pnpm install --frozen-lockfile --prod && \
    apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
EXPOSE 3000
CMD ["node", "apps/api/dist/src/main.js"]
