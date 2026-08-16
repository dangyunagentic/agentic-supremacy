import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../../domain/tokens';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { ChainQueryPort } from '../../domain/ports/ports';
import { NotFoundError, ValidationError } from '../common/app-error';
import { formatEth } from '@mintbot/shared';

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
