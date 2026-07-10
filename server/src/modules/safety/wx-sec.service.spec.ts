import { ConfigService } from '@nestjs/config';
import { WxAccessTokenService } from '../wx/wx-access-token.service';
import { WxSecService } from './wx-sec.service';

/** 造 config 桩。 */
function buildConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const base: Record<string, unknown> = {
    'wx.mock': false,
    'wx.appId': 'a',
    'wx.secret': 's',
    'safety.failClosed': false,
  };
  const map = { ...base, ...overrides };
  return { get: (k: string) => map[k] } as unknown as ConfigService;
}

/** 组装 WxSecService（含共享 access_token 服务）。 */
function build(config: ConfigService): WxSecService {
  return new WxSecService(config, new WxAccessTokenService(config));
}

describe('WxSecService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('mock 模式（内置敏感词表）', () => {
    it('命中敏感词 → risky', async () => {
      const svc = build(buildConfig({ 'wx.mock': true }));
      const fetchSpy = jest.spyOn(global, 'fetch');
      const v = await svc.checkText('openid-1', '这里有违禁词出现', 3);
      expect(v.risky).toBe(true);
      expect(v.label).toBe('违禁词');
      // mock 不触外网
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('未命中 → pass', async () => {
      const svc = build(buildConfig({ 'wx.mock': true }));
      const v = await svc.checkText('openid-1', '今天生意不错', 3);
      expect(v.risky).toBe(false);
    });

    it('空文本 → pass（不调用任何审核）', async () => {
      const svc = build(buildConfig({ 'wx.mock': true }));
      const v = await svc.checkText('openid-1', '   ', 3);
      expect(v.risky).toBe(false);
    });
  });

  describe('真实模式', () => {
    /** 桩：token 端点返回 token，msg_sec_check 返回给定 body。 */
    function mockFetch(secBody: unknown): jest.SpyInstance {
      return jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const u = String(url);
        if (u.includes('/cgi-bin/token')) {
          return Promise.resolve({
            json: () => Promise.resolve({ access_token: 'TOK' }),
          } as Response);
        }
        return Promise.resolve({
          json: () => Promise.resolve(secBody),
        } as Response);
      });
    }

    it('suggest=pass → pass', async () => {
      const svc = build(buildConfig());
      mockFetch({ errcode: 0, result: { suggest: 'pass', label: 100 } });
      const v = await svc.checkText('openid-1', '正常内容', 3);
      expect(v.risky).toBe(false);
    });

    it('suggest=risky → risky', async () => {
      const svc = build(buildConfig());
      mockFetch({ errcode: 0, result: { suggest: 'risky', label: 20001 } });
      const v = await svc.checkText('openid-1', '待审内容', 3);
      expect(v.risky).toBe(true);
    });

    it('errcode=87014（含违规内容）→ risky', async () => {
      const svc = build(buildConfig());
      mockFetch({ errcode: 87014, errmsg: 'risky content' });
      const v = await svc.checkText('openid-1', '待审内容', 3);
      expect(v.risky).toBe(true);
    });

    it('fail-open（默认）：fetch 抛出 → 放行 pass', async () => {
      const svc = build(buildConfig({ 'safety.failClosed': false }));
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
      const v = await svc.checkText('openid-1', '待审内容', 3);
      expect(v.risky).toBe(false);
    });

    it('fail-open：微信系统错误 errcode!=0 → 放行 pass', async () => {
      const svc = build(buildConfig({ 'safety.failClosed': false }));
      mockFetch({ errcode: -1, errmsg: 'system error' });
      const v = await svc.checkText('openid-1', '待审内容', 3);
      expect(v.risky).toBe(false);
    });

    it('fail-closed：SAFETY_FAIL_CLOSED=true 时审核不可用 → 拦截 risky', async () => {
      const svc = build(buildConfig({ 'safety.failClosed': true }));
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
      const v = await svc.checkText('openid-1', '待审内容', 3);
      expect(v.risky).toBe(true);
      expect(v.label).toBe('unavailable');
    });

    it('fail-closed：无 access_token（缺 appid/secret）→ 拦截 risky', async () => {
      const svc = build(
        buildConfig({
          'safety.failClosed': true,
          'wx.appId': '',
          'wx.secret': '',
        }),
      );
      const v = await svc.checkText('openid-1', '待审内容', 3);
      expect(v.risky).toBe(true);
    });
  });
});
