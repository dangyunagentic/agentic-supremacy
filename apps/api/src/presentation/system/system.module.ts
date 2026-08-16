import { Module } from '@nestjs/common';
import { ChainsController } from './chains.controller';
import { ListChainsUseCase } from '../../application/admin/chain.use-cases';

@Module({
  providers: [ListChainsUseCase],
  controllers: [ChainsController],
})
export class SystemModule {}
