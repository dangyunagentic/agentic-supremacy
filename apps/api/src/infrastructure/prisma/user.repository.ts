import { Injectable } from '@nestjs/common';
import type { UserEntity, SafeUser } from '../../domain/entities/user.entity';
import type { UserRepository } from '../../domain/repositories/user.repository';
import type { Paged } from '../../domain/entities/common.entity';
import type { PrismaService } from './prisma.service';
import type { Prisma, User } from '@prisma/client';

type UserWhereInput = Prisma.UserWhereInput;

function toEntity(row: User): UserEntity {
  return {
    ...row,
    telegramId: row.telegramId === null ? null : row.telegramId.toString(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSafe(row: User): SafeUser {
  const e = toEntity(row);
  return {
    id: e.id,
    telegramId: e.telegramId,
    username: e.username,
    email: e.email,
    role: e.role,
    status: e.status,
    createdAt: e.createdAt,
  };
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    username: string;
    email: string;
    passwordHash: string;
    role?: 'user' | 'admin';
    telegramId?: string | null;
  }): Promise<UserEntity> {
    const row = await this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        telegramId: data.telegramId ? BigInt(data.telegramId) : null,
      },
    });
    return toEntity(row);
  }

  async findById(id: string) {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toEntity(row) : null;
  }

  async findByEmail(email: string) {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? toEntity(row) : null;
  }

  async findByUsername(username: string) {
    const row = await this.prisma.user.findUnique({ where: { username } });
    return row ? toEntity(row) : null;
  }

  async findByTelegramId(telegramId: string) {
    const row = await this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    return row ? toEntity(row) : null;
  }

  async update(id: string, data: Partial<Pick<UserEntity, 'role' | 'status' | 'telegramId' | 'passwordHash'>>) {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...data,
        telegramId: data.telegramId === undefined ? undefined : data.telegramId ? BigInt(data.telegramId) : null,
      },
    });
    return toEntity(row);
  }

  async delete(id: string) {
    await this.prisma.user.delete({ where: { id } });
  }

  async list(params: { page: number; limit: number; search?: string }): Promise<Paged<SafeUser>> {
    const where: UserWhereInput = params.search
      ? {
          OR: [
            { username: { contains: params.search, mode: 'insensitive' } },
            { email: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(toSafe),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async countAll() {
    return this.prisma.user.count();
  }
}
