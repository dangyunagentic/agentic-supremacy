import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { UserRepository } from '../../domain/repositories/user.repository';
import type { PasswordHasherPort, TokenServicePort } from '../../domain/ports/ports';
import { UnauthorizedError } from '../common/app-error';
import { assertActive, toSafeUser, type AuthResult } from './register.use-case';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.PasswordHasher) private readonly hasher: PasswordHasherPort,
    @Inject(TOKENS.TokenService) private readonly tokens: TokenServicePort,
  ) {}

  async execute(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    if (!user || !(await this.hasher.compare(password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const safe = assertActive(user);
    return { user: safe, ...this.tokens.issuePair(safe) };
  }
}

@Injectable()
export class RefreshUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.TokenService) private readonly tokens: TokenServicePort,
  ) {}

  async execute(refreshToken: string): Promise<AuthResult> {
    const { sub } = await this.tokens.verifyRefresh(refreshToken);
    const user = await this.users.findById(sub);
    if (!user) throw new UnauthorizedError('User no longer exists');
    const safe = assertActive(user);
    return { user: safe, ...this.tokens.issuePair(safe) };
  }
}

@Injectable()
export class MeUseCase {
  constructor(@Inject(TOKENS.UserRepository) private readonly users: UserRepository) {}

  async execute(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedError();
    return toSafeUser(user);
  }
}
