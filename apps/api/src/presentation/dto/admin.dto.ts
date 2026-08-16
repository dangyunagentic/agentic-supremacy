import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Role, UserStatus } from '@mintbot/shared';

export class AdminCreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  username!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class AdminUpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  password?: string;
}

export class CreateChainDto {
  @IsString()
  key!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  chainId!: number;

  @IsString()
  name!: string;

  @IsString()
  explorer!: string;

  @IsString()
  nativeSymbol!: string;

  @IsArray()
  @IsString({ each: true })
  publicRpcs!: string[];

  @IsOptional()
  @IsString()
  defaultPrivateRpc?: string | null;

  @IsOptional()
  @IsString()
  seadropAddress?: string;
}

export class UpdateChainDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  explorer?: string;

  @IsOptional()
  @IsString()
  nativeSymbol?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publicRpcs?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSystemConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultGasLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultMaxFeeGwei?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultPriorityGwei?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  scheduleRefreshSec?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  txMaxAttempts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pendingTimeoutSec?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  receiptPollBaseMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  receiptPollMaxMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  replacementBumpBps?: number;

  @IsOptional()
  @IsString()
  openseaApiKey?: string;
}
