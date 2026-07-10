import { createHash } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** 微信 jscode2session 结果（仅取本项目需要的字段）。 */
export interface WxSession {
  openid: string;
  unionid?: string;
}

/** 微信官方接口原始返回结构。 */
interface Jscode2SessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 微信开放接口封装。
 * - 正常模式：调用 jscode2session 换取 openid/unionid。
 * - Mock 模式（WX_MOCK=true）：不请求微信，openid = `mock_` + code 的 sha256 前缀，
 *   便于本地/联调在无真实 appid/secret 时跑通登录闭环。
 */
@Injectable()
export class WxApiService {
  private readonly logger = new Logger(WxApiService.name);
  private readonly endpoint = 'https://api.weixin.qq.com/sns/jscode2session';

  constructor(private readonly config: ConfigService) {}

  /** 是否启用 mock 模式。 */
  private get mockEnabled(): boolean {
    return this.config.get<boolean>('wx.mock') === true;
  }

  /** 用 code 换取会话（openid/unionid）。 */
  async code2Session(code: string): Promise<WxSession> {
    if (this.mockEnabled) {
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
      this.logger.debug(`WX_MOCK 已启用，为 code 生成 mock openid`);
      return { openid: `mock_${hash}` };
    }

    const appId = this.config.get<string>('wx.appId');
    const secret = this.config.get<string>('wx.secret');
    if (!appId || !secret) {
      throw new HttpException(
        {
          code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '微信 appid/secret 未配置',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const { data } = await axios.get<Jscode2SessionResponse>(this.endpoint, {
        params: {
          appid: appId,
          secret,
          js_code: code,
          grant_type: 'authorization_code',
        },
        timeout: 5000,
      });

      if (!data.openid) {
        this.logger.warn(
          `微信登录失败 errcode=${data.errcode} errmsg=${data.errmsg}`,
        );
        throw new HttpException(
          { code: HttpStatus.UNAUTHORIZED, message: '微信登录失败，请重试' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      return { openid: data.openid, unionid: data.unionid };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error('调用微信 jscode2session 异常', err as Error);
      throw new HttpException(
        { code: HttpStatus.BAD_GATEWAY, message: '微信服务暂时不可用' },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
