import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

// Infrastructure (composition root binds implementations to domain tokens)
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { SecurityModule } from './infrastructure/security/security.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
import { ChainModule } from './infrastructure/chain/chain.module';
import { TelegramModule } from './infrastructure/telegram/telegram.module';

// Presentation
import { AuthModule } from './presentation/auth/auth.module';
import { TasksModule } from './presentation/tasks/tasks.module';
import { WalletsModule } from './presentation/wallets/wallets.module';
import { SystemModule } from './presentation/system/system.module';
import { AdminModule } from './presentation/admin/admin.module';
import { EligibilityModule } from './presentation/eligibility/eligibility.module';
import { TransfersModule } from './presentation/transfers/transfers.module';
import { RpcEndpointsModule } from './presentation/rpc/rpc-endpoints.module';
import { AppErrorFilter } from './presentation/shared/app-error.filter';
import { JwtAuthGuard } from './presentation/shared/jwt.strategy';
import { RolesGuard } from './presentation/shared/roles.guard';

@Module({
  imports: [
    // 100 req/min per IP baseline; auth endpoints override with @Throttle
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),
    PrismaModule,
    SecurityModule,
    QueueModule,
    RealtimeModule,
    ChainModule,
    TelegramModule,
    AuthModule,
    TasksModule,
    WalletsModule,
    SystemModule,
    AdminModule,
    EligibilityModule,
    TransfersModule,
    RpcEndpointsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppErrorFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
