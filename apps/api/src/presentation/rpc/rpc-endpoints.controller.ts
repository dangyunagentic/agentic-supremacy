import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../shared/jwt.strategy';
import { CurrentUser } from '../shared/current-user.decorator';
import type { RequestUser } from '../shared/jwt.strategy';
import {
  CreateRpcEndpointUseCase,
  DeleteRpcEndpointUseCase,
  ListRpcEndpointsUseCase,
  PingRpcEndpointUseCase,
} from '../../application/rpc/rpc-endpoint.use-cases';
import { RpcProviderValues } from '@mintbot/shared';

export class CreateRpcEndpointDto {
  @IsString()
  chainKey!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsString()
  @MinLength(8)
  url!: string;

  @IsOptional()
  @IsIn(RpcProviderValues)
  provider?: string;

  @IsOptional()
  @IsIn(['free', 'paid'])
  tier?: string;
}

@Controller('rpc-endpoints')
@UseGuards(JwtAuthGuard)
export class RpcEndpointsController {
  constructor(
    private readonly create: CreateRpcEndpointUseCase,
    private readonly list: ListRpcEndpointsUseCase,
    private readonly remove: DeleteRpcEndpointUseCase,
    private readonly ping: PingRpcEndpointUseCase,
  ) {}

  @Get()
  listAction(@CurrentUser() user: RequestUser, @Query('chain') chain?: string) {
    return this.list.execute(user.userId, chain);
  }

  @Post()
  createAction(@CurrentUser() user: RequestUser, @Body() dto: CreateRpcEndpointDto) {
    return this.create.execute(user.userId, dto);
  }

  @Post(':id/ping')
  pingAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ping.execute(user.userId, id);
  }

  @Delete(':id')
  deleteAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.remove.execute(user.userId, id);
  }
}
