import { PrismaService } from '../../prisma/prisma.service';
import {
  FastgptChatService,
  MOCK_APPEND_MARK,
} from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { WxPushService } from '../push/wx-push.service';
import { WxSecService } from '../safety/wx-sec.service';
import { ReportGenerateProcessor } from './report-generate.processor';

/** 内容安全桩：默认全部 pass（可覆写为 risky）。 */
function stubSafety(
  verdict: { risky: boolean; label?: string } = { risky: false },
): WxSecService & { checkText: jest.Mock } {
  return {
    checkText: jest.fn().mockResolvedValue(verdict),
  } as unknown as WxSecService & { checkText: jest.Mock };
}

/** 推送桩（旁路，不触网）。 */
function stubPush(): WxPushService & { sendReportReady: jest.Mock } {
  return {
    sendReportReady: jest.fn().mockResolvedValue(undefined),
    sendDailyQuestion: jest.fn().mockResolvedValue(undefined),
  } as unknown as WxPushService & { sendReportReady: jest.Mock };
}

/** 造一份 generating 的报告行（含关联会话）。 */
function buildReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rpt-1',
    type: 'strategy',
    status: 'generating',
    meta: {},
    userId: 'user-1',
    user: {
      industry: '宠物殡葬',
      bizNote: '开了两家店',
      kbId: null,
      wxOpenid: 'openid-1',
      nickname: '牧之',
    },
    sources: [
      {
        conversation: {
          id: 'conv-1',
          fastgptChatId: 'chat-1',
          userId: 'user-1',
        },
      },
    ],
    ...overrides,
  };
}

describe('ReportGenerateProcessor', () => {
  function setup(reportRow: Record<string, unknown> | null) {
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue(reportRow),
        update: jest.fn().mockResolvedValue({}),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          { role: 'user', content: '我想复盘一下' },
          { role: 'assistant', content: '好，我们来复盘' },
        ]),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ kbId: null }) },
    };
    return prisma;
  }

  it('mock 成功：更新 ready、按正文重算 wordCount、回喂知识库置 kb_synced', async () => {
    const prisma = setup(buildReport());
    // mock config → complete 返回 strategy 固定 JSON
    const config = {
      get: (k: string) => (k === 'fastgpt.mock' ? true : undefined),
    } as never;
    const chat = new FastgptChatService(config);
    const kb = {
      ensureUserKb: jest.fn().mockResolvedValue('mock_kb_user-1'),
      pushText: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([]),
    } as unknown as FastgptKbService;

    const push = stubPush();
    const proc = new ReportGenerateProcessor(
      prisma as unknown as PrismaService,
      chat,
      kb,
      push,
      stubSafety(),
    );
    await proc.process({ reportId: 'rpt-1' });

    // ready 后推送订阅消息（报告完成）
    expect(push.sendReportReady).toHaveBeenCalledTimes(1);

    // 第一次 update = 置 ready；找出该次调用
    const readyCall = prisma.report.update.mock.calls.find(
      (c) => c[0].data.status === 'ready',
    );
    expect(readyCall).toBeDefined();
    expect(readyCall![0].data.title).toBe('你的护城河：把信任做成根据地');
    expect(readyCall![0].data.wordCount).toBeGreaterThan(0);
    expect(readyCall![0].data.annotation).toContain('风来了先把帆张稳');

    // 回喂知识库
    expect(kb.pushText).toHaveBeenCalledTimes(1);
    // 二次 update = 置 meta.kb_synced=true
    const syncCall = prisma.report.update.mock.calls.find(
      (c) => c[0].data.meta && c[0].data.meta.kb_synced === true,
    );
    expect(syncCall).toBeDefined();
  });

  it('解析失败（complete 返回非 JSON）：重试后仍失败置 failed', async () => {
    const prisma = setup(buildReport());
    const config = {
      get: () => false,
    } as never;
    // 覆写 complete 始终返回垃圾串
    const chat = {
      complete: jest.fn().mockResolvedValue('这不是 JSON'),
    } as unknown as FastgptChatService;
    const kb = {
      search: jest.fn().mockResolvedValue([]),
    } as unknown as FastgptKbService;

    const proc = new ReportGenerateProcessor(
      prisma as unknown as PrismaService,
      chat,
      kb,
      stubPush(),
      stubSafety(),
    );
    void config;
    await proc.process({ reportId: 'rpt-1' });

    // 重试 1 次 = 共 2 次 complete
    expect((chat.complete as jest.Mock).mock.calls).toHaveLength(2);
    const failedCall = prisma.report.update.mock.calls.find(
      (c) => c[0].data.status === 'failed',
    );
    expect(failedCall).toBeDefined();
  });

  it('内容安全审 bodyMd 命中风险：置 failed，不 ready、不回喂知识库、不推送', async () => {
    const prisma = setup(buildReport());
    const config = {
      get: (k: string) => (k === 'fastgpt.mock' ? true : undefined),
    } as never;
    const chat = new FastgptChatService(config);
    const kb = {
      ensureUserKb: jest.fn(),
      pushText: jest.fn(),
      search: jest.fn().mockResolvedValue([]),
    } as unknown as FastgptKbService;
    const push = stubPush();

    const proc = new ReportGenerateProcessor(
      prisma as unknown as PrismaService,
      chat,
      kb,
      push,
      stubSafety({ risky: true, label: 'label:20001' }),
    );
    await proc.process({ reportId: 'rpt-1' });

    const failedCall = prisma.report.update.mock.calls.find(
      (c) => c[0].data.status === 'failed',
    );
    expect(failedCall).toBeDefined();
    const readyCall = prisma.report.update.mock.calls.find(
      (c) => c[0].data.status === 'ready',
    );
    expect(readyCall).toBeUndefined();
    expect(kb.pushText).not.toHaveBeenCalled();
    expect(push.sendReportReady).not.toHaveBeenCalled();
  });

  describe('append 续写分支', () => {
    /** 造一份 ready 报告（含原正文/批注），并给 append 路径所需的 prisma 桩。 */
    function setupAppend(chat: FastgptChatService, reportOverrides = {}) {
      const report = buildReport({
        status: 'generating', // commit 已置 generating
        title: '你的护城河',
        bodyMd: '## 主要矛盾\n\n原正文一段，讲信任慢功夫。',
        annotation: '原批注：别急着摊大。',
        ...reportOverrides,
      });
      const prisma = {
        report: {
          findUnique: jest.fn().mockResolvedValue(report),
          update: jest.fn().mockResolvedValue({}),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'conv-a',
            fastgptChatId: 'chat-a',
            userId: 'user-1',
          }),
        },
        message: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ role: 'user', content: '我想补充一点' }]),
        },
        reportSource: { createMany: jest.fn().mockResolvedValue({}) },
        user: { findUnique: jest.fn().mockResolvedValue({ kbId: null }) },
      };
      const kb = {
        ensureUserKb: jest.fn().mockResolvedValue('mock_kb_user-1'),
        pushText: jest.fn().mockResolvedValue(undefined),
        search: jest.fn().mockResolvedValue([]),
      } as unknown as FastgptKbService;
      return { prisma, kb };
    }

    it('mock 成功：织入可辨识新段落、置 ready、重置未读、追加 report_source、推送（title 不变）', async () => {
      const config = {
        get: (k: string) => (k === 'fastgpt.mock' ? true : undefined),
      } as never;
      const chat = new FastgptChatService(config);
      const { prisma, kb } = setupAppend(chat);
      const push = stubPush();
      const proc = new ReportGenerateProcessor(
        prisma as unknown as PrismaService,
        chat,
        kb,
        push,
        stubSafety(),
      );
      await proc.process({
        reportId: 'rpt-1',
        mode: 'append',
        conversationId: 'conv-a',
      });

      const readyCall = prisma.report.update.mock.calls.find(
        (c) => c[0].data.status === 'ready',
      );
      expect(readyCall).toBeDefined();
      // 新正文含原文 + 可辨识续写段
      expect(readyCall![0].data.bodyMd).toContain('原正文一段');
      expect(readyCall![0].data.bodyMd).toContain(MOCK_APPEND_MARK);
      // title 不变 → 不在 update data 中
      expect(readyCall![0].data.title).toBeUndefined();
      // 重置未读
      expect(readyCall![0].data.isRead).toBe(false);
      // 追加 report_source（skipDuplicates）
      expect(prisma.reportSource.createMany).toHaveBeenCalledWith({
        data: [{ reportId: 'rpt-1', conversationId: 'conv-a' }],
        skipDuplicates: true,
      });
      // 回喂知识库 + 推送
      expect(kb.pushText).toHaveBeenCalledTimes(1);
      expect(push.sendReportReady).toHaveBeenCalledTimes(1);
      // 绝不置 failed
      const failedCall = prisma.report.update.mock.calls.find(
        (c) => c[0].data.status === 'failed',
      );
      expect(failedCall).toBeUndefined();
    });

    it('解析失败：重试后回滚为原内容 ready（不 failed、不清 bodyMd）', async () => {
      const chat = {
        complete: jest.fn().mockResolvedValue('这不是 JSON'),
      } as unknown as FastgptChatService;
      const { prisma, kb } = setupAppend(chat);
      const push = stubPush();
      const proc = new ReportGenerateProcessor(
        prisma as unknown as PrismaService,
        chat,
        kb,
        push,
        stubSafety(),
      );
      await proc.process({
        reportId: 'rpt-1',
        mode: 'append',
        conversationId: 'conv-a',
      });

      // 重试 1 次 = 共 2 次 complete
      expect((chat.complete as jest.Mock).mock.calls).toHaveLength(2);
      // 回滚：仅 status→ready，不含 bodyMd（原内容未动）
      const rollback = prisma.report.update.mock.calls.find(
        (c) => c[0].data.status === 'ready',
      );
      expect(rollback).toBeDefined();
      expect(rollback![0].data.bodyMd).toBeUndefined();
      // 绝不置 failed（续写失败不丢已有报告）
      const failedCall = prisma.report.update.mock.calls.find(
        (c) => c[0].data.status === 'failed',
      );
      expect(failedCall).toBeUndefined();
      // 不追加 source、不推送
      expect(prisma.reportSource.createMany).not.toHaveBeenCalled();
      expect(push.sendReportReady).not.toHaveBeenCalled();
    });

    it('内容安全命中：回滚为原内容 ready，不推送', async () => {
      const config = {
        get: (k: string) => (k === 'fastgpt.mock' ? true : undefined),
      } as never;
      const chat = new FastgptChatService(config);
      const { prisma, kb } = setupAppend(chat);
      const push = stubPush();
      const proc = new ReportGenerateProcessor(
        prisma as unknown as PrismaService,
        chat,
        kb,
        push,
        stubSafety({ risky: true, label: 'label:20001' }),
      );
      await proc.process({
        reportId: 'rpt-1',
        mode: 'append',
        conversationId: 'conv-a',
      });
      const rollback = prisma.report.update.mock.calls.find(
        (c) => c[0].data.status === 'ready',
      );
      expect(rollback).toBeDefined();
      expect(rollback![0].data.bodyMd).toBeUndefined();
      expect(push.sendReportReady).not.toHaveBeenCalled();
    });
  });

  it('报告不存在：直接跳过，不更新', async () => {
    const prisma = setup(null);
    const chat = { complete: jest.fn() } as unknown as FastgptChatService;
    const kb = {} as FastgptKbService;
    const proc = new ReportGenerateProcessor(
      prisma as unknown as PrismaService,
      chat,
      kb,
      stubPush(),
      stubSafety(),
    );
    await proc.process({ reportId: 'nope' });
    expect(prisma.report.update).not.toHaveBeenCalled();
    expect(chat.complete).not.toHaveBeenCalled();
  });
});
