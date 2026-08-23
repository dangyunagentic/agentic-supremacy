import { Injectable } from '@nestjs/common';
import type {
  AuditLogEntity,
  ChainEntity,
  SystemConfigEntity,
} from '../../domain/entities/system.entity';
import type {
  AuditLogRepository,
  ChainRepository,
  SystemConfigRepository,
} from '../../domain/repositories/system.repository';
import type { Paged } from '../../domain/entities/common.entity';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaChainRepository implements ChainRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toEntity(row: {
    id: number;
    key: string;
    chainId: number;
    name: string;
    explorer: string;
    nativeSymbol: string;
    publicRpcs: string[];
    defaultPrivateRpc: string | null;
    seadropAddress: string;
    isActive: boolean;
    ownerId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ChainEntity {
    return row;
  }

  async create(data: Omit<ChainEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChainEntity> {
    const row = await this.prisma.chain.create({ data });
    return this.toEntity(row);
  }

  async findById(id: number) {
    const row = await this.prisma.chain.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
  }

  async findByKey(key: string) {
    const row = await this.prisma.chain.findUnique({ where: { key } });
    return row ? this.toEntity(row) : null;
  }

  async listAll(includeInactive = false): Promise<ChainEntity[]> {
    const rows = await this.prisma.chain.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async update(id: number, data: Partial<Omit<ChainEntity, 'id' | 'createdAt' | 'updatedAt'>>) {
    const row = await this.prisma.chain.update({ where: { id }, data });
    return this.toEntity(row);
  }

  async delete(id: number) {
    await this.prisma.chain.delete({ where: { id } });
  }
}

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    adminId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogEntity> {
    const row = await this.prisma.auditLog.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: (entry.metadata ?? {}) as object,
      },
    });
    return row as AuditLogEntity;
  }

  async list(params: { page: number; limit: number }): Promise<Paged<AuditLogEntity>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        include: { admin: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.auditLog.count(),
    ]);
    return {
      data: rows.map((r) => ({
        ...(r as unknown as AuditLogEntity),
        adminUsername: r.admin?.username,
      })),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }
}

@Injectable()
export class PrismaSystemConfigRepository implements SystemConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SystemConfigEntity> {
    let row = await this.prisma.systemConfig.findUnique({ where: { id: 1 } });
    if (!row) row = await this.prisma.systemConfig.create({ data: { id: 1 } });
    return row;
  }

  async update(data: Partial<Omit<SystemConfigEntity, 'id' | 'updatedAt'>>) {
    await this.get();
    const row = await this.prisma.systemConfig.update({ where: { id: 1 }, data });
    return row;
  }
}
