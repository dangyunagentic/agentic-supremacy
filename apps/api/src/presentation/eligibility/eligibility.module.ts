import { Module } from '@nestjs/common';
import { EligibilityController } from './eligibility.controller';
import { CheckEligibilityUseCase } from '../../application/eligibility/check-eligibility.use-case';
import { ResolveCollectionUseCase } from '../../application/eligibility/resolve-collection.use-case';
import { RarityScannerUseCase } from '../../application/eligibility/rarity-scanner.use-case';

@Module({
  providers: [CheckEligibilityUseCase, ResolveCollectionUseCase, RarityScannerUseCase],
  controllers: [EligibilityController],
})
export class EligibilityModule {}
