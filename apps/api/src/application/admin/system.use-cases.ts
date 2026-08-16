import { Inject, Injectable } from '@nestjs/common';
import { TaskStatus } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { AuditLogRepository, SystemConfigRepository } from '../../domain/repositories/system.repository';
import type { TaskRepository } from '../../domain/repositories/task.repository';
import type { TaskRunRepository } from '../../domain/repositories/task-run.repository';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { UserRepository } from '../../domain/repositories/user.repository';
import type { KeyEncryptionPort } from '../../domain/ports/ports';
import { NotFoundError } from '../common/app-error';

@Injectable()
export class GetAdminStatsUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository,
    @Inject(TOKENS.TaskRunRepository) private readonly runs: TaskRunRepository,
  ) {}

  async execute() {
    const [totalUsers, totalWallets, totalTasks, completed, failed, totalMinted] =
      await Promise.all([
        this.users.countAll(),
        this.wallets.countAll(),
        this.tasks.countAll(),
        this.tasks.countByStatus(TaskStatus.Completed),
        this.tasks.countByStatus(TaskStatus.Failed),
        this.runs.countMinted(),
      ]);

    const finished = completed + failed;
    return {
      totalUsers,
      totalWallets,
      totalTasks,
      activeTasks: Math.max(0, totalTasks - finished),
      completedTasks: completed,
      failedTasks: failed,
      successRate: finished === 0 ? 0 : completed / finished,
      totalMinted,
    };
  }
}

@Injectable()
export class ListAuditLogUseCase {
  constructor(@Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository) {}

  async execute(page: number, limit: number) {
    return this.audit.list({ page, limit });
  }
}

@Injectable()
export class GetSystemConfigUseCase {
  constructor(
    @Inject(TOKENS.SystemConfigRepository) private readonly config: SystemConfigRepository,
  ) {}

  async execute() {
    const cfg = await this.config.get();
    return { ...cfg, openseaApiKeyEnc: undefined, openseaApiKeySet: Boolean(cfg.openseaApiKeyEnc) };
  }
}

@Injectable()
export class UpdateSystemConfigUseCase {
  constructor(
    @Inject(TOKENS.SystemConfigRepository) private readonly config: SystemConfigRepository,
    @Inject(TOKENS.KeyEncryption) private readonly crypto: KeyEncryptionPort,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async execute(adminId: string, patch: Record<string, unknown>) {
    await this.config.get(); // ensures the singleton row exists
    const data: Record<string, number | string | null> = {};
    const numeric = [
      'defaultGasLimit',
      'defaultMaxFeeGwei',
      'defaultPriorityGwei',
      'scheduleRefreshSec',
      'txMaxAttempts',
      'pendingTimeoutSec',
      'receiptPollBaseMs',
      'receiptPollMaxMs',
      'replacementBumpBps',
    ] as const;

    for (const field of numeric) {
      const value = patch[field];
      if (value === undefined || value === null) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new NotFoundError('Invalid config value');
      data[field] = n;
    }

    if (typeof patch.openseaApiKey === 'string') {
      data.openseaApiKeyEnc = patch.openseaApiKey.trim()
        ? this.crypto.encrypt(patch.openseaApiKey.trim())
        : null;
    }

    const updated = await this.config.update(data);
    await this.audit.record({
      adminId,
      action: 'config.update',
      targetType: 'system_config',
      targetId: '1',
      metadata: { fields: Object.keys(data) },
    });

    return {
      ...updated,
      openseaApiKeyEnc: undefined,
      openseaApiKeySet: Boolean(updated.openseaApiKeyEnc),
    };
  }
}
