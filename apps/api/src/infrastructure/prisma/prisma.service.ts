import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrismaService');
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor() {
    super({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
  }

  async onModuleInit() {
    await this.$connect();
    // Periodically remove expired / long-revoked refresh tokens so the table
    // does not grow unbounded. Runs hourly, fire-and-forget.
    if (process.env.NODE_ENV === 'production') {
      this.pruneTimer = setInterval(() => {
        void this.refreshToken
          .deleteMany({
            where: {
              OR: [
                { expiresAt: { lt: new Date() } },
                {
                  revokedAt: {
                    lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                  },
                },
              ],
            },
          })
          .then((r) => {
            if (r.count > 0) this.logger.log(`pruned ${r.count} refresh tokens`);
          })
          .catch(() => {
            /* prune failure is non-fatal */
          });
      }, 60 * 60 * 1000);
    }
  }

  async onModuleDestroy() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    await this.$disconnect();
  }
}
