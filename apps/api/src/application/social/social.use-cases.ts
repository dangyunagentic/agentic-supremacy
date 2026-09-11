import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { SocialAccountRepository, SocialRunRepository } from '../../domain/repositories/social.repository';
import type { SocialExecutorPort } from '../../domain/ports/ports';
import { AesGcmKeyEncryption } from '../../infrastructure/security/aes-gcm-encryption';
import { NotFoundError } from '../common/app-error';

@Injectable()
export class SocialAccountUseCases {
  constructor(
    @Inject(TOKENS.SocialAccountRepository) private readonly accounts: SocialAccountRepository,
    @Inject(TOKENS.SocialRunRepository) private readonly runs: SocialRunRepository,
    @Inject(TOKENS.SocialExecutor) private readonly executor: SocialExecutorPort,
    private readonly crypto: AesGcmKeyEncryption,
  ) {}

  async createAccount(userId: string, data: {
    platform: string;
    username: string;
    email?: string | null;
    displayName?: string | null;
    credentials: unknown;
    proxy?: string | null;
  }) {
    const encryptedCredentials = this.crypto.encrypt(JSON.stringify(data.credentials));
    const account = await this.accounts.create({
      userId,
      platform: data.platform,
      username: data.username,
      email: data.email ?? null,
      displayName: data.displayName ?? null,
      encryptedCredentials,
      proxy: data.proxy ?? null,
    });
    return { ...account, encryptedCredentials: undefined };
  }

  async listAccounts(userId: string, platform?: string) {
    const accounts = await this.accounts.listByUser(userId, platform);
    return accounts.map((a) => ({ ...a, encryptedCredentials: undefined }));
  }

  async updateAccount(userId: string, id: string, data: {
    username?: string;
    email?: string | null;
    displayName?: string | null;
    credentials?: unknown;
    proxy?: string | null;
    isActive?: boolean;
  }) {
    const account = await this.accounts.findById(id);
    if (!account || account.userId !== userId) throw new NotFoundError('Social account');
    const patch: Record<string, unknown> = {};
    if (data.username !== undefined) patch.username = data.username;
    if (data.email !== undefined) patch.email = data.email;
    if (data.displayName !== undefined) patch.displayName = data.displayName;
    if (data.proxy !== undefined) patch.proxy = data.proxy;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.credentials !== undefined) {
      patch.encryptedCredentials = this.crypto.encrypt(JSON.stringify(data.credentials));
    }
    const updated = await this.accounts.update(id, patch as any);
    return { ...updated, encryptedCredentials: undefined };
  }

  async deleteAccount(userId: string, id: string) {
    const account = await this.accounts.findById(id);
    if (!account || account.userId !== userId) throw new NotFoundError('Social account');
    await this.accounts.delete(id);
    return { success: true };
  }

  async testConnection(userId: string, id: string) {
    const account = await this.accounts.findById(id);
    if (!account || account.userId !== userId) throw new NotFoundError('Social account');
    const creds = this.crypto.decrypt(account.encryptedCredentials);
    const result = await this.executor.validateConnection(account.platform, creds, account.proxy);
    await this.accounts.update(id, { status: result.ok ? 'connected' : 'error' });
    return result;
  }

  async runAction(userId: string, data: {
    accountId?: string | null;
    action: string;
    proxy?: string | null;
    input: unknown;
  }) {
    let creds = '';
    let accountProxy: string | null = null;
    let platform = '';
    if (data.accountId) {
      const account = await this.accounts.findById(data.accountId);
      if (!account || account.userId !== userId) throw new NotFoundError('Social account');
      creds = this.crypto.decrypt(account.encryptedCredentials);
      accountProxy = account.proxy;
      platform = account.platform;
    }
    const effectiveProxy = data.proxy ?? accountProxy ?? null;
    const run = await this.runs.create({
      userId,
      accountId: data.accountId ?? null,
      action: data.action,
      proxy: effectiveProxy,
      input: data.input,
    });
    const result = await this.executor.execute(data.action, creds, effectiveProxy, data.input);
    await this.runs.update(run.id, {
      status: result.ok ? 'completed' : 'failed',
      result: result.output ?? result.detail ?? null,
      error: result.ok ? null : result.detail ?? null,
      completedAt: new Date(),
    });
    return { ...result, runId: run.id, platform };
  }

  async listRuns(userId: string, page: number, limit: number) {
    const paged = await this.runs.listByUser(userId, page, limit);
    return paged;
  }
}
