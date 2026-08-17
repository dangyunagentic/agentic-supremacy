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
RUN pnpm --filter worker prisma:generate && pnpm run build --filter=worker...
# Slim production install (worker + prod workspace deps only, no dev tools)
RUN pnpm --filter worker deploy --prod /out
# Regenerate Prisma client into the deployed node_modules so the native engine ships
COPY apps/api/prisma /out/prisma
RUN pnpm --filter worker exec prisma generate --schema=/out/prisma/schema.prisma

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /out ./
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN rm -rf src tsconfig.json Dockerfile

CMD ["node", "dist/main.js"]
