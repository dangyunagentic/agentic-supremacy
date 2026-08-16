import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './roles.guard';
import type { RequestUser } from './jwt.strategy';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!request.user) throw new Error('CurrentUser used without JwtAuthGuard');
    return request.user;
  },
);
