import { Injectable } from '@nestjs/common';
import type {
  RpcEndpointEntity,
  TransferJobEntity,
  TransferResultRow,
} from '../../domain/entities/transfer.entity';
import type {
  RpcEndpointRepository,
  TransferJobRepository,
} from '../../domain/repositories/transfer.repository';
import type { Paged } from '../../domain/entities/common.entity';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaRpcEndpointRepository implements RpcEndpointRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    chainKey: string;
    label: string;
    url: string;
    provider?: string;
    tier?: string;
    isDefault?: boolean;
  }): Promise<RpcEndpointEntity> {
    const row = await this.prisma.rpcEndpoint.create({ data });
    return row as RpcEndpointEntity;
  }

  async findById(id: string) {
    const row = await this.prisma.rpcEndpoint.findUnique({ where: { id } });
    return row ? (row as RpcEndpointEntity) : null;
  }

  async listByUser(userId: string, chainKey?: string): Promise<RpcEndpointEntity[]> {
    const rows = await this.prisma.rpcEndpoint.findMany({
      where: { userId, ...(chainKey ? { chainKey } : {}) },
      orderBy: [{ chainKey: 'asc' }, { createdAt: 'asc' }],
    });
    return rows as RpcEndpointEntity[];
  }

  async update(id: string, data: Partial<Pick<RpcEndpointEntity, 'label' | 'lastLatencyMs' | 'vpsLatencyMs' | 'rpcLatencyMs' | 'isDefault'>>) {
    const row = await this.prisma.rpcEndpoint.update({ where: { id }, data });
    return row as RpcEndpointEntity;
  }

  async delete(id: string) {
    await this.prisma.rpcEndpoint.delete({ where: { id } });
  }
}

@Injectable()
export class PrismaTransferJobRepository implements TransferJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    kind: 'fund' | 'transfer_nft' | 'disperse' | 'consolidate';
    chainKey: string;
    fromWalletId?: string | null;
    toWalletIds: string[];
    recipientAddress?: string | null;
    amountEth?: string | null;
    tokenContract?: string | null;
    tokenSymbol?: string | null;
    fromBlock?: number | null;
    results?: TransferResultRow[];
  }): Promise<TransferJobEntity> {
    const row = await this.prisma.transferJob.create({
      data: {
        userId: data.userId,
        kind: data.kind,
        chainKey: data.chainKey,
        fromWalletId: data.fromWalletId ?? null,
        toWalletIds: data.toWalletIds,
        recipientAddress: data.recipientAddress ?? null,
        amountEth: data.amountEth ?? null,
        tokenContract: data.tokenContract ?? null,
        tokenSymbol: data.tokenSymbol ?? null,
        fromBlock: data.fromBlock ?? null,
        status: 'queued',
        results: (data.results ?? []) as object[],
      },
    });
    return this.fromRow(row);
  }

  async findById(id: string) {
    const row = await this.prisma.transferJob.findUnique({ where: { id } });
    return row ? this.fromRow(row) : null;
  }

  async listByUser(userId: string, page: number, limit: number): Promise<Paged<TransferJobEntity>> {
    const where = { userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transferJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transferJob.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.fromRow(r)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async update(id: string, data: Partial<Pick<TransferJobEntity, 'status' | 'results' | 'error' | 'completedAt'>>) {
    const row = await this.prisma.transferJob.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.results !== undefined ? { results: data.results as object[] } : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
      },
    });
    return this.fromRow(row);
  }

  private fromRow(row: {
    id: string;
    userId: string;
    kind: string;
    chainKey: string;
    fromWalletId: string | null;
    toWalletIds: string[];
    recipientAddress: string | null;
    amountEth: { toString(): string } | null;
    tokenContract: string | null;
    tokenSymbol: string | null;
    fromBlock: number | null;
    status: string;
    results: unknown;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }): TransferJobEntity {
    return {
      ...row,
      amountEth: row.amountEth != null ? row.amountEth.toString() : null,
      results: (row.results as TransferResultRow[]) ?? [],
    };
  }
}
