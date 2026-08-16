import { Injectable } from '@nestjs/common';
import type { TaskEntity } from '../../domain/entities/task.entity';
import type { TaskRepository, TaskListParams } from '../../domain/repositories/task.repository';
import type { Paged } from '../../domain/entities/common.entity';
import type { PrismaService } from './prisma.service';
import type { Prisma, Task } from '@prisma/client';

type TaskWhereInput = Prisma.TaskWhereInput;

function toEntity(row: Task): TaskEntity {
  return {
    ...row,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customFireTime: row.customFireTime,
    resolvedFireAt: row.resolvedFireAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

@Injectable()
export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Omit<TaskEntity, 'id' | 'createdAt' | 'updatedAt' | 'resolvedFireAt' | 'startedAt' | 'completedAt'> & { resolvedFireAt?: Date | null }): Promise<TaskEntity> {
    const row = await this.prisma.task.create({
      data: {
        ...data,
        resolvedFireAt: data.resolvedFireAt ?? null,
      },
    });
    return toEntity(row);
  }

  async findById(id: string) {
    const row = await this.prisma.task.findUnique({ where: { id } });
    return row ? toEntity(row) : null;
  }

  async list(params: TaskListParams): Promise<Paged<TaskEntity>> {
    const where: TaskWhereInput = {
      ...(params.ownerId ? { userId: params.ownerId } : {}),
      ...(params.statuses && params.statuses.length > 0 ? { status: { in: params.statuses } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.task.count({ where }),
    ]);
    return {
      data: rows.map(toEntity),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async updateStatus(id: string, status: Task['status'], extra?: { startedAt?: Date; completedAt?: Date; resolvedFireAt?: Date }) {
    const row = await this.prisma.task.update({
      where: { id },
      data: {
        status,
        ...(extra?.startedAt !== undefined ? { startedAt: extra.startedAt } : {}),
        ...(extra?.completedAt !== undefined ? { completedAt: extra.completedAt } : {}),
        ...(extra?.resolvedFireAt !== undefined ? { resolvedFireAt: extra.resolvedFireAt } : {}),
      },
    });
    return toEntity(row);
  }

  async markStarted(id: string) {
    await this.prisma.task.update({ where: { id }, data: { startedAt: new Date() } });
  }

  async markCompleted(id: string, failed: boolean) {
    await this.prisma.task.update({
      where: { id },
      data: { completedAt: new Date(), status: failed ? 'failed' : 'completed' },
    });
  }

  async findActiveByUser(userId: string) {
    const rows = await this.prisma.task.findMany({
      where: {
        userId,
        status: { in: ['scheduled', 'pre_flight', 'calldata', 'pre_sign', 'dispatching', 'awaiting_receipt'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toEntity);
  }

  async countAll() {
    return this.prisma.task.count();
  }

  async countByStatus(status: Task['status']) {
    return this.prisma.task.count({ where: { status } });
  }
}
