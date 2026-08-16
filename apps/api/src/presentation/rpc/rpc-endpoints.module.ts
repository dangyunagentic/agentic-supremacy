import { Module } from '@nestjs/common';
import { RpcEndpointsController } from './rpc-endpoints.controller';
import {
  CreateRpcEndpointUseCase,
  DeleteRpcEndpointUseCase,
  ListRpcEndpointsUseCase,
  PingRpcEndpointUseCase,
} from '../../application/rpc/rpc-endpoint.use-cases';

@Module({
  providers: [
    CreateRpcEndpointUseCase,
    ListRpcEndpointsUseCase,
    DeleteRpcEndpointUseCase,
    PingRpcEndpointUseCase,
  ],
  controllers: [RpcEndpointsController],
})
export class RpcEndpointsModule {}
