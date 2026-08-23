import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateWalletDto {
  @IsIn(['generate', 'import'])
  mode!: 'generate' | 'import';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  count?: number;

  @IsOptional()
  @IsString()
  privateKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @IsOptional()
  @IsString()
  chainKey?: string;
}

export class RenameWalletDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;
}
