import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

  describe('append（跟军师补充 · 建续写会话）', () => {
    it('ready 报告 → 建会话（appendReportId + 引用标题的开场）', async () => {
      const prisma = {
        report: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'r1', title: '护城河', status: 'ready' }),
        },
        conversation: {
          create: jest.fn().mockResolvedValue({ id: 'conv-append' }),
        },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      const res = await svc.append('user-1', 'r1');
      expect(res).toEqual({ conversationId: 'conv-append' });
      const arg = prisma.conversation.create.mock.calls[0][0];
      expect(arg.data.appendReportId).toBe('r1');
      expect(arg.data.messages.create.role).toBe('assistant');
      // 开场引用报告标题 + 续写话术
      expect(arg.data.messages.create.content).toContain('护城河');
      expect(arg.data.messages.create.content).toContain('织进去');
    });

    it('非 ready 报告 → 409', async () => {
      const prisma = {
        report: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            title: 'T',
            status: 'generating',
          }),
        },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      await expect(svc.append('user-1', 'r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('报告不存在/非本人 → 404', async () => {
      const prisma = {
        report: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      await expect(svc.append('user-x', 'r1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('appendCommit（续写提交 · 校验矩阵）', () => {
    function buildPrisma(opts: {
      conv?: { id: string; appendReportId: string | null } | null;
      report?: { id: string; title: string; status: string } | null;
    }) {
      return {
        conversation: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              opts.conv === undefined
                ? { id: 'conv-a', appendReportId: 'r1' }
                : opts.conv,
            ),
        },
        report: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              opts.report === undefined
                ? { id: 'r1', title: 'T', status: 'ready' }
                : opts.report,
            ),
          update: jest.fn().mockResolvedValue({}),
        },
      };
    }

    it('会话属于用户且 appendReportId 匹配、报告 ready → 置 generating、入队 mode=append', async () => {
      const prisma = buildPrisma({});
      const queue = stubQueue(true);
      const processor = stubProcessor();
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        queue,
        processor,
      );
      const res = await svc.appendCommit('user-1', 'r1', 'conv-a');
      expect(res).toEqual({ reportId: 'r1', status: 'generating' });
      // 报告置 generating
      expect(prisma.report.update.mock.calls[0][0].data.status).toBe(
        'generating',
      );
      // 入队带 mode=append + conversationId
      expect(queue.enqueue).toHaveBeenCalledWith({
        reportId: 'r1',
        mode: 'append',
        conversationId: 'conv-a',
      });
      expect(processor.process).not.toHaveBeenCalled();
    });

    it('Redis 不可用（enqueue=false）→ 同步执行 processor', async () => {
      const prisma = buildPrisma({});
      const queue = stubQueue(false);
      const processor = stubProcessor();
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        queue,
        processor,
      );
      await svc.appendCommit('user-1', 'r1', 'conv-a');
      expect(processor.process).toHaveBeenCalledWith({
        reportId: 'r1',
        mode: 'append',
        conversationId: 'conv-a',
      });
    });

    it('会话不属于该用户（findFirst null）→ 403', async () => {
      const prisma = buildPrisma({ conv: null });
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      await expect(
        svc.appendCommit('user-x', 'r1', 'conv-a'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('会话 appendReportId 与 :id 不匹配 → 403', async () => {
      const prisma = buildPrisma({
        conv: { id: 'conv-a', appendReportId: 'r-other' },
      });
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      await expect(
        svc.appendCommit('user-1', 'r1', 'conv-a'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('报告非 ready → 409', async () => {
      const prisma = buildPrisma({
        report: { id: 'r1', title: 'T', status: 'generating' },
      });
      const svc = new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
      await expect(
        svc.appendCommit('user-1', 'r1', 'conv-a'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getExport（导出结构化数据 · 决策 5）', () => {
    function svcWith(reportRow: Record<string, unknown> | null): ReportService {
      const prisma = {
        report: { findFirst: jest.fn().mockResolvedValue(reportRow) },
      };
      return new ReportService(
        prisma as unknown as PrismaService,
        stubQueue(true),
        stubProcessor(),
      );
    }

    it('ready 报告 → 硬契约结构（typeLabel/paragraphs/brand 等）', async () => {
      const svc = svcWith({
        type: 'strategy',
        status: 'ready',
        title: '你的护城河',
        bodyMd:
          '## 主要矛盾\n\n扩张 vs **信任**。\n\n## 三步走\n\n1. **守。**先守。',
        annotation: '别急着摊大。',
        origin: 'user',
        wordCount: 42,
        createdAt: new Date('2026-07-01T00:00:00Z'),
      });

      const out = await svc.getExport('user-1', 'r1');
      expect(out.title).toBe('你的护城河');
      expect(out.type).toBe('strategy');
      expect(out.typeLabel).toBe('战略分析');
      expect(out.wordCount).toBe(42);
      expect(out.origin).toBe('user');
      expect(out.annotation).toBe('别急着摊大。');
      expect(out.brand).toEqual({
        name: '米诺战略参谋部',
        slogan: '对话产出报告，报告喂养对话',
      });
      expect(out.paragraphs).toEqual([
        { kind: 'heading', text: '主要矛盾' },
        { kind: 'text', text: '扩张 vs 信任。' },
        { kind: 'heading', text: '三步走' },
        { kind: 'item', text: '守。先守。' },
      ]);
    });

    it('非本人/不存在 → 403', async () => {
      await expect(
        svcWith(null).getExport('user-x', 'r1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('非 ready（generating/failed）→ 404', async () => {
      const svc = svcWith({
        type: 'strategy',
        status: 'generating',
        title: '军师正在执笔…',
        bodyMd: '',
        annotation: null,
        origin: 'user',
        wordCount: 0,
        createdAt: new Date(),
      });
      await expect(svc.getExport('user-1', 'r1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
