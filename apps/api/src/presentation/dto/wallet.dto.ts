import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWalletDto {
  @IsIn(['generate', 'import'])
  mode!: 'generate' | 'import';

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
