import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { ChainQueryPort, KeyEncryptionPort } from '../../domain/ports/ports';
import { NotFoundError, ValidationError } from '../common/app-error';
import { formatEth, TRACKED_TOKENS, NATIVE_TOKEN_ADDRESS, getChainProfile } from '@mintbot/shared';
import { toWalletView } from './create-wallet.use-case';

@Injectable()
export class ListWalletsUseCase {
  constructor(@Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository) {}

  async executeForUser(userId: string) {
    const list = await this.wallets.listByUser(userId);
    return list.map((w) => ({
      id: w.id,
      address: w.address,
      label: w.label,
      chainId: w.chainId,
      createdAt: w.createdAt.toISOString(),
    }));
  }

  async executeAll(page: number, limit: number, ownerId?: string) {
    return this.wallets.listAll({ page, limit, ownerId });
  }
}

@Injectable()
export class DeleteWalletUseCase {
  constructor(@Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository) {}

  async execute(walletId: string, requesterId: string, isAdmin: boolean) {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) throw new NotFoundError('Wallet');
    if (!isAdmin && wallet.userId !== requesterId) throw new NotFoundError('Wallet');
    await this.wallets.delete(walletId);
    return { success: true };
  }
}

@Injectable()
export class RenameWalletUseCase {
  constructor(@Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository) {}

  async execute(walletId: string, requesterId: string, isAdmin: boolean, label: string | null) {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) throw new NotFoundError('Wallet');
    if (!isAdmin && wallet.userId !== requesterId) throw new NotFoundError('Wallet');
    const trimmed = label?.trim();
    const updated = await this.wallets.updateLabel(walletId, trimmed ? trimmed : null);
    return toWalletView(updated);
  }
}

@Injectable()
export class GetWalletBalanceUseCase {
  constructor(
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.ChainQuery) private readonly chainQuery: ChainQueryPort,
  ) {}

  async execute(walletId: string, requesterId: string, isAdmin: boolean, chainKey: string) {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) throw new NotFoundError('Wallet');
    if (!isAdmin && wallet.userId !== requesterId) throw new NotFoundError('Wallet');
    if (!chainKey) throw new ValidationError('Chain is required');

    const wei = await this.chainQuery.getNativeBalance(chainKey, wallet.address);
    return { address: wallet.address, chainKey, balanceWei: wei.toString(), balance: formatEth(wei) };
  }
}

@Injectable()
export class GetWalletPortfolioUseCase {
  constructor(
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.ChainQuery) private readonly chainQuery: ChainQueryPort,
  ) {}

  /** Returns native balance + tracked ERC-20 balances for a wallet on a chain. */
  async execute(walletId: string, requesterId: string, isAdmin: boolean, chainKey: string) {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) throw new NotFoundError('Wallet');
    if (!isAdmin && wallet.userId !== requesterId) throw new NotFoundError('Wallet');
    if (!chainKey) throw new ValidationError('Chain is required');

    const profile = getChainProfile(chainKey);
    if (!profile) throw new ValidationError('Unknown chain');

    const nativeWei = await this.chainQuery.getNativeBalance(chainKey, wallet.address);
    const tracked = TRACKED_TOKENS[chainKey.toLowerCase()] ?? [];

    const tokens = await Promise.all(
      tracked.map(async (t) => {
        try {
          const res = await this.chainQuery.getTokenBalance(chainKey, wallet.address, t.address);
          const decimals = t.decimals || res.decimals;
          const balance = formatToken(res.balance, decimals);
          return {
            symbol: t.symbol,
            address: t.address,
            decimals,
            balanceWei: res.balance.toString(),
            balance,
          };
        } catch {
          return {
            symbol: t.symbol,
            address: t.address,
            decimals: t.decimals,
            balanceWei: '0',
            balance: '0',
          };
        }
      }),
    );

    return {
      id: wallet.id,
      address: wallet.address,
      label: wallet.label,
      chainId: profile.chainId,
      chainKey,
      nativeSymbol: profile.nativeSymbol,
      nativeBalanceWei: nativeWei.toString(),
      nativeBalance: formatEth(nativeWei),
      tokens,
    };
  }
}

function formatToken(wei: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

@Injectable()
export class ExportWalletKeyUseCase {
  constructor(
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.KeyEncryption) private readonly crypto: KeyEncryptionPort,
  ) {}

  /**
   * Decrypts a wallet's private key. Only the wallet owner (or an admin) may
   * export. Returns the address + raw private key so the user can import it
   * elsewhere (Metamask, other bots, etc.).
   */
  async execute(walletId: string, requesterId: string, isAdmin: boolean) {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) throw new NotFoundError('Wallet');
    if (!isAdmin && wallet.userId !== requesterId) throw new NotFoundError('Wallet');

    return {
      id: wallet.id,
      address: wallet.address,
      privateKey: this.crypto.decrypt(wallet.encryptedKey),
    };
  }
}

@Injectable()
export class BulkDeleteWalletsUseCase {
  constructor(@Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository) {}

  /**
   * Deletes many wallets at once. A non-admin only deletes wallets they own;
   * an admin deletes any. Returns how many were actually removed.
   */
  async execute(ids: string[], requesterId: string, isAdmin: boolean) {
    if (!ids || ids.length === 0) throw new ValidationError('At least one wallet id is required');
    const deleted = isAdmin
      ? await this.wallets.deleteMany(ids)
      : await this.wallets.deleteMany(ids, requesterId);
    return { deleted };
  }
}
