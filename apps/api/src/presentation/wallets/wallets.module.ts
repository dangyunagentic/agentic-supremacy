import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { CreateWalletUseCase } from '../../application/wallets/create-wallet.use-case';
import {
  DeleteWalletUseCase,
  GetWalletBalanceUseCase,
  ListWalletsUseCase,
} from '../../application/wallets/wallet.use-cases';

@Module({
  providers: [CreateWalletUseCase, ListWalletsUseCase, DeleteWalletUseCase, GetWalletBalanceUseCase],
  controllers: [WalletsController],
})
export class WalletsModule {}
