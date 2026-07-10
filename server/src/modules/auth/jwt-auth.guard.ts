import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT 鉴权守卫：包裹 passport-jwt。
 * 校验失败统一抛 401 `{code, message}`，契合全局错误响应约定。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw new UnauthorizedException({
        code: 401,
        message: '未登录或登录已过期',
      });
    }
    return user;
  }

  // 占位以显式表达守卫作用范围（默认沿用父类逻辑）。
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
