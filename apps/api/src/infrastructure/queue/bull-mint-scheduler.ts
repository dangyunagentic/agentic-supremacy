import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES } from '@mintbot/shared';
import type { MintSchedulerPort } from '../../domain/ports/ports';

function connection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}

/**
 * Enqueues jobs consumed by apps/worker. Job ids are deterministic per task so
 * cancellation is a single remove() call per queue.
 */
@Injectable()
export class BullMintScheduler implements MintSchedulerPort, OnModuleDestroy {
  private readonly logger = new Logger(BullMintScheduler.name);
  private readonly preflight: Queue;
  private readonly mint: Queue;
  private readonly transfers: Queue;

  constructor() {
    this.preflight = new Queue(QUEUES.PREFLIGHT, { connection: connection() });
    this.mint = new Queue(QUEUES.MINT, { connection: connection() });
    this.transfers = new Queue(QUEUES.TRANSFERS, { connection: connection() });
  }

  private jobId(taskId: string): string {
    // BullMQ rejects custom job ids containing ':'; keep a safe separator.
    return `task_${taskId}`;
  }

  async schedulePreflight(taskId: string, runAt: Date): Promise<void> {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await this.preflight.add('preflight', { taskId }, {
      jobId: this.jobId(taskId),
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    });
    this.logger.log(`Preflight scheduled for task ${taskId} at ${runAt.toISOString()}`);
  }

  async runNow(taskId: string): Promise<void> {
    await this.schedulePreflight(taskId, new Date());
  }

  async scheduleTransfer(jobId: string): Promise<void> {
    await this.transfers.add(
      'transfer',
      { jobId },
      {
        // Note: BullMQ rejects custom job ids containing ':'. The transfer job
        // id is already a unique UUID, so use it directly (no prefix).
        jobId,
        attempts: 1,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );
    this.logger.log(`Transfer job ${jobId} enqueued`);
  }

  async cancel(taskId: string): Promise<void> {
    const id = this.jobId(taskId);
    await Promise.allSettled([
      this.preflight.remove(id),
      this.mint.remove(id),
    ]);
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.preflight.close(), this.mint.close(), this.transfers.close()]);
  }
}
