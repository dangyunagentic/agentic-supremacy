import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import {
  CreateTransferUseCase,
  ListTransfersUseCase,
} from '../../application/transfers/transfer.use-cases';

@Module({
  providers: [CreateTransferUseCase, ListTransfersUseCase],
  controllers: [TransfersController],
})
export class TransfersModule {}
