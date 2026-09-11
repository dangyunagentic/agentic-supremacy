import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import type { RequestUser } from '../shared/jwt.strategy';
import { PaginationDto } from '../dto/task.dto';
import {
  CreateTransferUseCase,
  ListTransfersUseCase,
} from '../../application/transfers/transfer.use-cases';
import type { CreateDisperseInput, CreateConsolidateInput } from '../../application/transfers/transfer.use-cases';
import { GetNftInfoUseCase } from '../../application/transfers/get-nft-info.use-case';

export class CreateFundTransferDto {
  @IsString()
  chainKey!: string;

  @IsString()
  fromWalletId!: string;

  @IsArray()
  @IsString({ each: true })
  toWalletIds!: string[];

  @IsString()
  @MinLength(1)
  amountEth!: string;
}

export class CreateTransferNftDto {
  @IsString()
  chainKey!: string;

  @IsArray()
  @IsString({ each: true })
  fromWalletIds!: string[];

  @IsString()
  recipientAddress!: string;

  @IsString()
  tokenContract!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fromBlock?: number;
}

export class CreateDisperseDto {
  @IsString()
  chainKey!: string;

  @IsString()
  fromWalletId!: string;

  @IsArray()
  entries!: { address: string; amountEth: string }[];
}

export class CreateConsolidateDto {
  @IsString()
  chainKey!: string;

  @IsIn(['native', 'erc20'])
  mode!: 'native' | 'erc20';

  @IsArray()
  @IsString({ each: true })
  fromWalletIds!: string[];

  @IsString()
  toAddress!: string;

  @IsOptional()
  @IsString()
  tokenContract?: string;

  @IsOptional()
  @IsString()
  tokenSymbol?: string;
}

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(
    private readonly create: CreateTransferUseCase,
    private readonly list: ListTransfersUseCase,
    private readonly getNftInfo: GetNftInfoUseCase,
  ) {}

  @Get('nft-info')
  nftInfoAction(@Query('chainKey') chainKey: string, @Query('address') address: string) {
    return this.getNftInfo.execute(chainKey, address);
  }

  @Post('fund')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  fundAction(@CurrentUser() user: RequestUser, @Body() dto: CreateFundTransferDto) {
    return this.create.executeFund(user.userId, dto);
  }

  @Post('transfer-nft')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  transferNftAction(@CurrentUser() user: RequestUser, @Body() dto: CreateTransferNftDto) {
    return this.create.executeTransferNft(user.userId, dto);
  }

  @Post('disperse')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  disperseAction(@CurrentUser() user: RequestUser, @Body() dto: CreateDisperseDto) {
    return this.create.executeDisperse(user.userId, dto as CreateDisperseInput);
  }

  @Post('consolidate')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  consolidateAction(@CurrentUser() user: RequestUser, @Body() dto: CreateConsolidateDto) {
    return this.create.executeConsolidate(user.userId, dto as CreateConsolidateInput);
  }

  @Get()
  listAction(@CurrentUser() user: RequestUser, @Query() pagination: PaginationDto) {
    return this.list.execute(user.userId, pagination.page, pagination.limit);
  }

  @Get(':id')
  getAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.list.execute(user.userId, 1, 100).then((page) =>
      page.data.find((t) => t.id === id) ?? null,
    );
  }
}
