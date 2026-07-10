import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WxAccessTokenService } from '../wx/wx-access-token.service';

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

/** 微信订阅消息下发端点。 */
const WX_SUBSCRIBE_SEND_URL =
  'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';

/**
 * 微信订阅消息发送服务，方案 R4。
 *
 * 能力：sendDailyQuestion（今日一问）/ sendReportReady（报告写好了）。
 * access_token 换取复用 WxAccessTokenService（与内容安全模块共享，进程内缓存 7000s）。
 * 纪律（R4）：WX_MOCK=true 只打印 [mock push] 不触外网；任何发送失败（43101 用户未授权、
 *   token 换取失败等）只记日志、**绝不抛出**——推送是旁路，不能影响主链路。
 */
@Injectable()
export class WxPushService {
  private readonly logger = new Logger(WxPushService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly accessToken: WxAccessTokenService,
  ) {}

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
      const token = await this.accessToken.getAccessToken();
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
