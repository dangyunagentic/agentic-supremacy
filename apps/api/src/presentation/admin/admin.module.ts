import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import {
  AdminCreateUserUseCase,
  AdminDeleteUserUseCase,
  AdminUpdateUserUseCase,
  ListUsersUseCase,
} from '../../application/admin/user.use-cases';
import {
  CreateChainUseCase,
  DeleteChainUseCase,
  ListChainsUseCase,
  UpdateChainUseCase,
} from '../../application/admin/chain.use-cases';
import {
  GetAdminStatsUseCase,
  GetSystemConfigUseCase,
  ListAuditLogUseCase,
  UpdateSystemConfigUseCase,
} from '../../application/admin/system.use-cases';

@Module({
  providers: [
    ListUsersUseCase,
    AdminCreateUserUseCase,
    AdminUpdateUserUseCase,
    AdminDeleteUserUseCase,
    ListChainsUseCase,
    CreateChainUseCase,
    UpdateChainUseCase,
    DeleteChainUseCase,
    GetAdminStatsUseCase,
    ListAuditLogUseCase,
    GetSystemConfigUseCase,
    UpdateSystemConfigUseCase,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
