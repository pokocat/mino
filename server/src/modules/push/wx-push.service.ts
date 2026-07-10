import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 推送目标用户所需字段。 */
export interface PushUser {
  wxOpenid: string;
  nickname?: string | null;
}

/** 今日一问推送素材。 */
export interface PushTask {
  id: string;
  question: string;
  estMinutes?: number | null;
}

/** 报告完成推送素材。 */
export interface PushReport {
  id: string;
  title: string;
}

/** 微信 access_token 端点（凭 appid+secret 换取）。 */
const WX_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
/** 微信订阅消息下发端点。 */
const WX_SUBSCRIBE_SEND_URL =
  'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';
/** access_token 缓存时长（微信默认 7200s，留安全余量取 7000s）。 */
const TOKEN_TTL_MS = 7000 * 1000;

/**
 * 微信订阅消息发送服务，方案 R4。
 *
 * 能力：sendDailyQuestion（今日一问）/ sendReportReady（报告写好了）。
 * access_token 进程内内存缓存（7000s）——取舍：单实例部署足够，无需引 Redis；
 *   多实例时各自缓存、微信侧对同一 token 幂等，代价仅是重复换取，可接受。
 * 纪律（R4）：WX_MOCK=true 只打印 [mock push] 不触外网；任何发送失败（43101 用户未授权、
 *   token 换取失败等）只记日志、**绝不抛出**——推送是旁路，不能影响主链路。
 */
@Injectable()
export class WxPushService {
  private readonly logger = new Logger(WxPushService.name);

  // access_token 内存缓存
  private cachedToken: string | null = null;
  private tokenExpireAt = 0;

  constructor(private readonly config: ConfigService) {}

  private get mock(): boolean {
    return this.config.get<boolean>('wx.mock') === true;
  }

  /** 今日一问推送。 */
  async sendDailyQuestion(user: PushUser, task: PushTask): Promise<void> {
    const templateId = this.config.get<string>('wx.tmplDailyQ') ?? '';
    const page = this.config.get<string>('wx.pushPageChat') ?? '';
    // 模板字段名占位（thing/number 类型，须与微信后台申请的模板一致）
    const data = {
      thing1: { value: clip(task.question, 20) },
      time2: { value: nowStr() },
    };
    await this.send('dailyQuestion', user, templateId, page, data, {
      taskId: task.id,
    });
  }

  /** 报告完成推送。 */
  async sendReportReady(user: PushUser, report: PushReport): Promise<void> {
    const templateId = this.config.get<string>('wx.tmplReportReady') ?? '';
    const page = this.config.get<string>('wx.pushPageReports') ?? '';
    const data = {
      thing1: { value: clip(report.title, 20) },
      time2: { value: nowStr() },
    };
    await this.send('reportReady', user, templateId, page, data, {
      reportId: report.id,
    });
  }

  /**
   * 统一下发：mock 打印，真实模式换 token → POST subscribe/send。
   * 全程包裹 try/catch，任何异常仅记日志、绝不抛出。
   */
  private async send(
    kind: 'dailyQuestion' | 'reportReady',
    user: PushUser,
    templateId: string,
    page: string,
    data: Record<string, { value: string }>,
    ref: Record<string, string>,
  ): Promise<void> {
    if (this.mock) {
      this.logger.log(
        `[mock push] ${kind} → openid=${user.wxOpenid} tmpl=${templateId || '(未配置)'} ` +
          `page=${page} ref=${JSON.stringify(ref)} data=${JSON.stringify(data)}`,
      );
      return;
    }

    if (!templateId) {
      this.logger.warn(
        `[push] ${kind} 未配置模板 id，跳过（${JSON.stringify(ref)}）`,
      );
      return;
    }

    try {
      const token = await this.getAccessToken();
      if (!token) {
        this.logger.warn(`[push] ${kind} 无 access_token，跳过`);
        return;
      }
      const res = await fetch(
        `${WX_SUBSCRIBE_SEND_URL}?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: user.wxOpenid,
            template_id: templateId,
            page: page || undefined,
            miniprogram_state:
              this.config.get<string>('nodeEnv') === 'production'
                ? 'formal'
                : 'trial',
            lang: 'zh_CN',
            data,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        errcode?: number;
        errmsg?: string;
      };
      if (json.errcode && json.errcode !== 0) {
        // 43101=用户未授权/拒收；40003=openid 非法……均只记日志，不抛出
        this.logger.warn(
          `[push] ${kind} 发送失败 errcode=${json.errcode} errmsg=${json.errmsg} (${JSON.stringify(ref)})`,
        );
        return;
      }
      this.logger.log(
        `[push] ${kind} 已下发 → openid=${user.wxOpenid} (${JSON.stringify(ref)})`,
      );
    } catch (err) {
      this.logger.warn(`[push] ${kind} 异常（已忽略）：${String(err)}`);
    }
  }

  /** 取 access_token（内存缓存 7000s）；失败返回 null。 */
  private async getAccessToken(): Promise<string | null> {
    if (this.cachedToken && Date.now() < this.tokenExpireAt) {
      return this.cachedToken;
    }
    const appId = this.config.get<string>('wx.appId') ?? '';
    const secret = this.config.get<string>('wx.secret') ?? '';
    if (!appId || !secret) {
      this.logger.warn(
        '[push] 缺少 WX_APPID / WX_SECRET，无法换取 access_token',
      );
      return null;
    }
    const url = `${WX_TOKEN_URL}?grant_type=client_credential&appid=${appId}&secret=${secret}`;
    const res = await fetch(url);
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!json.access_token) {
      this.logger.warn(
        `[push] 换取 access_token 失败 errcode=${json.errcode} errmsg=${json.errmsg}`,
      );
      return null;
    }
    this.cachedToken = json.access_token;
    this.tokenExpireAt = Date.now() + TOKEN_TTL_MS;
    return this.cachedToken;
  }
}

/** 截断文案（微信 thing 类型上限 20 字）。 */
function clip(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 当前时间串（用于 time 类型字段）。 */
function nowStr(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
