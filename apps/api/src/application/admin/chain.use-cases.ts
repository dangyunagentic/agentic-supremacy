import { Inject, Injectable } from '@nestjs/common';
import { SEADROP_ADDRESS, isAddress } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type {
  AuditLogRepository,
  ChainRepository,
} from '../../domain/repositories/system.repository';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '../common/app-error';
import { assertSafePublicUrl } from '../../infrastructure/security/ssrf-guard';

@Injectable()
export class ListChainsUseCase {
  constructor(@Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository) {}

  /** Active chains are publicly listable (task wizard needs them for everyone). */
  async executeActive() {
    return this.chains.listAll(false);
  }

  async executeAll() {
    return this.chains.listAll(true);
  }
}

@Injectable()
export class CreateChainUseCase {
  constructor(
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async execute(
    actorId: string,
    input: {
      key: string;
      chainId: number;
      name: string;
      explorer: string;
      nativeSymbol: string;
      publicRpcs: string[];
      defaultPrivateRpc?: string | null;
      seadropAddress?: string;
    },
  ) {
    if (!/^[a-z0-9-]{2,24}$/.test(input.key)) {
      throw new ValidationError('Chain key must be lowercase letters, digits and dashes');
    }
    if (!Number.isInteger(input.chainId) || input.chainId <= 0) {
      throw new ValidationError('Invalid chain ID');
    }
    if (await this.chains.findByKey(input.key)) throw new ConflictError('Chain key already exists');

    // RPC URLs are consumed server-side (API balance/drop lookups + worker
    // execution), so every user-supplied URL must clear the SSRF guard.
    const rpcs = await this.validateRpcUrls(input.publicRpcs);
    if (rpcs.length === 0) throw new ValidationError('At least one valid RPC URL is required');

    let defaultPrivateRpc: string | null = null;
    if (input.defaultPrivateRpc?.trim()) {
      const validated = await this.validateRpcUrls([input.defaultPrivateRpc]);
      defaultPrivateRpc = validated[0] ?? null;
    }

    const seadrop = input.seadropAddress?.trim() || SEADROP_ADDRESS;
    if (!isAddress(seadrop)) throw new ValidationError('Invalid SeaDrop address');

    const chain = await this.chains.create({
      key: input.key,
      chainId: input.chainId,
      name: input.name,
      explorer: input.explorer,
      nativeSymbol: input.nativeSymbol,
      publicRpcs: rpcs,
      defaultPrivateRpc,
      seadropAddress: seadrop,
      isActive: true,
      ownerId: actorId,
    });
    await this.audit.record({
      adminId: actorId,
      action: 'chain.create',
      targetType: 'chain',
      targetId: chain.key,
      metadata: { chainId: chain.chainId },
    });
    return chain;
  }

  /** Filters to http(s) URLs, normalizes, and rejects any that fail the SSRF guard. */
  private async validateRpcUrls(urls: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const raw of urls) {
      const url = raw.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(url)) continue;
      try {
        await assertSafePublicUrl(url);
      } catch (err) {
        throw new ValidationError(`RPC URL rejected: ${(err as Error).message}`);
      }
      out.push(url);
    }
    return out;
  }
}

@Injectable()
export class UpdateChainUseCase {
  constructor(
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async execute(adminId: string, id: number, input: Record<string, unknown>) {
    const chain = await this.chains.findById(id);
    if (!chain) throw new NotFoundError('Chain');

    const patch: Parameters<ChainRepository['update']>[1] = {};
    if (typeof input.name === 'string') patch.name = input.name;
    if (typeof input.explorer === 'string') patch.explorer = input.explorer;
    if (typeof input.nativeSymbol === 'string') patch.nativeSymbol = input.nativeSymbol;
    if (Array.isArray(input.publicRpcs)) {
      const rpcs = await this.validateRpcUrls(input.publicRpcs as string[]);
      if (rpcs.length === 0) throw new ValidationError('At least one valid RPC URL is required');
      patch.publicRpcs = rpcs;
    }
    if (typeof input.isActive === 'boolean') patch.isActive = input.isActive;

    const updated = await this.chains.update(id, patch);
    await this.audit.record({
      adminId,
      action: 'chain.update',
      targetType: 'chain',
      targetId: updated.key,
      metadata: patch as Record<string, unknown>,
    });
    return updated;
  }

  /** Filters to http(s) URLs, normalizes, and rejects any that fail the SSRF guard. */
  private async validateRpcUrls(urls: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const raw of urls) {
      const url = raw.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(url)) continue;
      try {
        await assertSafePublicUrl(url);
      } catch (err) {
        throw new ValidationError(`RPC URL rejected: ${(err as Error).message}`);
      }
      out.push(url);
    }
    return out;
  }
}

@Injectable()
export class DeleteChainUseCase {
  constructor(
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async execute(adminId: string, id: number) {
    const chain = await this.chains.findById(id);
    if (!chain) throw new NotFoundError('Chain');
    await this.chains.delete(id);
    await this.audit.record({
      adminId,
      action: 'chain.delete',
      targetType: 'chain',
      targetId: chain.key,
      metadata: {},
    });
  }
}

@Injectable()
export class DeleteOwnChainUseCase {
  constructor(
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  /** A user may delete a chain they created themselves. */
  async execute(actorId: string, id: number) {
    const chain = await this.chains.findById(id);
    if (!chain) throw new NotFoundError('Chain');
    if (chain.ownerId !== actorId) {
      throw new ForbiddenError('You can only delete chains you created');
    }
    await this.chains.delete(id);
    await this.audit.record({
      adminId: actorId,
      action: 'chain.delete-own',
      targetType: 'chain',
      targetId: chain.key,
      metadata: {},
    });
  }
}
