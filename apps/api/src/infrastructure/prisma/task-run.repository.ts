import { Injectable } from '@nestjs/common';
import type { TaskLogEntity, TaskResultEntity } from '../../domain/entities/task-run.entity';
import type { TaskRunRepository } from '../../domain/repositories/task-run.repository';
import type { Paged } from '../../domain/entities/common.entity';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaTaskRunRepository implements TaskRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async appendLog(taskId: string, level: 'info' | 'warn' | 'error' | 'success', message: string, walletIndex?: number | null) {
    const row = await this.prisma.taskLog.create({
      data: { taskId, level, message, walletIndex: walletIndex ?? null },
    });
    return { ...row, timestamp: row.timestamp } as TaskLogEntity;
  }

  async listLogs(taskId: string, params: { page: number; limit: number }): Promise<Paged<TaskLogEntity>> {
    const where = { taskId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.taskLog.findMany({
        where,
        orderBy: { timestamp: 'asc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.taskLog.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ ...r, timestamp: r.timestamp }) as TaskLogEntity),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async upsertResult(data: {
    taskId: string;
    walletAddress: string;
    walletIndex: number;
    status: 'pending' | 'signed' | 'dispatched' | 'success' | 'reverted' | 'rejected' | 'timeout';
    txHash?: string | null;
    blockNumber?: number | null;
    gasUsed?: number | null;
    errorMessage?: string | null;
    nftTokenIds?: string[];
  }): Promise<TaskResultEntity> {
    const existing = await this.prisma.taskResult.findFirst({
      where: { taskId: data.taskId, walletIndex: data.walletIndex },
    });

    const payload = {
      status: data.status,
      ...(data.txHash !== undefined ? { txHash: data.txHash } : {}),
      ...(data.blockNumber !== undefined ? { blockNumber: data.blockNumber } : {}),
      ...(data.gasUsed !== undefined ? { gasUsed: data.gasUsed } : {}),
      ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
      ...(data.nftTokenIds !== undefined ? { nftTokenIds: data.nftTokenIds } : {}),
    };

    const row = existing
      ? await this.prisma.taskResult.update({ where: { id: existing.id }, data: payload })
      : await this.prisma.taskResult.create({
          data: {
            taskId: data.taskId,
            walletAddress: data.walletAddress,
            walletIndex: data.walletIndex,
            ...payload,
          },
        });
    return row as TaskResultEntity;
  }

  async listResults(taskId: string) {
    const rows = await this.prisma.taskResult.findMany({
      where: { taskId },
      orderBy: { walletIndex: 'asc' },
    });
    return rows as TaskResultEntity[];
  }

  async countMinted() {
    // One minted unit per wallet result with at least one token id minted.
    const rows = await this.prisma.taskResult.findMany({
      where: { status: 'success' },
      select: { nftTokenIds: true },
    });
    return rows.reduce((sum, r) => sum + r.nftTokenIds.length, 0);
  }
}
