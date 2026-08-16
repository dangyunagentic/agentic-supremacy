import { Global, Module } from '@nestjs/common';
import { RedisTaskEventPublisher } from './redis-event-publisher';
import { TasksGateway } from './tasks.gateway';
import { TOKENS } from '../../domain/tokens';

@Global()
@Module({
  providers: [
    TasksGateway,
    { provide: TOKENS.TaskEventPublisher, useClass: RedisTaskEventPublisher },
  ],
  exports: [TOKENS.TaskEventPublisher],
})
export class RealtimeModule {}
