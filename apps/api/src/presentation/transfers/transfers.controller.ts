import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import type { RequestUser } from '../shared/jwt.strategy';
import { PaginationDto } from '../dto/task.dto';
import {
  CreateTransferUseCase,
  ListTransfersUseCase,
} from '../../application/transfers/transfer.use-cases';

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

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(
    private readonly create: CreateTransferUseCase,
    private readonly list: ListTransfersUseCase,
  ) {}

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
