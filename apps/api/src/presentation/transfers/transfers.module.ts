import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import {
  CreateTransferUseCase,
  ListTransfersUseCase,
} from '../../application/transfers/transfer.use-cases';
import { GetNftInfoUseCase } from '../../application/transfers/get-nft-info.use-case';

@Module({
  providers: [CreateTransferUseCase, ListTransfersUseCase, GetNftInfoUseCase],
  controllers: [TransfersController],
})
export class TransfersModule {}
