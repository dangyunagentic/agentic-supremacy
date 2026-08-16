import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { ListChainsUseCase } from '../../application/admin/chain.use-cases';

/** Active chains are visible to every authenticated user (task wizard). */
@Controller('chains')
@UseGuards(JwtAuthGuard)
export class ChainsController {
  constructor(private readonly listChains: ListChainsUseCase) {}

  @Get()
  listAction() {
    return this.listChains.executeActive();
  }
}
