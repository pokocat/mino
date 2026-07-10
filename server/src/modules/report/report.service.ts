import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, ReportOrigin, ReportType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportGenerateProcessor } from '../queue/report-generate.processor';
import { ReportGenerateQueue } from '../queue/report-generate.queue';
import { buildSummary } from './report-prompt';

/** 生成中占位标题（端上列表可直接展示「军师正在执笔…」）。 */
const PLACEHOLDER_TITLE = '军师正在执笔…';

/** 每用户每日 origin=agent（军师主动）报告上限。 */
const AGENT_DAILY_LIMIT = 1;

/** 列表分页上限。 */
const MAX_LIMIT = 50;

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ReportGenerateQueue,
    private readonly processor: ReportGenerateProcessor,
  ) {}

  // ============ 生成（用户主动 / 军师主动） ============

  /**
   * 用户主动生成：校验会话归属 → 建 reports 行（generating, origin=user）→ 入队；
   * Redis 不可用则**降级同步执行**（await 生成），保证功能可用。
   * 契约固定返回 {reportId, status:'generating'}（同步降级也返回该字面，端上轮询 GET /reports/:id 取最终态）。
   */
  async generate(
    userId: string,
    conversationId: string,
    type: ReportType,
  ): Promise<{ reportId: string; status: 'generating' }> {
    await this.assertOwnedConversation(userId, conversationId);
    const reportId = await this.createRow(userId, conversationId, type, 'user');

    const enqueued = await this.queue.enqueue({ reportId });
    if (!enqueued) {
      // 同步降级：就地跑 Worker 逻辑（Processor 内部自消化异常并落最终态）
      await this.processor.process({ reportId });
    }
    return { reportId, status: 'generating' };
  }

  /**
   * 军师主动生成（§8.4）：受「每用户每日 origin=agent 上限」约束。
   * 超限返回 null（调用方只发事件不建报告）；否则建行入队（Redis 不可用则就地异步执行，不阻塞 SSE）。
   */
  async createAgentReport(
    userId: string,
    conversationId: string,
    type: ReportType,
    topic: string,
  ): Promise<{ reportId: string } | null> {
    const usedToday = await this.countAgentReportsToday(userId);
    if (usedToday >= AGENT_DAILY_LIMIT) {
      this.logger.log(
        `军师主动报告已达每日上限（${AGENT_DAILY_LIMIT}），用户 ${userId} 本次只发事件不建报告`,
      );
      return null;
    }

    const reportId = await this.createRow(
      userId,
      conversationId,
      type,
      'agent',
      topic,
    );
    const enqueued = await this.queue.enqueue({ reportId });
    if (!enqueued) {
      // 降级：军师主动路径不阻塞 SSE，就地异步执行（不 await）
      void this.processor
        .process({ reportId })
        .catch((e) =>
          this.logger.error(`军师主动报告同步降级异常：${String(e)}`),
        );
    }
    return { reportId };
  }

  /** 建报告行（generating）+ 关联会话；resume 计算 sequenceNo；返回 reportId。 */
  private async createRow(
    userId: string,
    conversationId: string,
    type: ReportType,
    origin: ReportOrigin,
    topic?: string,
  ): Promise<string> {
    const sequenceNo =
      type === 'resume'
        ? (await this.prisma.report.count({
            where: { userId, type: 'resume' },
          })) + 1
        : null;

    const report = await this.prisma.report.create({
      data: {
        userId,
        type,
        status: 'generating',
        origin,
        title: PLACEHOLDER_TITLE,
        bodyMd: '',
        wordCount: 0,
        sequenceNo,
        meta: topic ? { topic } : {},
        sources: { create: { conversationId } },
      },
      select: { id: true },
    });
    return report.id;
  }

  /** 统计该用户今日（Asia/Shanghai 日界）origin=agent 的报告数。 */
  private async countAgentReportsToday(userId: string): Promise<number> {
    return this.prisma.report.count({
      where: {
        userId,
        origin: 'agent',
        createdAt: { gte: shanghaiDayStart(new Date()) },
      },
    });
  }

  // ============ 查询 ============

  /**
   * 列表：createdAt+id 游标分页；generating/failed 也返回（占位标题）。
   * summary = bodyMd 首段去 Markdown 标记截 60 字。
   */
  async list(
    userId: string,
    opts: { type?: ReportType; cursor?: string; limit?: number },
  ): Promise<{ items: ReportListItem[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), MAX_LIMIT);
    const where: Prisma.ReportWhereInput = { userId };
    if (opts.type) where.type = opts.type;
    const cur = decodeCursor(opts.cursor);
    if (cur) {
      where.OR = [
        { createdAt: { lt: cur.createdAt } },
        { createdAt: cur.createdAt, id: { lt: cur.id } },
      ];
    }

    const rows = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // 多取一条判断是否还有下一页
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        bodyMd: true,
        origin: true,
        isRead: true,
        wordCount: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items: ReportListItem[] = page.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      title: r.title,
      summary: buildSummary(r.bodyMd),
      origin: r.origin,
      isRead: r.isRead,
      wordCount: r.wordCount,
      createdAt: r.createdAt,
    }));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  }

  /** 统计：只计 ready。 {total, byType:{...四类}, unread}。 */
  async stats(userId: string): Promise<ReportStats> {
    const grouped = await this.prisma.report.groupBy({
      by: ['type'],
      where: { userId, status: 'ready' },
      _count: { _all: true },
    });
    const byType = { strategy: 0, resume: 0, review: 0, decision: 0 };
    let total = 0;
    for (const g of grouped) {
      byType[g.type] = g._count._all;
      total += g._count._all;
    }
    const unread = await this.prisma.report.count({
      where: { userId, status: 'ready', isRead: false },
    });
    return { total, byType, unread };
  }

  /** 详情（校验归属，含 sources）。 */
  async getDetail(userId: string, id: string): Promise<ReportDetail> {
    const r = await this.prisma.report.findFirst({
      where: { id, userId },
      include: {
        sources: {
          include: {
            conversation: { select: { id: true, title: true } },
          },
        },
      },
    });
    if (!r)
      throw new ForbiddenException({ code: 403, message: '无权访问该报告' });
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      title: r.title,
      bodyMd: r.bodyMd,
      annotation: r.annotation,
      origin: r.origin,
      isRead: r.isRead,
      wordCount: r.wordCount,
      sequenceNo: r.sequenceNo,
      meta: r.meta,
      createdAt: r.createdAt,
      sources: r.sources.map((s) => ({
        conversationId: s.conversation.id,
        title: s.conversation.title,
      })),
    };
  }

  /** 置已读（isRead/readAt）。 */
  async markRead(userId: string, id: string): Promise<{ ok: true }> {
    await this.assertOwnedReport(userId, id);
    await this.prisma.report.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * 「跟军师聊这份报告」：新建会话，注入军师引用该报告标题的一句开场（assistant），
   * 并把报告全文作为附加上下文——通过 conversation.seedReportId 记录，
   * 首轮对话时由 ChatService 额外把报告全文拼入 system 上下文（不落 messages、不下发端上）。
   */
  async chatAboutReport(
    userId: string,
    id: string,
  ): Promise<{ conversationId: string }> {
    const report = await this.assertOwnedReport(userId, id);
    const opening =
      `《${report.title}》这份我给你写好了。` +
      '想从哪一段接着聊，还是让我先带你把重点过一遍？';
    const conv = await this.prisma.conversation.create({
      data: {
        userId,
        fastgptChatId: randomUUID(),
        lastMessageAt: new Date(),
        seedReportId: report.id,
        messages: { create: { role: 'assistant', content: opening } },
      },
      select: { id: true },
    });
    return { conversationId: conv.id };
  }

  // ============ 归属校验 ============

  private async assertOwnedConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!conv) {
      throw new ForbiddenException({ code: 403, message: '无权访问该会话' });
    }
  }

  private async assertOwnedReport(
    userId: string,
    id: string,
  ): Promise<{ id: string; title: string }> {
    const report = await this.prisma.report.findFirst({
      where: { id, userId },
      select: { id: true, title: true },
    });
    if (!report) {
      throw new ForbiddenException({ code: 403, message: '无权访问该报告' });
    }
    return report;
  }
}

// ============ 出参类型 ============

export interface ReportListItem {
  id: string;
  type: ReportType;
  status: string;
  title: string;
  summary: string;
  origin: ReportOrigin;
  isRead: boolean;
  wordCount: number;
  createdAt: Date;
}

export interface ReportStats {
  total: number;
  byType: Record<ReportType, number>;
  unread: number;
}

export interface ReportDetail {
  id: string;
  type: ReportType;
  status: string;
  title: string;
  bodyMd: string;
  annotation: string | null;
  origin: ReportOrigin;
  isRead: boolean;
  wordCount: number;
  sequenceNo: number | null;
  meta: unknown;
  createdAt: Date;
  sources: { conversationId: string; title: string | null }[];
}

// ============ 游标编解码（createdAt + id） ============

/** 编码游标：base64(`ISO时间|id`)。 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

/** 解析游标；非法返回 null。 */
function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep === -1) return null;
    const createdAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Asia/Shanghai（UTC+8）当日 00:00 对应的 UTC 时刻。 */
function shanghaiDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  // 当日 00:00(+08) = 前一日 16:00 UTC
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - 8 * 3600 * 1000);
}
