import type { TaskLogEntity, TaskResultEntity } from '../entities/task-run.entity';
import type { Paged } from '../entities/common.entity';
import type { LogLevel, WalletResultStatus } from '@mintbot/shared';

export interface TaskRunRepository {
  appendLog(taskId: string, level: LogLevel, message: string, walletIndex?: number | null): Promise<TaskLogEntity>;
  listLogs(taskId: string, params: { page: number; limit: number }): Promise<Paged<TaskLogEntity>>;
  upsertResult(data: {
    taskId: string;
    walletAddress: string;
    walletIndex: number;
    status: WalletResultStatus;
    txHash?: string | null;
    blockNumber?: number | null;
    gasUsed?: number | null;
    errorMessage?: string | null;
    nftTokenIds?: string[];
  }): Promise<TaskResultEntity>;
  listResults(taskId: string): Promise<TaskResultEntity[]>;
  countMinted(): Promise<number>;
}
