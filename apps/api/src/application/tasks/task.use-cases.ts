import { Inject, Injectable } from '@nestjs/common';
import { Role, TaskStatus, isTaskCancellable } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { TaskRepository, TaskListParams } from '../../domain/repositories/task.repository';
import type { TaskRunRepository } from '../../domain/repositories/task-run.repository';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { MintSchedulerPort, NotifierPort } from '../../domain/ports/ports';
import { NotFoundError, ForbiddenError, ValidationError } from '../common/app-error';
import { toTaskView } from './create-task.use-case';

/** Shape of the authenticated request passed down from the controllers. */
export interface Requester {
  userId: string;
  role: string;
}

const ACTIVE_STATUSES = [
  TaskStatus.Scheduled,
  TaskStatus.PreFlight,
  TaskStatus.Calldata,
  TaskStatus.PreSign,
  TaskStatus.Dispatching,
  TaskStatus.AwaitingReceipt,
];

@Injectable()
export class ListTasksUseCase {
  constructor(@Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository) {}

  async execute(requester: Requester, page: number, limit: number) {
    const params: TaskListParams =
      requester.role === Role.Admin ? { page, limit } : { page, limit, ownerId: requester.userId };
    const paged = await this.tasks.list(params);
    return {
      data: paged.data.map(toTaskView),
      meta: { page, limit, total: paged.total, totalPages: paged.totalPages },
    };
  }

  async executeActive(requester: Requester) {
    const params: TaskListParams =
      requester.role === Role.Admin
        ? { page: 1, limit: 100, statuses: ACTIVE_STATUSES }
        : { page: 1, limit: 100, ownerId: requester.userId, statuses: ACTIVE_STATUSES };
    const paged = await this.tasks.list(params);
    return paged.data.map(toTaskView);
  }
}

@Injectable()
export class GetTaskUseCase {
  constructor(
    @Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository,
    @Inject(TOKENS.TaskRunRepository) private readonly runs: TaskRunRepository,
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
  ) {}

  async execute(taskId: string, requester: Requester) {
    const task = await this.tasks.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    if (requester.role !== Role.Admin && task.userId !== requester.userId) {
      throw new NotFoundError('Task');
    }

    const wallets = await Promise.all(
      task.walletIds.map((id) => this.wallets.findById(id)),
    );
    const results = await this.runs.listResults(taskId);

    return {
      task: toTaskView(task),
      wallets: wallets
        .filter((w): w is NonNullable<typeof w> => w !== null)
        .map((w) => ({ id: w.id, address: w.address, label: w.label, chainId: w.chainId })),
      results: results.map((r) => ({
        id: r.id,
        walletAddress: r.walletAddress,
        walletIndex: r.walletIndex,
        txHash: r.txHash,
        blockNumber: r.blockNumber,
        status: r.status,
        gasUsed: r.gasUsed,
        errorMessage: r.errorMessage,
        nftTokenIds: r.nftTokenIds,
      })),
    };
  }
}

@Injectable()
export class StopTaskUseCase {
  constructor(
    @Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository,
    @Inject(TOKENS.MintScheduler) private readonly scheduler: MintSchedulerPort,
    @Inject(TOKENS.Notifier) private readonly notifier: NotifierPort,
  ) {}

  async execute(taskId: string, requester: Requester) {
    const task = await this.tasks.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    if (requester.role !== Role.Admin && task.userId !== requester.userId) {
      throw new NotFoundError('Task');
    }
    if (!isTaskCancellable(task.status)) {
      throw new ValidationError(`Task is already ${task.status}`);
    }

    await this.scheduler.cancel(taskId);
    const updated = await this.tasks.updateStatus(taskId, TaskStatus.Cancelled, {
      completedAt: new Date(),
    });
    await this.notifier.notifyUser(task.userId, `Task "${task.name}" was cancelled.`);
    return toTaskView(updated);
  }
}

@Injectable()
export class ListTaskLogsUseCase {
  constructor(
    @Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository,
    @Inject(TOKENS.TaskRunRepository) private readonly runs: TaskRunRepository,
  ) {}

  async execute(taskId: string, requester: Requester, page: number, limit: number) {
    const task = await this.tasks.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    if (requester.role !== Role.Admin && task.userId !== requester.userId) {
      throw new ForbiddenError('Not your task');
    }
    const paged = await this.runs.listLogs(taskId, { page, limit });
    return {
      data: paged.data.map((l) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        walletIndex: l.walletIndex,
        timestamp: l.timestamp.toISOString(),
      })),
      meta: { page, limit, total: paged.total, totalPages: paged.totalPages },
    };
  }
}
