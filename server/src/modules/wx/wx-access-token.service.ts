import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 微信 access_token 端点（凭 appid+secret 换取）。 */
const WX_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
/** access_token 缓存时长（微信默认 7200s，留安全余量取 7000s）。 */
const TOKEN_TTL_MS = 7000 * 1000;

/**
 * 微信 access_token 共享服务（供 push 订阅消息、safety 内容安全等模块共用）。
 *
 * 从 WxPushService 抽出：进程内内存缓存（7000s）——单实例部署足够，无需引 Redis；
 * 多实例时各自缓存、微信侧对同一 token 幂等，代价仅是重复换取，可接受。
 * 换取失败只记日志并返回 null（绝不抛出）——由调用方按各自策略（推送旁路吞掉 / 安全审核 fail-open）处理。
 */
@Injectable()
export class WxAccessTokenService {
  private readonly logger = new Logger(WxAccessTokenService.name);

  private cachedToken: string | null = null;
  private tokenExpireAt = 0;

  constructor(private readonly config: ConfigService) {}

  /** 取 access_token（内存缓存 7000s）；缺配置或换取失败返回 null。 */
  async getAccessToken(): Promise<string | null> {
    if (this.cachedToken && Date.now() < this.tokenExpireAt) {
      return this.cachedToken;
    }
    const appId = this.config.get<string>('wx.appId') ?? '';
    const secret = this.config.get<string>('wx.secret') ?? '';
    if (!appId || !secret) {
      this.logger.warn('缺少 WX_APPID / WX_SECRET，无法换取 access_token');
      return null;
    }
    try {
      const url = `${WX_TOKEN_URL}?grant_type=client_credential&appid=${appId}&secret=${secret}`;
      const res = await fetch(url);
      const json = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        errcode?: number;
        errmsg?: string;
      };
      if (!json.access_token) {
        this.logger.warn(
          `换取 access_token 失败 errcode=${json.errcode} errmsg=${json.errmsg}`,
        );
        return null;
      }
      this.cachedToken = json.access_token;
      this.tokenExpireAt = Date.now() + TOKEN_TTL_MS;
      return this.cachedToken;
    } catch (err) {
      this.logger.warn(`换取 access_token 异常：${String(err)}`);
      return null;
    }
  }
}
