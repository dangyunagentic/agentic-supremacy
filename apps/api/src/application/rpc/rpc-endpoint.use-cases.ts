import { Inject, Injectable } from '@nestjs/common';
import { RpcProviderValues, RpcTier, type RpcEndpointView } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { RpcEndpointRepository } from '../../domain/repositories/transfer.repository';
import type { ChainQueryPort } from '../../domain/ports/ports';
import { NotFoundError, ValidationError } from '../common/app-error';
import { assertSafePublicUrl } from '../../infrastructure/security/ssrf-guard';

const KNOWN_PROVIDERS = ['alchemy', 'quicknode', 'drpc', 'custom'];

@Injectable()
export class CreateRpcEndpointUseCase {
  constructor(
    @Inject(TOKENS.RpcEndpointRepository) private readonly endpoints: RpcEndpointRepository,
  ) {}

  async execute(
    userId: string,
    input: { chainKey: string; label?: string; url: string; provider?: string; tier?: string },
  ): Promise<RpcEndpointView> {
    const url = input.url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new ValidationError('RPC URL must start with http(s)://');
    try {
      await assertSafePublicUrl(url);
    } catch (err) {
      throw new ValidationError(`RPC URL rejected: ${(err as Error).message}`);
    }
    if (input.provider && !KNOWN_PROVIDERS.includes(input.provider)) {
      throw new ValidationError(`Provider must be one of: ${RpcProviderValues.join(', ')}`);
    }
    if (input.tier && !['free', 'paid'].includes(input.tier)) {
      throw new ValidationError('Tier must be free or paid');
    }
    const label = input.label?.trim() || `${input.provider ?? 'custom'} ${input.chainKey}`;

    const endpoint = await this.endpoints.create({
      userId,
      chainKey: input.chainKey,
      label,
      url,
      provider: input.provider ?? 'custom',
      tier: input.tier ?? RpcTier.Free,
    });
    return toView(endpoint);
  }
}

@Injectable()
export class ListRpcEndpointsUseCase {
  constructor(
    @Inject(TOKENS.RpcEndpointRepository) private readonly endpoints: RpcEndpointRepository,
  ) {}

  async execute(userId: string, chainKey?: string): Promise<RpcEndpointView[]> {
    const list = await this.endpoints.listByUser(userId, chainKey);
    return list.map(toView);
  }
}

@Injectable()
export class DeleteRpcEndpointUseCase {
  constructor(
    @Inject(TOKENS.RpcEndpointRepository) private readonly endpoints: RpcEndpointRepository,
  ) {}

  async execute(userId: string, id: string) {
    const endpoint = await this.endpoints.findById(id);
    if (!endpoint || endpoint.userId !== userId) throw new NotFoundError('RPC endpoint');
    await this.endpoints.delete(id);
  }
}

/** Probes eth_blockNumber three times and stores the median latency. */
@Injectable()
export class PingRpcEndpointUseCase {
  constructor(
    @Inject(TOKENS.RpcEndpointRepository) private readonly endpoints: RpcEndpointRepository,
    @Inject(TOKENS.ChainQuery) private readonly chainQuery: ChainQueryPort,
  ) {}

  async execute(userId: string, id: string): Promise<RpcEndpointView> {
    const endpoint = await this.endpoints.findById(id);
    if (!endpoint || endpoint.userId !== userId) throw new NotFoundError('RPC endpoint');

    let latency: number;
    try {
      await assertSafePublicUrl(endpoint.url);
      latency = await this.chainQuery.pingRpc(endpoint.url);
    } catch (err) {
      throw new ValidationError(`Ping failed: ${(err as Error).message}`);
    }

    const updated = await this.endpoints.update(id, { lastLatencyMs: latency });
    return toView(updated);
  }
}

function toView(endpoint: {
  id: string;
  chainKey: string;
  label: string;
  url: string;
  provider: string;
  tier: string;
  lastLatencyMs: number | null;
  isDefault: boolean;
  createdAt: Date;
}): RpcEndpointView {
  return {
    id: endpoint.id,
    chainKey: endpoint.chainKey,
    label: endpoint.label,
    url: endpoint.url,
    provider: endpoint.provider as RpcEndpointView['provider'],
    tier: endpoint.tier as RpcEndpointView['tier'],
    lastLatencyMs: endpoint.lastLatencyMs,
    isDefault: endpoint.isDefault,
    createdAt: endpoint.createdAt.toISOString(),
  };
}
