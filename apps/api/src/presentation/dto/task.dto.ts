import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MintMode, TimingMode, WalletMode } from '@mintbot/shared';

export class PaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  collection!: string;

  @IsString()
  chainKey!: string;

  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  @IsEnum(MintMode)
  mintMode!: MintMode;

  @IsEnum(WalletMode)
  walletMode!: WalletMode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxFeeGwei?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPriorityGwei?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(21000)
  @Max(2000000)
  gasLimit?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rpcUrls?: string[];

  @IsEnum(TimingMode)
  timingMode!: TimingMode;

  @IsOptional()
  @IsString()
  customFireTime?: string | null;

  @IsOptional()
  @IsString()
  recipientAddress?: string | null;

  @IsOptional()
  @IsString()
  sponsorWalletId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerNft?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  proxyGroup?: string | null;

  @IsOptional()
  @IsBoolean()
  fundedOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  flashbots?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  nonce?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fireTimestamp?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600000)
  delayMs?: number;

  @IsOptional()
  @IsBoolean()
  simulate?: boolean;

  @IsOptional()
  @IsBoolean()
  spam?: boolean;

  @IsOptional()
  @IsBoolean()
  action?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxTx?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  earlyFireMs?: number;
}
