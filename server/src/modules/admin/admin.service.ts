import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** 后台 JWT 载荷：固定 sub='admin'、role='admin'（AdminAuthGuard 据 role 放行）。 */
export interface AdminJwtPayload {
  sub: 'admin';
  role: 'admin';
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * 后台登录：比对 env 注入的单账号；任一 config 值为空视为未配置，一律拒绝（不可绕过）。
   * 命中 → 签发 12h JWT（payload {sub:'admin', role:'admin'}）。失败返回 null。
   */
  async login(user: string, pass: string): Promise<{ token: string } | null> {
    const expectUser = this.config.get<string>('admin.user') ?? '';
    const expectPass = this.config.get<string>('admin.pass') ?? '';
    if (!expectUser || !expectPass) {
      this.logger.warn('后台管理员未配置（ADMIN_USER/ADMIN_PASS 为空），登录被拒绝');
      return null;
    }
    if (user !== expectUser || pass !== expectPass) {
      return null;
    }
    const payload: AdminJwtPayload = { sub: 'admin', role: 'admin' };
    const token = await this.jwt.signAsync(payload, { expiresIn: '12h' });
    return { token };
  }
}
