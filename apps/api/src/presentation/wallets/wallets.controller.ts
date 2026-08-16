import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import { RolesGuard } from '../shared/roles.guard';
import type { RequestUser } from '../shared/jwt.strategy';
import { CreateWalletDto } from '../dto/wallet.dto';
import { PaginationDto } from '../dto/task.dto';
import { CreateWalletUseCase, toWalletView } from '../../application/wallets/create-wallet.use-case';
import {
  DeleteWalletUseCase,
  GetWalletBalanceUseCase,
  ListWalletsUseCase,
} from '../../application/wallets/wallet.use-cases';
import { Role } from '@mintbot/shared';

@Controller('wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WalletsController {
  constructor(
    private readonly create: CreateWalletUseCase,
    private readonly list: ListWalletsUseCase,
    private readonly remove: DeleteWalletUseCase,
    private readonly balance: GetWalletBalanceUseCase,
  ) {}

  @Get()
  listAction(@CurrentUser() user: RequestUser) {
    return this.list.executeForUser(user.userId);
  }

  @Post()
  createAction(@CurrentUser() user: RequestUser, @Body() dto: CreateWalletDto) {
    return this.create.execute({ userId: user.userId, ...dto }).then(toWalletView);
  }

  @Delete(':id')
  removeAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.remove.execute(id, user.userId, user.role === Role.Admin);
  }

  @Get(':id/balance')
  balanceAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('chain') chain: string,
  ) {
    return this.balance.execute(id, user.userId, user.role === Role.Admin, chain);
  }
}
