import { Module } from '@nestjs/common';
import { ChainsController } from './chains.controller';
import { ListChainsUseCase, CreateChainUseCase } from '../../application/admin/chain.use-cases';

@Module({
  providers: [ListChainsUseCase, CreateChainUseCase],
  controllers: [ChainsController],
})
export class SystemModule {}
