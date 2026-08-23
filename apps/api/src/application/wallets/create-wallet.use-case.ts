import { Inject, Injectable } from '@nestjs/common';
import { HDNodeWallet, Wallet as ethersWallet } from 'ethers';
import { TOKENS } from '../../domain/tokens';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { KeyEncryptionPort } from '../../domain/ports/ports';
import type { WalletEntity } from '../../domain/entities/wallet.entity';
import { ValidationError, ConflictError } from '../common/app-error';
import { getChainProfile } from '@mintbot/shared';

export type CreateWalletMode = 'generate' | 'import';

export interface CreateWalletInput {
  userId: string;
  mode: CreateWalletMode;
  count?: number;
  privateKey?: string;
  label?: string;
  chainKey?: string;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.KeyEncryption) private readonly crypto: KeyEncryptionPort,
  ) {}

  async execute(input: CreateWalletInput): Promise<WalletEntity[]> {
    const count = input.mode === 'generate' ? input.count ?? 1 : 1;

    const created: WalletEntity[] = [];
    for (let i = 0; i < count; i++) {
      const wallet = await this.createOne(input, i, count);
      created.push(wallet);
    }
    return created;
  }

  private async createOne(input: CreateWalletInput, index: number, count: number): Promise<WalletEntity> {
    let wallet: ethersWallet | HDNodeWallet;
    if (input.mode === 'import') {
      if (!input.privateKey) throw new ValidationError('Private key is required for import');
      try {
        wallet = new ethersWallet(normalizePrivateKey(input.privateKey));
      } catch {
        throw new ValidationError('Invalid private key');
      }
    } else {
      wallet = ethersWallet.createRandom();
    }

    const address = wallet.address.toLowerCase();
    if (await this.wallets.findByAddress(address)) {
      throw new ConflictError('This wallet is already registered');
    }

    const chainId = input.chainKey ? getChainProfile(input.chainKey)?.chainId ?? 1 : 1;

    // Batch generate: label becomes a base + numeric suffix (main, main-2, ...)
    // unless a label was explicitly provided and this is a single wallet.
    let label = input.label?.trim() || null;
    if (input.mode === 'generate' && count > 1) {
      const base = input.label?.trim() || 'wallet';
      label = index === 0 ? base : `${base}-${index + 1}`;
    }

    return this.wallets.create({
      userId: input.userId,
      address,
      encryptedKey: this.crypto.encrypt(wallet.privateKey),
      label,
      chainId,
    });
  }
}

function normalizePrivateKey(key: string): string {
  const trimmed = key.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed}`;
  return trimmed;
}

export function toWalletView(wallet: WalletEntity, balance?: string | null) {
  return {
    id: wallet.id,
    address: wallet.address,
    label: wallet.label,
    chainId: wallet.chainId,
    createdAt: wallet.createdAt.toISOString(),
    ...(balance !== undefined ? { balance } : {}),
  };
}
