import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { CreateWalletUseCase } from '../../application/wallets/create-wallet.use-case';
import {
  DeleteWalletUseCase,
  ExportWalletKeyUseCase,
  GetWalletBalanceUseCase,
  ListWalletsUseCase,
  RenameWalletUseCase,
} from '../../application/wallets/wallet.use-cases';

@Module({
  providers: [
    CreateWalletUseCase,
    ListWalletsUseCase,
    DeleteWalletUseCase,
    GetWalletBalanceUseCase,
    RenameWalletUseCase,
    ExportWalletKeyUseCase,
  ],
  controllers: [WalletsController],
})
export class WalletsModule {}
