import { Module } from '@nestjs/common';
import { EligibilityController } from './eligibility.controller';
import { CheckEligibilityUseCase } from '../../application/eligibility/check-eligibility.use-case';
import { ResolveCollectionUseCase } from '../../application/eligibility/resolve-collection.use-case';

@Module({
  providers: [CheckEligibilityUseCase, ResolveCollectionUseCase],
  controllers: [EligibilityController],
})
export class EligibilityModule {}
