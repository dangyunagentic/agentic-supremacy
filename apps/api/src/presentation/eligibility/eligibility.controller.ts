import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsInt, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import type { RequestUser } from '../shared/jwt.strategy';
import { CheckEligibilityUseCase } from '../../application/eligibility/check-eligibility.use-case';

export class CheckEligibilityDto {
  @IsString()
  @MinLength(2)
  collection!: string;

  @IsString()
  chainKey!: string;

  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number = 1;
}

@Controller('eligibility')
@UseGuards(JwtAuthGuard)
export class EligibilityController {
  constructor(private readonly check: CheckEligibilityUseCase) {}

  @Post('check')
  checkAction(@CurrentUser() user: RequestUser, @Body() dto: CheckEligibilityDto) {
    return this.check.execute(user.userId, dto);
  }
}
