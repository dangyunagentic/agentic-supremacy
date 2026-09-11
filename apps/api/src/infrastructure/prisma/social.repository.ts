import { Injectable } from '@nestjs/common';
import type { SocialAccountEntity, SocialRunEntity } from '../../domain/entities/social.entity';
import type { SocialAccountRepository, SocialRunRepository } from '../../domain/repositories/social.repository';
import type { Paged } from '../../domain/entities/common.entity';
import { PrismaService } from './prisma.service';

function toAccount(row: {
  id: string;
  userId: string;
  platform: string;
  username: string;
  email: string | null;
  displayName: string | null;
  encryptedCredentials: string;
  proxy: string | null;
  status: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SocialAccountEntity {
  return { ...row };
}

function toRun(row: {
  id: string;
  userId: string;
  accountId: string | null;
  action: string;
  proxy: string | null;
  status: string;
  input: unknown;
  result: unknown;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): SocialRunEntity {
  return { ...row };
}

@Injectable()
export class PrismaSocialAccountRepository implements SocialAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    platform: string;
    username: string;
    email?: string | null;
    displayName?: string | null;
    encryptedCredentials: string;
    proxy?: string | null;
  }): Promise<SocialAccountEntity> {
    const row = await this.prisma.socialAccount.create({
      data: {
        userId: data.userId,
        platform: data.platform,
        username: data.username,
        email: data.email ?? null,
        displayName: data.displayName ?? null,
        encryptedCredentials: data.encryptedCredentials,
        proxy: data.proxy ?? null,
      },
    });
    return toAccount(row);
  }

  async findById(id: string) {
    const row = await this.prisma.socialAccount.findUnique({ where: { id } });
    return row ? toAccount(row) : null;
  }

  async listByUser(userId: string, platform?: string) {
    const rows = await this.prisma.socialAccount.findMany({
      where: { userId, ...(platform ? { platform } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toAccount);
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        SocialAccountEntity,
        'username' | 'email' | 'displayName' | 'encryptedCredentials' | 'proxy' | 'status' | 'isActive'
      >
    >,
  ) {
    const row = await this.prisma.socialAccount.update({ where: { id }, data });
    return toAccount(row);
  }

  async delete(id: string) {
    await this.prisma.socialAccount.delete({ where: { id } });
  }
}

@Injectable()
export class PrismaSocialRunRepository implements SocialRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    accountId?: string | null;
    action: string;
    proxy?: string | null;
    input: unknown;
  }): Promise<SocialRunEntity> {
    const row = await this.prisma.socialRun.create({
      data: {
        userId: data.userId,
        accountId: data.accountId ?? null,
        action: data.action,
        proxy: data.proxy ?? null,
        input: (data.input ?? {}) as object,
      },
    });
    return toRun(row);
  }

  async findById(id: string) {
    const row = await this.prisma.socialRun.findUnique({ where: { id } });
    return row ? toRun(row) : null;
  }

  async listByUser(userId: string, page: number, limit: number): Promise<Paged<SocialRunEntity>> {
    const where = { userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.socialRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.socialRun.count({ where }),
    ]);
    return {
      data: rows.map(toRun),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async update(
    id: string,
    data: Partial<Pick<SocialRunEntity, 'status' | 'result' | 'error' | 'completedAt'>>,
  ) {
    const row = await this.prisma.socialRun.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.result !== undefined ? { result: data.result as object } : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
      },
    });
    return toRun(row);
  }

  async countAll() {
    return this.prisma.socialRun.count();
  }
}
