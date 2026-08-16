import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@mintbot/shared';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import { Roles, RolesGuard } from '../shared/roles.guard';
import type { RequestUser } from '../shared/jwt.strategy';
import { PaginationDto } from '../dto/task.dto';
import {
  AdminCreateUserDto,
  AdminUpdateUserDto,
  CreateChainDto,
  UpdateChainDto,
  UpdateSystemConfigDto,
} from '../dto/admin.dto';
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

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
export class AdminController {
  constructor(
    // users
    private readonly listUsers: ListUsersUseCase,
    private readonly createUser: AdminCreateUserUseCase,
    private readonly updateUser: AdminUpdateUserUseCase,
    private readonly deleteUser: AdminDeleteUserUseCase,
    // chains
    private readonly listChains: ListChainsUseCase,
    private readonly createChain: CreateChainUseCase,
    private readonly updateChain: UpdateChainUseCase,
    private readonly deleteChain: DeleteChainUseCase,
    // system
    private readonly stats: GetAdminStatsUseCase,
    private readonly audit: ListAuditLogUseCase,
    private readonly getConfig: GetSystemConfigUseCase,
    private readonly updateConfig: UpdateSystemConfigUseCase,
  ) {}

  // ── Users ──

  @Get('users')
  usersAction(@Query() pagination: PaginationDto, @Query('search') search?: string) {
    return this.listUsers.execute(pagination.page, pagination.limit, search);
  }

  @Post('users')
  createUserAction(@CurrentUser() user: RequestUser, @Body() dto: AdminCreateUserDto) {
    return this.createUser.execute(user.userId, dto);
  }

  @Patch('users/:id')
  updateUserAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.updateUser.execute(user.userId, id, dto);
  }

  @Delete('users/:id')
  deleteUserAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deleteUser.execute(user.userId, id);
  }

  // ── Chains ──

  @Get('chains')
  chainsAction() {
    return this.listChains.executeAll();
  }

  @Post('chains')
  createChainAction(@CurrentUser() user: RequestUser, @Body() dto: CreateChainDto) {
    return this.createChain.execute(user.userId, dto);
  }

  @Patch('chains/:id')
  updateChainAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateChainDto,
  ) {
    return this.updateChain.execute(user.userId, id, dto as Record<string, unknown>);
  }

  @Delete('chains/:id')
  deleteChainAction(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.deleteChain.execute(user.userId, id);
  }

  // ── System ──

  @Get('stats')
  statsAction() {
    return this.stats.execute();
  }

  @Get('audit-log')
  auditAction(@Query() pagination: PaginationDto) {
    return this.audit.execute(pagination.page, pagination.limit);
  }

  @Get('config')
  configAction() {
    return this.getConfig.execute();
  }

  @Patch('config')
  updateConfigAction(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateSystemConfigDto,
  ) {
    return this.updateConfig.execute(user.userId, dto as Record<string, unknown>);
  }
}
