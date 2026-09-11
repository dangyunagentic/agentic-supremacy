import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RequestUser } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import { RolesGuard } from '../shared/roles.guard';
import { CreateSocialAccountDto, RunSocialActionDto, UpdateSocialAccountDto } from '../dto/social.dto';
import { SocialAccountUseCases } from '../../application/social/social.use-cases';
import { PaginationDto } from '../dto/task.dto';

@Controller('social')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SocialController {
  constructor(private readonly social: SocialAccountUseCases) {}

  @Get('accounts')
  listAccounts(@CurrentUser() user: RequestUser, @Query('platform') platform?: string) {
    return this.social.listAccounts(user.userId, platform);
  }

  @Post('accounts')
  createAccount(@CurrentUser() user: RequestUser, @Body() dto: CreateSocialAccountDto) {
    return this.social.createAccount(user.userId, dto);
  }

  @Patch('accounts/:id')
  updateAccount(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSocialAccountDto,
  ) {
    return this.social.updateAccount(user.userId, id, dto);
  }

  @Delete('accounts/:id')
  deleteAccount(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.deleteAccount(user.userId, id);
  }

  @Post('accounts/:id/test')
  testAccount(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.testConnection(user.userId, id);
  }

  @Post('run')
  runAction(@CurrentUser() user: RequestUser, @Body() dto: RunSocialActionDto) {
    return this.social.runAction(user.userId, dto);
  }

  @Get('runs')
  listRuns(@CurrentUser() user: RequestUser, @Query() pagination: PaginationDto) {
    return this.social.listRuns(user.userId, pagination.page ?? 1, pagination.limit ?? 20);
  }
}
