import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import type { RequestUser } from '../shared/jwt.strategy';
import { ListChainsUseCase, CreateChainUseCase } from '../../application/admin/chain.use-cases';
import { CreateChainDto } from '../dto/admin.dto';

/**
 * Active chains are visible to every authenticated user (task wizard), and any
 * authenticated user may register a new chain (e.g. a newly-launched EVM L2
 * already live on OpenSea) without waiting for an admin. Update/delete remain
 * admin-only (see AdminController) since chains are shared globally.
 */
@Controller('chains')
@UseGuards(JwtAuthGuard)
export class ChainsController {
  constructor(
    private readonly listChains: ListChainsUseCase,
    private readonly createChain: CreateChainUseCase,
  ) {}

  @Get()
  listAction() {
    return this.listChains.executeActive();
  }

  @Post()
  createAction(@CurrentUser() user: RequestUser, @Body() dto: CreateChainDto) {
    return this.createChain.execute(user.userId, dto);
  }
}
