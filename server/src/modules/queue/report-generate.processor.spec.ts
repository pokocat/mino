import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { ReportGenerateProcessor } from './report-generate.processor';

/** 造一份 generating 的报告行（含关联会话）。 */
function buildReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rpt-1',
    type: 'strategy',
    status: 'generating',
    meta: {},
    userId: 'user-1',
    user: { industry: '宠物殡葬', bizNote: '开了两家店', kbId: null },
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

    const proc = new ReportGenerateProcessor(
      prisma as unknown as PrismaService,
      chat,
      kb,
    );
    await proc.process({ reportId: 'rpt-1' });

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

  it('报告不存在：直接跳过，不更新', async () => {
    const prisma = setup(null);
    const chat = { complete: jest.fn() } as unknown as FastgptChatService;
    const kb = {} as FastgptKbService;
    const proc = new ReportGenerateProcessor(
      prisma as unknown as PrismaService,
      chat,
      kb,
    );
    await proc.process({ reportId: 'nope' });
    expect(prisma.report.update).not.toHaveBeenCalled();
    expect(chat.complete).not.toHaveBeenCalled();
  });
});
