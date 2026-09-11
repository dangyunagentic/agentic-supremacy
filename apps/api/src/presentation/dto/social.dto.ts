import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const PLATFORMS = ['x', 'gmail', 'discord'] as const;

export class CreateSocialAccountDto {
  @IsIn(PLATFORMS)
  platform!: string;

  @IsString()
  @MaxLength(128)
  username!: string;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  displayName?: string | null;

  @IsObject()
  credentials!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  proxy?: string | null;
}

export class UpdateSocialAccountDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  displayName?: string | null;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  proxy?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const ACTIONS = [
  'x_follow',
  'x_unfollow',
  'x_reply',
  'x_repost',
  'form_submit',
  'wallet_submit',
  'captcha_solve',
] as const;

export class RunSocialActionDto {
  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsIn(ACTIONS)
  action!: string;

  @IsOptional()
  @IsString()
  proxy?: string | null;

  @IsObject()
  input!: Record<string, unknown>;
}
