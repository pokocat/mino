import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WxApiService } from './wx-api.service';

/** JWT 载荷结构。 */
export interface JwtPayload {
  sub: string; // 用户 id
}

/** wx-login 返回结构。 */
export interface WxLoginResult {
  token: string;
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly wxApi: WxApiService,
  ) {}

  /**
   * 微信登录：code → openid → upsert 用户 → 签发 JWT。
   * isNewUser 判定：尚未填写 profile（nickname 为空），前端据此决定是否进入入局页。
   */
  async wxLogin(code: string): Promise<WxLoginResult> {
    const session = await this.wxApi.code2Session(code);

    const user = await this.prisma.user.upsert({
      where: { wxOpenid: session.openid },
      // 已存在则仅在有 unionid 时补齐，不覆盖 profile
      update: session.unionid ? { wxUnionid: session.unionid } : {},
      create: {
        wxOpenid: session.openid,
        wxUnionid: session.unionid ?? null,
      },
    });

    const token = await this.signToken(user);
    return { token, isNewUser: !user.nickname };
  }

  /** 依据用户签发 JWT（过期时间走 config，默认 7d）。 */
  private async signToken(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id };
    return this.jwt.signAsync(payload);
  }
}
