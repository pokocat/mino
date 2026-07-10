import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WxAccessTokenService } from '../wx/wx-access-token.service';

/** 内容安全审核结论。 */
export interface SafetyVerdict {
  /** true=命中风险内容，应拦截。 */
  risky: boolean;
  /** 命中标签（微信 label 或 mock 词表命中词），仅用于日志/排障。 */
  label?: string;
}

/** msgSecCheck v2 场景值：1 资料 / 2 评论 / 3 论坛 / 4 社交日志。 */
export type SafetyScene = 1 | 2 | 3 | 4;

/** 微信内容安全 msgSecCheck v2 端点。 */
const WX_MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';

/**
 * mock 模式内置敏感词表：命中任一即判 risky（仅供本地/联调/CI，不代表真实审核尺度）。
 * 生产走微信 msgSecCheck，词表不参与。
 */
const MOCK_SENSITIVE_WORDS = [
  '违禁词',
  '敏感词测试',
  '赌博',
  '涉黄',
  '暴恐',
  'fuck',
];

/**
 * 微信内容安全服务（方案 R7）。
 *
 * checkText：审一段文本是否含违规内容。
 *  - WX_MOCK=true：走内置敏感词表（命中即 risky），不触外网，供本地/CI 全链路跑通。
 *  - 真实模式：POST /wxa/msg_sec_check?access_token=（v2，body {version:2,openid,scene,content}），
 *    result.suggest==='risky' 或 errcode!=0 里的 87014（含违规内容）判 risky。
 *
 * 失败处理（微信接口挂/换 token 失败/网络异常）：
 *  - 默认 fail-open：放行（risky=false）+ 告警日志，避免第三方抖动阻断主链路；
 *  - SAFETY_FAIL_CLOSED=true 切严格模式：审核不可用时一律判 risky（宁可错杀）。
 */
@Injectable()
export class WxSecService {
  private readonly logger = new Logger(WxSecService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly accessToken: WxAccessTokenService,
  ) {}

  private get mock(): boolean {
    return this.config.get<boolean>('wx.mock') === true;
  }

  private get failClosed(): boolean {
    return this.config.get<boolean>('safety.failClosed') === true;
  }

  /**
   * 审核一段文本。
   * @param openid 内容作者 openid（msgSecCheck v2 必填，需近 2 小时内使用过小程序）
   * @param content 待审文本
   * @param scene  场景值（默认 3 论坛，覆盖对话/报告文本）
   */
  async checkText(
    openid: string,
    content: string,
    scene: SafetyScene = 3,
  ): Promise<SafetyVerdict> {
    const text = (content ?? '').trim();
    if (!text) return { risky: false };

    if (this.mock) {
      const hit = MOCK_SENSITIVE_WORDS.find((w) =>
        text.toLowerCase().includes(w.toLowerCase()),
      );
      return hit ? { risky: true, label: hit } : { risky: false };
    }

    try {
      const token = await this.accessToken.getAccessToken();
      if (!token) return this.onUnavailable('无 access_token');

      const res = await fetch(`${WX_MSG_SEC_CHECK_URL}?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 2, openid, scene, content: text }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        errcode?: number;
        errmsg?: string;
        result?: { suggest?: string; label?: number };
      };

      // 87014：内容含有违法违规内容（旧版直接以 errcode 表达）
      if (json.errcode === 87014) {
        return { risky: true, label: 'errcode:87014' };
      }
      // 其余非 0 errcode 视为审核不可用（参数/频率/系统错误），按 fail-open/closed 策略处理
      if (json.errcode && json.errcode !== 0) {
        return this.onUnavailable(
          `errcode=${json.errcode} errmsg=${json.errmsg}`,
        );
      }
      const suggest = json.result?.suggest;
      if (suggest === 'risky') {
        return { risky: true, label: `label:${json.result?.label ?? ''}` };
      }
      // suggest === 'pass' | 'review' 均放行（review 交人工，不阻断用户）
      return { risky: false };
    } catch (err) {
      return this.onUnavailable(`异常 ${String(err)}`);
    }
  }

  /** 审核不可用时按 fail-open/fail-closed 策略给出结论并告警。 */
  private onUnavailable(reason: string): SafetyVerdict {
    if (this.failClosed) {
      this.logger.warn(`内容安全审核不可用（${reason}）→ 严格模式拦截`);
      return { risky: true, label: 'unavailable' };
    }
    this.logger.warn(`内容安全审核不可用（${reason}）→ fail-open 放行`);
    return { risky: false };
  }
}
