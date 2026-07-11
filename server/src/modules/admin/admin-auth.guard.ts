import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AdminJwtPayload } from './admin.service';

/**
 * 后台鉴权守卫：从 `Authorization: Bearer <token>` 取 token，用 JwtService 验签，
 * 且仅当 payload.role === 'admin' 才放行；其余一律 401。
 * 刻意不复用普通用户的 JwtAuthGuard（那个授权的是小程序用户，不是后台管理员）。
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException({
        code: 401,
        message: '未登录或登录已过期',
      });
    }
    try {
      const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token);
      if (payload?.role !== 'admin') {
        throw new UnauthorizedException({
          code: 401,
          message: '无后台访问权限',
        });
      }
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({
        code: 401,
        message: '未登录或登录已过期',
      });
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization ?? '';
    const [scheme, value] = header.split(' ');
    return scheme === 'Bearer' && value ? value : null;
  }
}
