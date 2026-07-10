import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Conversation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { ChatService, inferReportType, SseEvent } from './chat.service';
import { JUNSHI_OPENING } from './junshi-constants';

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
      message: { create: jest.Mock; findMany: jest.Mock };
      conversation: { update: jest.Mock };
    };
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
        },
        conversation: { update: jest.fn().mockResolvedValue({}) },
      };
      const fastgpt = new FastgptChatService(mockConfig);
      service = new ChatService(
        prisma as unknown as PrismaService,
        fastgpt,
        mockConfig,
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

      // reportOffer 携带 mock 标记的 type=review
      const offer = events.find((e) => e.event === 'reportOffer');
      expect(offer?.data).toEqual({
        reportType: 'review',
        topic: '留住回头客的复盘',
      });

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
