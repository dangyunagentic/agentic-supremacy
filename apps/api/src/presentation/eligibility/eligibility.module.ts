import { Module } from '@nestjs/common';
import { EligibilityController } from './eligibility.controller';
import { CheckEligibilityUseCase } from '../../application/eligibility/check-eligibility.use-case';

@Module({
  providers: [CheckEligibilityUseCase],
  controllers: [EligibilityController],
})
export class EligibilityModule {}
