import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaUserRepository } from './user.repository';
import { PrismaWalletRepository } from './wallet.repository';
import { PrismaTaskRepository } from './task.repository';
import { PrismaTaskRunRepository } from './task-run.repository';
import { PrismaRefreshTokenRepository } from './refresh-token.repository';
import {
  PrismaAuditLogRepository,
  PrismaChainRepository,
  PrismaSystemConfigRepository,
} from './system.repository';
import {
  PrismaRpcEndpointRepository,
  PrismaTransferJobRepository,
} from './transfer.repository';
import { TOKENS } from '../../domain/tokens';

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: TOKENS.UserRepository, useClass: PrismaUserRepository },
    { provide: TOKENS.WalletRepository, useClass: PrismaWalletRepository },
    { provide: TOKENS.TaskRepository, useClass: PrismaTaskRepository },
    { provide: TOKENS.TaskRunRepository, useClass: PrismaTaskRunRepository },
    { provide: TOKENS.ChainRepository, useClass: PrismaChainRepository },
    { provide: TOKENS.AuditLogRepository, useClass: PrismaAuditLogRepository },
    { provide: TOKENS.SystemConfigRepository, useClass: PrismaSystemConfigRepository },
    { provide: TOKENS.RpcEndpointRepository, useClass: PrismaRpcEndpointRepository },
    { provide: TOKENS.TransferJobRepository, useClass: PrismaTransferJobRepository },
    { provide: TOKENS.RefreshTokenRepository, useClass: PrismaRefreshTokenRepository },
  ],
  exports: [
    PrismaService,
    TOKENS.UserRepository,
    TOKENS.WalletRepository,
    TOKENS.TaskRepository,
    TOKENS.TaskRunRepository,
    TOKENS.ChainRepository,
    TOKENS.AuditLogRepository,
    TOKENS.SystemConfigRepository,
    TOKENS.RpcEndpointRepository,
    TOKENS.TransferJobRepository,
    TOKENS.RefreshTokenRepository,
  ],
})
export class PrismaModule {}
