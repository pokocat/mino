import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { TaskService } from './task.service';

/** FASTGPT_MOCK=true 的 config（complete(dailyQuestion) 返回设计稿那条问题）。 */
const mockConfig = {
  get: (k: string) => (k === 'fastgpt.mock' ? true : undefined),
} as unknown as ConfigService;

/** kb 检索桩。 */
function stubKb(fragments: string[] = []): FastgptKbService {
  return {
    search: jest.fn().mockResolvedValue(fragments),
  } as unknown as FastgptKbService;
}

describe('TaskService', () => {
  describe('getToday（惰性生成 + 幂等）', () => {
    it('当日无任务 → 惰性生成，返回设计稿那条今日一问', async () => {
      const created = {
        id: 'task-new',
        question: '你最值钱的一张牌是什么？',
        hint: '别急着答。先想想——离了它，你的生意还剩几成。',
        estMinutes: 3,
        status: 'pending',
        conversationId: null,
      };
      const prisma = {
        task: {
          findFirst: jest.fn().mockResolvedValue(null), // 两次都无
          create: jest.fn().mockResolvedValue(created),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            industry: null,
            bizNote: null,
            kbId: null,
          }),
        },
      };
      const svc = new TaskService(
        prisma as unknown as PrismaService,
        new FastgptChatService(mockConfig),
        stubKb(),
      );

      const view = await svc.getToday('u1');
      expect(view).toEqual({
        id: 'task-new',
        question: '你最值钱的一张牌是什么？',
        hint: '别急着答。先想想——离了它，你的生意还剩几成。',
        estMinutes: 3,
        status: 'pending',
      });
      // 落库为 daily_q + pending + 带 expiresAt + promptSeed 含问题
      const createArg = prisma.task.create.mock.calls[0][0];
      expect(createArg.data.type).toBe('daily_q');
      expect(createArg.data.status).toBe('pending');
      expect(createArg.data.expiresAt).toBeInstanceOf(Date);
      expect(createArg.data.promptSeed).toContain('你最值钱的一张牌是什么？');
    });

    it('当日已有 pending 任务 → 幂等返回，不再建', async () => {
      const existing = {
        id: 'task-x',
        question: 'Q',
        hint: 'H',
        estMinutes: 4,
        status: 'pending',
        conversationId: null,
      };
      const prisma = {
        task: {
          findFirst: jest.fn().mockResolvedValue(existing),
          create: jest.fn(),
        },
        user: { findUnique: jest.fn() },
      };
      const svc = new TaskService(
        prisma as unknown as PrismaService,
        new FastgptChatService(mockConfig),
        stubKb(),
      );
      const view = await svc.getToday('u1');
      expect(view?.id).toBe('task-x');
      expect(prisma.task.create).not.toHaveBeenCalled();
    });
  });

  describe('start（建会话 + 幂等 + 归属）', () => {
    function buildPrisma(task: unknown) {
      return {
        task: {
          findFirst: jest.fn().mockResolvedValue(task),
          update: jest.fn().mockResolvedValue({}),
        },
        conversation: {
          create: jest.fn().mockResolvedValue({ id: 'conv-new' }),
        },
      };
    }

    it('首次 start：建会话（开场=promptSeed），task→started，返回 conversationId', async () => {
      const prisma = buildPrisma({
        id: 'task-1',
        status: 'pending',
        conversationId: null,
        promptSeed: '兄弟，今天先想通这一件事——你最值钱的一张牌是什么？',
      });
      const svc = new TaskService(
        prisma as unknown as PrismaService,
        new FastgptChatService(mockConfig),
        stubKb(),
      );
      const res = await svc.start('u1', 'task-1');
      expect(res).toEqual({ conversationId: 'conv-new' });
      // 开场 assistant 消息 = promptSeed
      const convArg = prisma.conversation.create.mock.calls[0][0];
      expect(convArg.data.messages.create).toEqual({
        role: 'assistant',
        content: '兄弟，今天先想通这一件事——你最值钱的一张牌是什么？',
      });
      // task 置 started + conversationId
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'started', conversationId: 'conv-new' },
      });
    });

    it('已 started 且有会话 → 幂等直接返回既有 conversationId，不再建会话', async () => {
      const prisma = buildPrisma({
        id: 'task-1',
        status: 'started',
        conversationId: 'conv-existing',
        promptSeed: 'seed',
      });
      const svc = new TaskService(
        prisma as unknown as PrismaService,
        new FastgptChatService(mockConfig),
        stubKb(),
      );
      const res = await svc.start('u1', 'task-1');
      expect(res).toEqual({ conversationId: 'conv-existing' });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('非本人任务（findFirst 返回 null）→ 抛 403', async () => {
      const prisma = buildPrisma(null);
      const svc = new TaskService(
        prisma as unknown as PrismaService,
        new FastgptChatService(mockConfig),
        stubKb(),
      );
      await expect(svc.start('u-x', 'task-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
