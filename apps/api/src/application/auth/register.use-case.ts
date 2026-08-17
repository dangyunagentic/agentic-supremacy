import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { UserRepository } from '../../domain/repositories/user.repository';
import type { PasswordHasherPort, TokenServicePort } from '../../domain/ports/ports';
import type { SafeUser, UserEntity } from '../../domain/entities/user.entity';
import { ConflictError } from '../common/app-error';
import { Role, UserStatus } from '@mintbot/shared';

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
}

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.PasswordHasher) private readonly hasher: PasswordHasherPort,
    @Inject(TOKENS.TokenService) private readonly tokens: TokenServicePort,
  ) {}

  async execute(input: RegisterInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();

    if (await this.users.findByEmail(email)) {
      throw new ConflictError('Email is already registered');
    }
    if (await this.users.findByUsername(username)) {
      throw new ConflictError('Username is already taken');
    }

    const user = await this.users.create({
      email,
      username,
      passwordHash: await this.hasher.hash(input.password),
    });

    return this.toAuthResult(user);
  }

  private async toAuthResult(user: UserEntity): Promise<AuthResult> {
    return { user: toSafeUser(user), ...(await this.tokens.issuePair(toSafeUser(user))) };
  }
}

export function toSafeUser(user: UserEntity): SafeUser {
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export function assertActive(user: UserEntity): SafeUser {
  if (user.status !== UserStatus.Active) {
    throw new ConflictError('Account is suspended');
  }
  return toSafeUser(user);
}
