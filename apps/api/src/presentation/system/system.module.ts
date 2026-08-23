import { Module } from '@nestjs/common';
import { ChainsController } from './chains.controller';
import {
  ListChainsUseCase,
  CreateChainUseCase,
  DeleteOwnChainUseCase,
} from '../../application/admin/chain.use-cases';

@Module({
  providers: [ListChainsUseCase, CreateChainUseCase, DeleteOwnChainUseCase],
  controllers: [ChainsController],
})
export class SystemModule {}
