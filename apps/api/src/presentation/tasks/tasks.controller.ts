import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import { RolesGuard } from '../shared/roles.guard';
import type { RequestUser } from '../shared/jwt.strategy';
import { CreateTaskDto, PaginationDto } from '../dto/task.dto';
import { CreateTaskUseCase } from '../../application/tasks/create-task.use-case';
import {
  GetTaskUseCase,
  ListTaskLogsUseCase,
  ListTasksUseCase,
  StopTaskUseCase,
} from '../../application/tasks/task.use-cases';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(
    private readonly create: CreateTaskUseCase,
    private readonly list: ListTasksUseCase,
    private readonly get: GetTaskUseCase,
    private readonly stop: StopTaskUseCase,
    private readonly logs: ListTaskLogsUseCase,
  ) {}

  @Get()
  listAction(@CurrentUser() user: RequestUser, @Query() pagination: PaginationDto) {
    return this.list.execute(user, pagination.page, pagination.limit);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  createAction(@CurrentUser() user: RequestUser, @Body() dto: CreateTaskDto) {
    return this.create.execute(user.userId, dto);
  }

  @Get('active')
  activeAction(@CurrentUser() user: RequestUser) {
    return this.list.executeActive(user);
  }

  @Get(':id')
  getAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.get.execute(id, user);
  }

  @Post(':id/stop')
  stopAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.stop.execute(id, user);
  }

  @Get(':id/logs')
  logsAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.logs.execute(id, user, pagination.page, pagination.limit);
  }
}
