import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportGenerateProcessor } from '../queue/report-generate.processor';
import { ReportGenerateQueue } from '../queue/report-generate.queue';
import { ReportService } from './report.service';

/** 队列桩：enqueued 控制 enqueue 返回（true=入队成功，false=降级）。 */
function stubQueue(enqueued: boolean): ReportGenerateQueue & {
  enqueue: jest.Mock;
} {
  return {
    enqueue: jest.fn().mockResolvedValue(enqueued),
  } as unknown as ReportGenerateQueue & { enqueue: jest.Mock };
}

/** Processor 桩。 */
function stubProcessor(): ReportGenerateProcessor & { process: jest.Mock } {
  return {
    process: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReportGenerateProcessor & { process: jest.Mock };
}

describe('ReportService', () => {
  describe('generate（用户主动）', () => {
    it('校验会话归属 → 建行 → 入队成功则不同步执行，返回 generating', async () => {
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
        },
        report: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'rpt-1' }),
        },
      };
      const queue = stubQueue(true);
      const processor = stubProcessor();
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        queue,
        processor,
      );

      const res = await svc.generate('user-1', 'conv-1', 'strategy');

      expect(res).toEqual({ reportId: 'rpt-1', status: 'generating' });
      // 建行：generating + origin=user + 关联会话
      const createArg = prisma.report.create.mock.calls[0][0];
      expect(createArg.data.status).toBe('generating');
      expect(createArg.data.origin).toBe('user');
      expect(createArg.data.sources.create.conversationId).toBe('conv-1');
      // strategy 不计 sequenceNo
      expect(createArg.data.sequenceNo).toBeNull();
      expect(queue.enqueue).toHaveBeenCalledWith({ reportId: 'rpt-1' });
      expect(processor.process).not.toHaveBeenCalled();
    });

    it('非本人会话 → 403', async () => {
      const prisma = {
        conversation: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      await expect(
        svc.generate('user-x', 'conv-1', 'strategy'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('Redis 不可用（enqueue=false）→ 同步执行 processor', async () => {
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
        },
        report: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'rpt-2' }),
        },
      };
      const queue = stubQueue(false);
      const processor = stubProcessor();
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        queue,
        processor,
      );
      const res = await svc.generate('user-1', 'conv-1', 'resume');
      expect(res.status).toBe('generating');
      // resume → sequenceNo = 已有数 + 1
      const createArg = prisma.report.create.mock.calls[0][0];
      expect(createArg.data.sequenceNo).toBe(1);
      // 同步降级：processor 被 await 调用
      expect(processor.process).toHaveBeenCalledWith({ reportId: 'rpt-2' });
    });
  });

  describe('createAgentReport（军师主动 · 每日上限）', () => {
    it('未达上限 → 建 origin=agent 报告（meta.topic）并入队', async () => {
      const prisma = {
        report: {
          count: jest.fn().mockResolvedValue(0), // 今日 agent 报告 0 份
          create: jest.fn().mockResolvedValue({ id: 'rpt-a' }),
        },
      };
      const queue = stubQueue(true);
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        queue,
        stubProcessor(),
      );
      const res = await svc.createAgentReport(
        'user-1',
        'conv-1',
        'review',
        '留住回头客',
      );
      expect(res).toEqual({ reportId: 'rpt-a' });
      const createArg = prisma.report.create.mock.calls[0][0];
      expect(createArg.data.origin).toBe('agent');
      expect(createArg.data.meta).toEqual({ topic: '留住回头客' });
    });

    it('已达上限（今日已有 1 份）→ 返回 null，不建报告', async () => {
      const prisma = {
        report: {
          count: jest.fn().mockResolvedValue(1),
          create: jest.fn(),
        },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      const res = await svc.createAgentReport(
        'user-1',
        'conv-1',
        'strategy',
        't',
      );
      expect(res).toBeNull();
      expect(prisma.report.create).not.toHaveBeenCalled();
    });
  });

  describe('stats（只计 ready）', () => {
    it('聚合 total/byType/unread', async () => {
      const prisma = {
        report: {
          groupBy: jest.fn().mockResolvedValue([
            { type: 'strategy', _count: { _all: 3 } },
            { type: 'resume', _count: { _all: 2 } },
          ]),
          count: jest.fn().mockResolvedValue(4),
        },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      const stats = await svc.stats('user-1');
      expect(stats).toEqual({
        total: 5,
        byType: { strategy: 3, resume: 2, review: 0, decision: 0 },
        unread: 4,
      });
      // groupBy 与 count 都限定 status=ready
      expect(prisma.report.groupBy.mock.calls[0][0].where.status).toBe('ready');
    });
  });

  describe('list（游标分页 + summary）', () => {
    it('多取一条判定 nextCursor；summary 去标记截断', async () => {
      const rows = [
        {
          id: 'r1',
          type: 'strategy',
          status: 'ready',
          title: 'T1',
          bodyMd:
            '## 主要矛盾\n\n**扩张**的速度与信任沉淀是主要矛盾，需要慢慢来。',
          origin: 'user',
          isRead: false,
          wordCount: 100,
          createdAt: new Date('2026-07-10T02:00:00Z'),
        },
        {
          id: 'r2',
          type: 'resume',
          status: 'generating',
          title: '军师正在执笔…',
          bodyMd: '',
          origin: 'agent',
          isRead: false,
          wordCount: 0,
          createdAt: new Date('2026-07-09T02:00:00Z'),
        },
      ];
      const prisma = {
        report: { findMany: jest.fn().mockResolvedValue(rows) },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      const res = await svc.list('user-1', { limit: 1 });
      // limit=1 → take 2；返回 1 条 + nextCursor
      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).not.toBeNull();
      // summary 去掉了 ## 与 **，且不超 60 字
      expect(res.items[0].summary).not.toContain('##');
      expect(res.items[0].summary).not.toContain('**');
      expect(res.items[0].summary.startsWith('扩张的速度')).toBe(true);
      // findMany take = limit + 1
      expect(prisma.report.findMany.mock.calls[0][0].take).toBe(2);
    });
  });

  describe('markRead / chatAboutReport', () => {
    it('markRead 置 isRead/readAt', async () => {
      const prisma = {
        report: {
          findFirst: jest.fn().mockResolvedValue({ id: 'r1', title: 'T' }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      const res = await svc.markRead('user-1', 'r1');
      expect(res).toEqual({ ok: true });
      const arg = prisma.report.update.mock.calls[0][0];
      expect(arg.data.isRead).toBe(true);
      expect(arg.data.readAt).toBeInstanceOf(Date);
    });

    it('chatAboutReport 新建会话：seedReportId + 引用标题的开场', async () => {
      const prisma = {
        report: {
          findFirst: jest.fn().mockResolvedValue({ id: 'r1', title: '护城河' }),
        },
        conversation: {
          create: jest.fn().mockResolvedValue({ id: 'conv-new' }),
        },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      const res = await svc.chatAboutReport('user-1', 'r1');
      expect(res).toEqual({ conversationId: 'conv-new' });
      const arg = prisma.conversation.create.mock.calls[0][0];
      expect(arg.data.seedReportId).toBe('r1');
      // 开场 assistant 消息引用报告标题
      expect(arg.data.messages.create.role).toBe('assistant');
      expect(arg.data.messages.create.content).toContain('护城河');
    });

    it('非本人报告 → 403', async () => {
      const prisma = {
        report: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      await expect(svc.markRead('user-x', 'r1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
