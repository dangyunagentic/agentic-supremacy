import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import { RolesGuard } from '../shared/roles.guard';
import type { RequestUser } from '../shared/jwt.strategy';
import { CreateWalletDto, RenameWalletDto, BulkDeleteWalletsDto } from '../dto/wallet.dto';
import { PaginationDto } from '../dto/task.dto';
import { CreateWalletUseCase, toWalletView } from '../../application/wallets/create-wallet.use-case';
import {
  BulkDeleteWalletsUseCase,
  DeleteWalletUseCase,
  ExportWalletKeyUseCase,
  GetWalletBalanceUseCase,
  GetWalletPortfolioUseCase,
  ListWalletsUseCase,
  RenameWalletUseCase,
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
    private readonly portfolio: GetWalletPortfolioUseCase,
    private readonly rename: RenameWalletUseCase,
    private readonly exportKey: ExportWalletKeyUseCase,
    private readonly bulkDelete: BulkDeleteWalletsUseCase,
  ) {}

  @Get()
  listAction(@CurrentUser() user: RequestUser) {
    return this.list.executeForUser(user.userId);
  }

  @Post()
  createAction(@CurrentUser() user: RequestUser, @Body() dto: CreateWalletDto) {
    return this.create
      .execute({ userId: user.userId, ...dto })
      .then((wallets) => wallets.map((w) => toWalletView(w)));
  }

  @Patch(':id/label')
  renameAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameWalletDto,
  ) {
    return this.rename.execute(id, user.userId, user.role === Role.Admin, dto.label ?? null);
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

  @Get(':id/portfolio')
  portfolioAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('chain') chain: string,
  ) {
    return this.portfolio.execute(id, user.userId, user.role === Role.Admin, chain);
  }

  @Get(':id/key')
  exportKeyAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exportKey.execute(id, user.userId, user.role === Role.Admin);
  }

  @Post('bulk-delete')
  bulkDeleteAction(@CurrentUser() user: RequestUser, @Body() dto: BulkDeleteWalletsDto) {
    return this.bulkDelete.execute(dto.ids, user.userId, user.role === Role.Admin);
  }
}
