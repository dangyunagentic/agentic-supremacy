import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import IORedis from 'ioredis';
import { Inject } from '@nestjs/common';
import {
  TASK_EVENTS_CHANNEL,
  WS_EVENTS,
  type TaskEvent,
} from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { TaskRepository } from '../../domain/repositories/task.repository';
import type { TokenServicePort } from '../../domain/ports/ports';

export interface AuthedSocket extends Socket {
  data: { userId: string; role: string };
}

/**
 * Dashboard live stream. Clients authenticate with the same JWT as the REST
 * API, then join `task:<id>` rooms. The worker publishes execution events on
 * Redis; this gateway relays them to subscribed sockets.
 */
@WebSocketGateway({
  namespace: '/',
  cors: {
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: false,
  },
})
export class TasksGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TasksGateway.name);
  private readonly sub: IORedis;

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(TOKENS.TokenService) private readonly tokens: TokenServicePort,
    @Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository,
  ) {
    this.sub = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    void this.subscribeToWorkerEvents();
  }

  private async subscribeToWorkerEvents() {
    await this.sub.subscribe(TASK_EVENTS_CHANNEL);
    this.sub.on('message', (_channel, raw) => {
      try {
        const event = JSON.parse(raw) as TaskEvent;
        const room = `task:${event.payload.taskId}`;
        switch (event.type) {
          case 'status':
            this.server.to(room).emit(WS_EVENTS.STATUS, event.payload);
            break;
          case 'log':
            this.server.to(room).emit(WS_EVENTS.LOG, event.payload);
            break;
          case 'wallet':
            this.server.to(room).emit(WS_EVENTS.WALLET, event.payload);
            break;
          case 'complete':
            this.server.to(room).emit(WS_EVENTS.COMPLETE, event.payload);
            break;
        }
      } catch (err) {
        this.logger.warn(`Bad event payload: ${(err as Error).message}`);
      }
    });
  }

  async handleConnection(client: AuthedSocket) {
    try {
      const token = this.extractToken(client);
      const payload = await this.tokens.verifyAccess(token);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthedSocket) {
    void client;
  }

  @SubscribeMessage(WS_EVENTS.JOIN)
  async onJoin(client: AuthedSocket, payload: { taskId: string }) {
    if (!payload?.taskId) return;
    const task = await this.tasks.findById(payload.taskId);
    if (!task) return;
    if (client.data.role !== 'admin' && task.userId !== client.data.userId) return;
    await client.join(`task:${payload.taskId}`);
  }

  @SubscribeMessage(WS_EVENTS.LEAVE)
  async onLeave(client: AuthedSocket, payload: { taskId: string }) {
    if (!payload?.taskId) return;
    await client.leave(`task:${payload.taskId}`);
  }

  private extractToken(client: AuthedSocket): string {
    const auth = client.handshake.auth?.token as string | undefined;
    if (auth) return auth;
    const header = client.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    throw new Error('Missing token');
  }
}
