import type { Paged } from '../entities/common.entity';
import type { TaskEntity } from '../entities/task.entity';
import type { TaskStatus } from '@mintbot/shared';

export interface TaskListParams {
  page: number;
  limit: number;
  ownerId?: string;
  statuses?: TaskStatus[];
}

export interface TaskRepository {
  create(data: Omit<TaskEntity, 'id' | 'createdAt' | 'updatedAt' | 'resolvedFireAt' | 'startedAt' | 'completedAt'> & { resolvedFireAt?: Date | null }): Promise<TaskEntity>;
  findById(id: string): Promise<TaskEntity | null>;
  list(params: TaskListParams): Promise<Paged<TaskEntity>>;
  updateStatus(id: string, status: TaskStatus, extra?: { startedAt?: Date; completedAt?: Date; resolvedFireAt?: Date }): Promise<TaskEntity>;
  markStarted(id: string): Promise<void>;
  markCompleted(id: string, failed: boolean): Promise<void>;
  findActiveByUser(userId: string): Promise<TaskEntity[]>;
  countAll(): Promise<number>;
  countByStatus(status: TaskStatus): Promise<number>;
  delete(id: string): Promise<void>;
}
