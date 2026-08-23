import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { UserRepository } from '../../domain/repositories/user.repository';
import type { PasswordHasherPort } from '../../domain/ports/ports';
import { ValidationError, UnauthorizedError } from '../common/app-error';

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.PasswordHasher) private readonly hasher: PasswordHasherPort,
  ) {}

  async execute(input: ChangePasswordInput): Promise<{ success: boolean }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new UnauthorizedError();

    const ok = await this.hasher.compare(input.currentPassword, user.passwordHash);
    if (!ok) throw new ValidationError('Current password is incorrect');

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.users.update(input.userId, { passwordHash });
    return { success: true };
  }
}
