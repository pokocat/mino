import { ConfigService } from '@nestjs/config';
import { WxAccessTokenService } from '../wx/wx-access-token.service';
import { WxPushService } from './wx-push.service';

/** 用给定 config 组装 WxPushService（含共享 access_token 服务）。 */
function buildPush(config: ConfigService): WxPushService {
  return new WxPushService(config, new WxAccessTokenService(config));
}

/** 造 config 桩。 */
function buildConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const base: Record<string, unknown> = {
    'wx.mock': true,
    'wx.tmplDailyQ': 'TMPL_DAILY',
    'wx.tmplReportReady': 'TMPL_REPORT',
    'wx.pushPageChat': 'pages/chat/chat',
    'wx.pushPageReports': 'pages/reports/list',
    'wx.appId': '',
    'wx.secret': '',
    nodeEnv: 'test',
  };
  const map = { ...base, ...overrides };
  return { get: (k: string) => map[k] } as unknown as ConfigService;
}

describe('WxPushService', () => {
  const user = { wxOpenid: 'openid-1', nickname: '牧之' };

  it('WX_MOCK=true：sendDailyQuestion 只打印 [mock push]，不触网、不抛出', async () => {
    const svc = buildPush(buildConfig({ 'wx.mock': true }));
    const spy = jest
      .spyOn(svc['logger'], 'log')
      .mockImplementation(() => undefined);
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(
      svc.sendDailyQuestion(user, {
        id: 'task-1',
        question: '你最值钱的一张牌是什么？',
        estMinutes: 3,
      }),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toContain('[mock push]');
    expect(spy.mock.calls[0][0]).toContain('dailyQuestion');
    fetchSpy.mockRestore();
  });

  it('WX_MOCK=true：sendReportReady 只打印 [mock push]，不抛出', async () => {
    const svc = buildPush(buildConfig({ 'wx.mock': true }));
    const spy = jest
      .spyOn(svc['logger'], 'log')
      .mockImplementation(() => undefined);
    await expect(
      svc.sendReportReady(user, { id: 'rpt-1', title: '你的护城河' }),
    ).resolves.toBeUndefined();
    expect(spy.mock.calls[0][0]).toContain('[mock push]');
    expect(spy.mock.calls[0][0]).toContain('reportReady');
  });

  it('真实模式发送失败（fetch 抛出）不抛出，仅告警', async () => {
    const svc = buildPush(
      buildConfig({ 'wx.mock': false, 'wx.appId': 'a', 'wx.secret': 's' }),
    );
    const warn = jest
      .spyOn(svc['logger'], 'warn')
      .mockImplementation(() => undefined);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network down'));

    await expect(
      svc.sendReportReady(user, { id: 'rpt-1', title: '标题' }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('真实模式：微信返回 errcode=43101（用户未授权）只记日志不抛出', async () => {
    const svc = buildPush(
      buildConfig({ 'wx.mock': false, 'wx.appId': 'a', 'wx.secret': 's' }),
    );
    const warn = jest
      .spyOn(svc['logger'], 'warn')
      .mockImplementation(() => undefined);
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/cgi-bin/token')) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({ access_token: 'TOK', expires_in: 7200 }),
        } as Response);
      }
      return Promise.resolve({
        json: () => Promise.resolve({ errcode: 43101, errmsg: 'user refuse' }),
      } as Response);
    });

    await expect(
      svc.sendDailyQuestion(user, { id: 't1', question: 'q', estMinutes: 3 }),
    ).resolves.toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('43101'))).toBe(
      true,
    );
    fetchSpy.mockRestore();
  });

  it('真实模式缺模板 id：直接跳过，不换 token', async () => {
    const svc = buildPush(
      buildConfig({
        'wx.mock': false,
        'wx.tmplDailyQ': '',
        'wx.appId': 'a',
        'wx.secret': 's',
      }),
    );
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(
      svc.sendDailyQuestion(user, { id: 't1', question: 'q', estMinutes: 3 }),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
