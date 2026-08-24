import { Injectable } from '@nestjs/common';
import type { WalletEntity } from '../../domain/entities/wallet.entity';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { Paged } from '../../domain/entities/common.entity';
import { PrismaService } from './prisma.service';
import type { Wallet } from '@prisma/client';

function toEntity(row: Wallet): WalletEntity {
  return { ...row, createdAt: row.createdAt };
}

@Injectable()
export class PrismaWalletRepository implements WalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    address: string;
    encryptedKey: string;
    label?: string | null;
    chainId?: number;
  }): Promise<WalletEntity> {
    const row = await this.prisma.wallet.create({ data });
    return toEntity(row);
  }

  async findById(id: string) {
    const row = await this.prisma.wallet.findUnique({ where: { id } });
    return row ? toEntity(row) : null;
  }

  async findByAddress(address: string) {
    const row = await this.prisma.wallet.findUnique({ where: { address } });
    return row ? toEntity(row) : null;
  }

  async listByUser(userId: string) {
    const rows = await this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEntity);
  }

  async listAll(params: { page: number; limit: number; ownerId?: string }): Promise<Paged<WalletEntity>> {
    const where = params.ownerId ? { userId: params.ownerId } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.wallet.findMany({
        where,
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.wallet.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ ...toEntity(r), owner: r.user.username } as WalletEntity & { owner: string })),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async updateLabel(id: string, label: string | null) {
    const row = await this.prisma.wallet.update({ where: { id }, data: { label } });
    return toEntity(row);
  }

  async delete(id: string) {
    await this.prisma.wallet.delete({ where: { id } });
  }

  async deleteMany(ids: string[], userId?: string) {
    const where = userId
      ? { id: { in: ids }, userId }
      : { id: { in: ids } };
    const res = await this.prisma.wallet.deleteMany({ where });
    return res.count;
  }

  async countAll() {
    return this.prisma.wallet.count();
  }

  async countByUser(userId: string) {
    return this.prisma.wallet.count({ where: { userId } });
  }
}
