import { Global, Module } from '@nestjs/common';
import { BullMintScheduler } from './bull-mint-scheduler';
import { TOKENS } from '../../domain/tokens';

@Global()
@Module({
  providers: [{ provide: TOKENS.MintScheduler, useClass: BullMintScheduler }],
  exports: [TOKENS.MintScheduler],
})
export class QueueModule {}
