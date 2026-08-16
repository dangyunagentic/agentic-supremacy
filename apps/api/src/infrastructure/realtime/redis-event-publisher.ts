import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { TASK_EVENTS_CHANNEL, type TaskEvent } from '@mintbot/shared';
import type { TaskEventPublisherPort } from '../../domain/ports/ports';

@Injectable()
export class RedisTaskEventPublisher implements TaskEventPublisherPort, OnModuleDestroy {
  private readonly logger = new Logger(RedisTaskEventPublisher.name);
  private readonly pub: IORedis;

  constructor() {
    this.pub = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  publish(event: TaskEvent): void {
    this.pub
      .publish(TASK_EVENTS_CHANNEL, JSON.stringify(event))
      .catch((err) => this.logger.error(`Failed to publish ${event.type}: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.pub.quit().catch(() => undefined);
  }
}
