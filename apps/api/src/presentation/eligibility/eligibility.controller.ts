import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsInt, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import type { RequestUser } from '../shared/jwt.strategy';
import { CheckEligibilityUseCase } from '../../application/eligibility/check-eligibility.use-case';
import { ResolveCollectionUseCase } from '../../application/eligibility/resolve-collection.use-case';
import { RarityScannerUseCase } from '../../application/eligibility/rarity-scanner.use-case';

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
  constructor(
    private readonly check: CheckEligibilityUseCase,
    private readonly resolve: ResolveCollectionUseCase,
    private readonly rarity: RarityScannerUseCase,
  ) {}

  @Get('resolve')
  resolveAction(@Query('input') input: string, @Query('chainKey') chainKey?: string) {
    return this.resolve.execute(input || '', chainKey);
  }

  @Get('rarity')
  rarityAction(
    @Query('input') input: string,
    @Query('chainKey') chainKey?: string,
    @Query('maxScan') maxScan?: string,
  ) {
    const max = Math.min(Number(maxScan) || 500, 2000);
    return this.rarity.execute(input || '', chainKey, max);
  }

  @Post('check')
  checkAction(@CurrentUser() user: RequestUser, @Body() dto: CheckEligibilityDto) {
    return this.check.execute(user.userId, dto);
  }
}
