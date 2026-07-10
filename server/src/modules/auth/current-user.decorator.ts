import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

/**
 * @CurrentUser() —— 从 request.user 取出经 JwtStrategy 回填的用户实体。
 * 仅在被 JwtAuthGuard 保护的路由中使用。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<{ user: User }>();
    return request.user;
  },
);
