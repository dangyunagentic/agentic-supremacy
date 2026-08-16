import { Inject, Injectable } from '@nestjs/common';
import { Role, UserStatus } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { UserRepository } from '../../domain/repositories/user.repository';
import type { PasswordHasherPort } from '../../domain/ports/ports';
import type { AuditLogRepository } from '../../domain/repositories/system.repository';
import { NotFoundError, ValidationError, ConflictError } from '../common/app-error';
import { toSafeUser } from '../auth/register.use-case';

@Injectable()
export class ListUsersUseCase {
  constructor(@Inject(TOKENS.UserRepository) private readonly users: UserRepository) {}

  async execute(page: number, limit: number, search?: string) {
    return this.users.list({ page, limit, search });
  }
}

@Injectable()
export class AdminCreateUserUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.PasswordHasher) private readonly hasher: PasswordHasherPort,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async execute(adminId: string, input: { email: string; username: string; password: string; role?: Role }) {
    if (await this.users.findByEmail(input.email.toLowerCase())) {
      throw new ConflictError('Email is already registered');
    }
    if (await this.users.findByUsername(input.username)) {
      throw new ConflictError('Username is already taken');
    }
    const user = await this.users.create({
      email: input.email.toLowerCase(),
      username: input.username,
      passwordHash: await this.hasher.hash(input.password),
      role: input.role ?? Role.User,
    });
    await this.audit.record({
      adminId,
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email, role: user.role },
    });
    return toSafeUser(user);
  }
}

@Injectable()
export class AdminUpdateUserUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.PasswordHasher) private readonly hasher: PasswordHasherPort,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async execute(
    adminId: string,
    userId: string,
    input: { role?: Role; status?: UserStatus; password?: string },
  ) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User');

    if (user.id === adminId && input.status === UserStatus.Suspended) {
      throw new ValidationError('You cannot suspend your own account');
    }
    if (user.id === adminId && input.role === Role.User) {
      throw new ValidationError('You cannot demote your own account');
    }

    const patch: Parameters<UserRepository['update']>[1] = {};
    if (input.role) patch.role = input.role;
    if (input.status) patch.status = input.status;
    if (input.password) patch.passwordHash = await this.hasher.hash(input.password);

    const updated = await this.users.update(userId, patch);
    await this.audit.record({
      adminId,
      action: 'user.update',
      targetType: 'user',
      targetId: userId,
      metadata: { ...patch, passwordHash: undefined },
    });
    return toSafeUser(updated);
  }
}

@Injectable()
export class AdminDeleteUserUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async execute(adminId: string, userId: string) {
    if (adminId === userId) throw new ValidationError('You cannot delete your own account');
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User');
    await this.users.delete(userId);
    await this.audit.record({
      adminId,
      action: 'user.delete',
      targetType: 'user',
      targetId: userId,
      metadata: { email: user.email },
    });
  }
}
