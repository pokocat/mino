import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Conversation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { KbIngestQueue } from '../queue/kb-ingest.queue';
import { ReportService } from '../report/report.service';
import { WxSecService } from '../safety/wx-sec.service';
import { StreakService } from '../streak/streak.service';
import {
  ChatService,
  inferReportType,
  RETRACT_TEXT,
  SseEvent,
} from './chat.service';
import { JUNSHI_OPENING } from './junshi-constants';

/** 内容安全桩：默认全部 pass（可覆写 checkText 模拟命中）。 */
function stubSafety(): WxSecService & { checkText: jest.Mock } {
  return {
    checkText: jest.fn().mockResolvedValue({ risky: false }),
  } as unknown as WxSecService & { checkText: jest.Mock };
}

/** streak 结算桩（旁路，不触 DB）。 */
function stubStreak(): StreakService & { settleOnMessage: jest.Mock } {
  return {
    settleOnMessage: jest.fn().mockResolvedValue(1),
    getStreak: jest.fn().mockResolvedValue(1),
  } as unknown as StreakService & { settleOnMessage: jest.Mock };
}

/** 检索无命中的 kb 桩（默认不注入档案上下文）。 */
function stubKb(fragments: string[] = []): FastgptKbService {
  return {
    search: jest.fn().mockResolvedValue(fragments),
  } as unknown as FastgptKbService;
}

/** 入队桩。 */
function stubQueue(): KbIngestQueue & { enqueue: jest.Mock } {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as KbIngestQueue & { enqueue: jest.Mock };
}

/** ReportService 桩：默认军师主动建报告成功返回 reportId（可覆写为 null 模拟每日上限）。 */
function stubReports(
  result: { reportId: string } | null = { reportId: 'rpt-agent' },
): ReportService & { createAgentReport: jest.Mock } {
  return {
    createAgentReport: jest.fn().mockResolvedValue(result),
  } as unknown as ReportService & { createAgentReport: jest.Mock };
}

function buildConversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: 'conv-1',
    userId: 'user-1',
    fastgptChatId: 'chat-1',
    title: null,
    lastMessageAt: null,
    createdAt: new Date(),
    seedReportId: null,
    ...overrides,
  };
}

describe('ChatService', () => {
  // FASTGPT_MOCK=true 的 config，走内置假流
  const mockConfig = {
    get: (key: string) => (key === 'fastgpt.mock' ? true : undefined),
  } as unknown as ConfigService;

  describe('createConversation（建会话含军师开场白）', () => {
    it('同步落一条 assistant 开场白，并置 lastMessageAt', async () => {
      const prisma = {
        conversation: {
          create: jest.fn().mockResolvedValue({
            id: 'conv-new',
            fastgptChatId: 'chat-new',
          }),
        },
      };
      const service = new ChatService(
        prisma as unknown as PrismaService,
        {} as FastgptChatService,
        mockConfig,
        stubKb(),
        stubQueue(),
        stubReports(),
        stubStreak(),
        stubSafety(),
      );

      const result = await service.createConversation('user-1');

      expect(result).toEqual({
        conversationId: 'conv-new',
        fastgptChatId: 'chat-new',
      });
      const createArg = prisma.conversation.create.mock.calls[0][0];
      expect(createArg.data.lastMessageAt).toBeInstanceOf(Date);
      // 嵌套创建首条 assistant 消息 = 开场白原文（与 deploy 文档同源常量）
      expect(createArg.data.messages.create).toEqual({
        role: 'assistant',
        content: JUNSHI_OPENING,
      });
      expect(JUNSHI_OPENING.startsWith('兄弟，坐下聊。')).toBe(true);
    });
  });

  describe('streamReply（mock 流端到端）', () => {
    let prisma: {
      message: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
      conversation: { update: jest.Mock };
      user: { findUnique: jest.Mock };
    };
    let queue: KbIngestQueue & { enqueue: jest.Mock };
    let reports: ReportService & { createAgentReport: jest.Mock };
    let safety: WxSecService & { checkText: jest.Mock };
    let service: ChatService;

    beforeEach(() => {
      prisma = {
        message: {
          create: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ id: `msg-${data.role}`, ...data }),
            ),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn().mockResolvedValue({}),
        },
        conversation: { update: jest.fn().mockResolvedValue({}) },
        // 默认无 kb → 检索跳过，保留既有断言（全文以「兄弟」开头）
        user: { findUnique: jest.fn().mockResolvedValue({ kbId: null }) },
      };
      const fastgpt = new FastgptChatService(mockConfig);
      queue = stubQueue();
      reports = stubReports();
      safety = stubSafety();
      service = new ChatService(
        prisma as unknown as PrismaService,
        fastgpt,
        mockConfig,
        stubKb(),
        queue,
        reports,
        stubStreak(),
        safety,
      );
    });

    it('产出 token…→suggestions→reportOffer→done，且落库全文已剥离标记', async () => {
      const conv = buildConversation();
      const events: SseEvent[] = [];
      for await (const evt of service.streamReply(
        conv,
        '我想复盘一下最近的生意',
      )) {
        events.push(evt);
      }

      const names = events.map((e) => e.event);
      // 至少一个 token，且无 error
      expect(names).toContain('token');
      expect(names).not.toContain('error');
      // 尾部顺序硬契约：suggestions → reportOffer → done
      expect(names.slice(-3)).toEqual(['suggestions', 'reportOffer', 'done']);

      // token 拼接后的全文不含标记文本
      const full = events
        .filter((e) => e.event === 'token')
        .map((e) => (e.data as { t: string }).t)
        .join('');
      expect(full).not.toContain('mino:report');
      expect(full.startsWith('兄弟')).toBe(true);

      // reportOffer 携带 mock 标记的 type=review，且军师主动建了报告 → 带 reportId
      const offer = events.find((e) => e.event === 'reportOffer');
      expect(offer?.data).toEqual({
        reportType: 'review',
        topic: '留住回头客的复盘',
        reportId: 'rpt-agent',
      });
      // 军师主动触发：以会话归属信息调 createAgentReport
      expect(reports.createAgentReport).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
        'review',
        '留住回头客的复盘',
      );

      // suggestions：primary 生成报告项 + mock 两条追问
      const sug = events.find((e) => e.event === 'suggestions');
      const items = (sug?.data as { items: any[] }).items;
      expect(items[0]).toEqual({
        text: '好，帮我写一份《…》报告',
        primary: true,
        action: 'generateReport',
        reportType: 'review',
      });
      expect(items).toHaveLength(3);
      expect(items.slice(1).every((i) => i.action === 'chat')).toBe(true);

      // 落库：assistant 全文剥离标记；conversation 更新了 title/lastMessageAt
      const assistantCreate = prisma.message.create.mock.calls.find(
        (c) => c[0].data.role === 'assistant',
      );
      expect(assistantCreate[0].data.content).not.toContain('mino:report');
      const updateArg = prisma.conversation.update.mock.calls[0][0];
      expect(updateArg.data.title).toBe('我想复盘一下最近的生意'.slice(0, 20));
      expect(updateArg.data.lastMessageAt).toBeInstanceOf(Date);

      // done 携带 assistant messageId 与 conversationId
      const done = events.find((e) => e.event === 'done');
      expect(done?.data).toEqual({
        messageId: 'msg-assistant',
        conversationId: 'conv-1',
      });
    });

    it('已有 title 时不覆盖标题', async () => {
      const conv = buildConversation({ title: '老标题' });
      for await (const _ of service.streamReply(conv, '再聊聊')) {
        void _;
      }
      const updateArg = prisma.conversation.update.mock.calls[0][0];
      expect(updateArg.data.title).toBeUndefined();
    });

    it('军师主动命中每日上限（createAgentReport 返回 null）时 reportOffer 不带 reportId', async () => {
      // 覆写 reports 桩为 null（模拟已达当日 origin=agent 上限）
      reports.createAgentReport.mockResolvedValue(null);
      const conv = buildConversation();
      const events: SseEvent[] = [];
      for await (const evt of service.streamReply(conv, '帮我复盘一下')) {
        events.push(evt);
      }
      const offer = events.find((e) => e.event === 'reportOffer');
      // 事件仍发，但无 reportId 字段
      expect(offer?.data).toEqual({
        reportType: 'review',
        topic: '留住回头客的复盘',
      });
      expect('reportId' in (offer!.data as object)).toBe(false);
    });

    it('检索命中时把战略档案摘录作为 system 上下文拼进 FastGPT 入参（不落库/不下发）', async () => {
      // kb 有命中 → user.findUnique 返回 kbId，kb.search 返回两条片段
      prisma.user.findUnique.mockResolvedValue({ kbId: 'mock_kb_user-1' });
      const kb = stubKb(['老板做宠物殡葬生意', '最怕获客渠道断掉']);
      // spy FastGPT 收到的 messages
      const captured: { messages?: { role: string; content: string }[] } = {};
      const fastgpt = {
        streamChat: jest.fn().mockImplementation((params) => {
          captured.messages = params.messages;
          return (async function* () {
            yield '收到';
          })();
        }),
      } as unknown as FastgptChatService;
      const svc = new ChatService(
        prisma as unknown as PrismaService,
        fastgpt,
        mockConfig,
        kb,
        queue,
        reports,
        stubStreak(),
        stubSafety(),
      );

      const conv = buildConversation();
      for await (const _ of svc.streamReply(conv, '我做宠物殡葬，最怕获客断')) {
        void _;
      }

      // 第一条必须是 system 且含档案摘录标题 + 命中片段
      const first = captured.messages?.[0];
      expect(first?.role).toBe('system');
      expect(first?.content).toContain(
        '【你对这位老板的了解（战略档案摘录）】',
      );
      expect(first?.content).toContain('老板做宠物殡葬生意');
      expect(first?.content).toContain('最怕获客渠道断掉');
      expect(kb.search).toHaveBeenCalledWith(
        'mock_kb_user-1',
        '我做宠物殡葬，最怕获客断',
        3,
      );

      // 附加上下文不得落 messages 表：assistant 落库正文里不含档案摘录标题
      const assistantCreate = prisma.message.create.mock.calls.find(
        (c) => c[0].data.role === 'assistant',
      );
      expect(assistantCreate?.[0].data.content).not.toContain('战略档案摘录');
    });

    it('入队失败（Redis 不可达）不抛出，streamReply 仍产出 done', async () => {
      // enqueue 拒绝，模拟 Redis 不可达时入队异常
      queue.enqueue.mockRejectedValue(new Error('Redis unreachable'));
      const conv = buildConversation();
      const events: SseEvent[] = [];
      await expect(
        (async () => {
          for await (const evt of service.streamReply(conv, '随便聊聊')) {
            events.push(evt);
          }
        })(),
      ).resolves.toBeUndefined();
      expect(events.map((e) => e.event)).toContain('done');
    });

    it('军师输出命中内容安全：撤回落库替换 + 发 retract → done，且跳过 suggestions/reportOffer', async () => {
      // 输出审核判 risky（输入审核走 assertInputSafe，此处不触发）
      safety.checkText.mockResolvedValue({ risky: true, label: 'label:20001' });
      const conv = buildConversation();
      const events: SseEvent[] = [];
      for await (const evt of service.streamReply(
        conv,
        '帮我复盘一下',
        'openid-1',
      )) {
        events.push(evt);
      }

      const names = events.map((e) => e.event);
      // 尾部硬契约：retract 紧接 done，且本轮不再发 suggestions / reportOffer
      expect(names.slice(-2)).toEqual(['retract', 'done']);
      expect(names).not.toContain('suggestions');
      expect(names).not.toContain('reportOffer');

      // retract 携带被撤回的 assistant messageId
      const retract = events.find((e) => e.event === 'retract');
      expect(retract?.data).toEqual({ messageId: 'msg-assistant' });

      // 落库内容被替换为撤回文案
      const updateCall = prisma.message.update.mock.calls.find(
        (c) => c[0].where.id === 'msg-assistant',
      );
      expect(updateCall?.[0].data.content).toBe(RETRACT_TEXT);

      // 不据风险内容建报告、不回喂知识库
      expect(reports.createAgentReport).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('assertInputSafe（发消息入口审用户输入 · R7 接线 a）', () => {
    function build(
      safety: WxSecService & { checkText: jest.Mock },
    ): ChatService {
      return new ChatService(
        {} as PrismaService,
        {} as FastgptChatService,
        mockConfig,
        stubKb(),
        stubQueue(),
        stubReports(),
        stubStreak(),
        safety,
      );
    }

    it('命中风险 → 抛 400（含契约文案）', async () => {
      const safety = stubSafety();
      safety.checkText.mockResolvedValue({ risky: true, label: '违禁词' });
      const service = build(safety);
      await expect(
        service.assertInputSafe('openid-1', '这句话含违禁词'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(safety.checkText).toHaveBeenCalledWith(
        'openid-1',
        '这句话含违禁词',
        3,
      );
    });

    it('审核通过 → 不抛出', async () => {
      const service = build(stubSafety());
      await expect(
        service.assertInputSafe('openid-1', '正常的一句话'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getOwnedConversation（归属校验）', () => {
    it('非本人会话抛 403', async () => {
      const prisma = {
        conversation: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = new ChatService(
        prisma as unknown as PrismaService,
        {} as FastgptChatService,
        mockConfig,
        stubKb(),
        stubQueue(),
        stubReports(),
        stubStreak(),
        stubSafety(),
      );
      await expect(
        service.getOwnedConversation('user-x', 'conv-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('inferReportType（报告类型启发式）', () => {
    it.each([
      ['帮我复盘上个月', 'review'],
      ['我到底要不要接这单', 'decision'],
      ['我为什么当年选了这行', 'resume'],
      ['本周该怎么打', 'strategy'],
    ])('%s → %s', (content, expected) => {
      expect(inferReportType(content)).toBe(expected);
    });
  });
});
