import { Global, Module } from '@nestjs/common';
import { EthersChainQuery } from './ethers-chain-query';
import { OpenSeaEligibilityApi } from '../eligibility/opensea-eligibility.api';
import { TOKENS } from '../../domain/tokens';

@Global()
@Module({
  providers: [
    { provide: TOKENS.ChainQuery, useClass: EthersChainQuery },
    { provide: TOKENS.EligibilityApi, useClass: OpenSeaEligibilityApi },
  ],
  exports: [TOKENS.ChainQuery, TOKENS.EligibilityApi],
})
export class ChainModule {}
