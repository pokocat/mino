import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { WxPushService } from '../push/wx-push.service';
import {
  buildReportMessages,
  countWords,
  parseReportJson,
  ParsedReport,
} from '../report/report-prompt';
import { ReportGenerateJobData } from './report-generate.types';

/**
 * report-generate 的实际处理逻辑（与 BullMQ Worker 解耦，队列/同步降级两条路径共用）。
 *
 * 流程：取报告行 + 关联会话消息 + kb 检索（用会话要点作 query）+ 用户画像 →
 *       调 FastgptChatService.complete（报告提示词）→ 解析校验 JSON（失败重试 1 次，再失败 failed）→
 *       更新报告 ready（wordCount 服务端按正文字数重算）→ 回喂知识库（标题+首段，meta.kb_synced=true）→
 *       推送留 TODO 日志（订阅消息 M5）。
 *
 * 容错纪律：任何异常都在此内部消化并把报告置 failed，不向外抛出——
 * 保证队列 job 与同步降级两条路径都以「报告落最终态」收尾，绝不炸主链路。
 */
@Injectable()
export class ReportGenerateProcessor {
  private readonly logger = new Logger(ReportGenerateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fastgptChat: FastgptChatService,
    private readonly kb: FastgptKbService,
    private readonly push: WxPushService,
  ) {}

  async process(data: ReportGenerateJobData): Promise<void> {
    const report = await this.prisma.report.findUnique({
      where: { id: data.reportId },
      include: {
        user: {
          select: {
            industry: true,
            bizNote: true,
            kbId: true,
            wxOpenid: true,
            nickname: true,
          },
        },
        sources: {
          include: {
            conversation: {
              select: { id: true, fastgptChatId: true, userId: true },
            },
          },
        },
      },
    });
    if (!report) {
      this.logger.warn(`report-generate：报告 ${data.reportId} 不存在，跳过`);
      return;
    }
    if (report.status === 'ready') {
      this.logger.debug(`report-generate：报告 ${report.id} 已 ready，跳过`);
      return;
    }

    try {
      const parsed = await this.generateBody(report);
      if (!parsed) {
        await this.markFailed(report.id, '解析报告 JSON 失败（重试后仍失败）');
        return;
      }

      const wordCount = countWords(parsed.bodyMd);
      const meta = mergeMeta(report.meta, { kb_synced: false });
      await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: 'ready',
          title: parsed.title,
          bodyMd: parsed.bodyMd,
          annotation: parsed.annotation || null,
          wordCount,
          meta,
        },
      });
      this.logger.log(
        `report-generate：报告 ${report.id} 已就绪（${wordCount} 字）`,
      );

      // 回喂知识库：标题 + 首段（失败不影响报告 ready）
      await this.syncToKb(report.id, report.userId, parsed);

      // 订阅消息推送「军师刚写好一份…」（R4；WxPushService 内部自消化异常，绝不抛出）
      await this.push.sendReportReady(
        { wxOpenid: report.user.wxOpenid, nickname: report.user.nickname },
        { id: report.id, title: parsed.title },
      );
    } catch (err) {
      this.logger.error(
        `report-generate：报告 ${report.id} 生成异常：${String(err)}`,
      );
      await this.markFailed(report.id, String(err));
    }
  }

  /** 组装素材调工作流并解析；解析失败重试 1 次（共 2 次尝试）。 */
  private async generateBody(report: {
    id: string;
    type: import('@prisma/client').ReportType;
    meta: unknown;
    user: { industry: string | null; bizNote: string | null };
    sources: {
      conversation: { id: string; fastgptChatId: string; userId: string };
    }[];
  }): Promise<ParsedReport | null> {
    const conv = report.sources[0]?.conversation;
    const dialogue = conv ? await this.loadDialogue(conv.id) : '';
    const kbFragments = conv
      ? await this.retrieveKb(conv.userId, dialogue)
      : [];
    const topic = readTopic(report.meta);
    const messages = buildReportMessages({
      type: report.type,
      dialogue,
      kbFragments,
      industry: report.user.industry,
      bizNote: report.user.bizNote,
      topic,
    });

    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await this.fastgptChat.complete({
        chatId: conv?.fastgptChatId ?? report.id,
        userId: conv?.userId ?? '',
        messages,
        reportType: report.type,
      });
      const parsed = parseReportJson(raw);
      if (parsed) return parsed;
      this.logger.warn(
        `report-generate：报告 ${report.id} 第 ${attempt} 次解析失败`,
      );
    }
    return null;
  }

  /** 取会话全部消息拼成「老板/军师」对话文本。 */
  private async loadDialogue(conversationId: string): Promise<string> {
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    return msgs
      .map((m) => `${m.role === 'user' ? '老板' : '军师'}：${m.content}`)
      .join('\n');
  }

  /** 以对话文本为 query 检索用户知识库（无 kb / 异常 → 空）。 */
  private async retrieveKb(userId: string, query: string): Promise<string[]> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { kbId: true },
      });
      if (!user?.kbId) return [];
      return await this.kb.search(user.kbId, query.slice(0, 500), 3);
    } catch (err) {
      this.logger.warn(`report-generate：kb 检索失败，跳过：${String(err)}`);
      return [];
    }
  }

  /** 回喂知识库：报告标题 + 首段写入用户库，成功后置 meta.kb_synced=true。 */
  private async syncToKb(
    reportId: string,
    userId: string,
    parsed: ParsedReport,
  ): Promise<void> {
    try {
      const kbId = await this.kb.ensureUserKb(userId);
      const firstPara = parsed.bodyMd.split(/\n{2,}/)[0]?.trim() ?? '';
      await this.kb.pushText(
        kbId,
        `报告·${parsed.title}`,
        `${parsed.title}\n${firstPara}`,
      );
      const cur = await this.prisma.report.findUnique({
        where: { id: reportId },
        select: { meta: true },
      });
      await this.prisma.report.update({
        where: { id: reportId },
        data: { meta: mergeMeta(cur?.meta, { kb_synced: true }) },
      });
      this.logger.log(`report-generate：报告 ${reportId} 已回喂知识库 ${kbId}`);
    } catch (err) {
      this.logger.warn(
        `report-generate：报告 ${reportId} 回喂知识库失败（不影响 ready）：${String(err)}`,
      );
    }
  }

  /** 置 failed（保留已有 meta）。 */
  private async markFailed(reportId: string, reason: string): Promise<void> {
    this.logger.warn(`report-generate：报告 ${reportId} 置 failed：${reason}`);
    await this.prisma.report
      .update({ where: { id: reportId }, data: { status: 'failed' } })
      .catch((e) =>
        this.logger.error(`report-generate：置 failed 也失败：${String(e)}`),
      );
  }
}

/** 从 meta(jsonb) 读 topic（军师主动触发时写入）。 */
function readTopic(meta: unknown): string | null {
  if (meta && typeof meta === 'object' && 'topic' in meta) {
    const t = (meta as Record<string, unknown>).topic;
    return typeof t === 'string' ? t : null;
  }
  return null;
}

/** 合并 meta：把 patch 覆盖进原 meta（原 meta 非对象则从空开始），返回 Prisma JSON 入参类型。 */
function mergeMeta(
  meta: unknown,
  patch: Record<string, unknown>,
): Prisma.InputJsonObject {
  const base =
    meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  return { ...base, ...patch } as Prisma.InputJsonObject;
}
