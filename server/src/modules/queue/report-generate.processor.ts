import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { WxPushService } from '../push/wx-push.service';
import { WxSecService } from '../safety/wx-sec.service';
import {
  buildAppendMessages,
  buildReportMessages,
  countWords,
  parseAppendReportJson,
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
    private readonly safety: WxSecService,
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

    // 续写（append）分支：报告本是 ready，commit 已置 generating；走独立修订流程。
    if (data.mode === 'append') {
      await this.processAppend(report, data.conversationId);
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

      // 内容安全审报告正文（R7 接线 b）：ready 前审 bodyMd（连标题一起），命中风险置 failed。
      const verdict = await this.safety.checkText(
        report.user.wxOpenid,
        `${parsed.title}\n${parsed.bodyMd}`,
        2,
      );
      if (verdict.risky) {
        await this.markFailed(
          report.id,
          `内容安全审核未通过（label=${verdict.label}）`,
        );
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

      // 订阅消息推送「米诺刚写好一份…」（R4；WxPushService 内部自消化异常，绝不抛出）
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

  /**
   * 续写（append）处理：以原报告全文 + 批注 + 续写会话对话调 complete()，产出修订版正文，
   * 织回原报告并置 ready、追加 report_source、重置 isRead、回喂知识库、推送。
   *
   * 失败回滚取舍（#4-5）：generating 期间**不清空 bodyMd**（仅 status 变化），
   * 因此解析失败/内容安全命中/异常时只需把 status 恢复 ready，报告即回到「原内容 + ready」，
   * 绝不因续写失败丢掉老板已有的报告正文。
   */
  private async processAppend(
    report: {
      id: string;
      userId: string;
      type: import('@prisma/client').ReportType;
      title: string;
      bodyMd: string;
      annotation: string | null;
      meta: unknown;
      user: { wxOpenid: string; nickname: string | null };
    },
    conversationId?: string,
  ): Promise<void> {
    if (!conversationId) {
      await this.rollbackToReady(report.id, '续写缺少会话 id');
      return;
    }
    try {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, fastgptChatId: true, userId: true },
      });
      if (!conv) {
        await this.rollbackToReady(
          report.id,
          `续写会话 ${conversationId} 不存在`,
        );
        return;
      }

      const dialogue = await this.loadDialogue(conversationId);
      const messages = buildAppendMessages({
        type: report.type,
        originalTitle: report.title,
        originalBodyMd: report.bodyMd,
        originalAnnotation: report.annotation,
        dialogue,
      });

      // 解析失败重试 1 次（共 2 次），再失败回滚为原内容 ready。
      let parsed: { bodyMd: string; annotation: string } | null = null;
      for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
        const raw = await this.fastgptChat.complete({
          chatId: conv.fastgptChatId,
          userId: conv.userId,
          messages,
          appendOriginalBody: report.bodyMd, // 仅 mock 用：据此织入可辨识新段落
        });
        parsed = parseAppendReportJson(raw);
        if (!parsed) {
          this.logger.warn(
            `report-append：报告 ${report.id} 第 ${attempt} 次解析失败`,
          );
        }
      }
      if (!parsed) {
        await this.rollbackToReady(report.id, '续写解析失败（重试后仍失败）');
        return;
      }

      // 内容安全审修订版正文（连原标题一起）；命中风险回滚为原内容 ready。
      const verdict = await this.safety.checkText(
        report.user.wxOpenid,
        `${report.title}\n${parsed.bodyMd}`,
        2,
      );
      if (verdict.risky) {
        await this.rollbackToReady(
          report.id,
          `续写内容安全未通过（label=${verdict.label}）`,
        );
        return;
      }

      // 织回：title/type 不变，仅更新 bodyMd/annotation/wordCount；重置未读、置回 ready。
      const wordCount = countWords(parsed.bodyMd);
      const meta = mergeMeta(report.meta, { kb_synced: false });
      await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: 'ready',
          bodyMd: parsed.bodyMd,
          annotation: parsed.annotation || null,
          wordCount,
          isRead: false,
          readAt: null,
          meta,
        },
      });
      this.logger.log(
        `report-append：报告 ${report.id} 已续好（${wordCount} 字）`,
      );

      // 追加 report_source（若尚未关联该会话）——「N 段织成」计数据此增长。
      await this.prisma.reportSource.createMany({
        data: [{ reportId: report.id, conversationId }],
        skipDuplicates: true,
      });

      // 回喂知识库（标题 + 首段）+ 推送「续好了」（复用报告完成推送，文案区分可选）。
      await this.syncToKb(report.id, report.userId, {
        title: report.title,
        bodyMd: parsed.bodyMd,
        annotation: parsed.annotation,
      });
      await this.push.sendReportReady(
        { wxOpenid: report.user.wxOpenid, nickname: report.user.nickname },
        { id: report.id, title: report.title },
      );
    } catch (err) {
      this.logger.error(
        `report-append：报告 ${report.id} 续写异常：${String(err)}`,
      );
      await this.rollbackToReady(report.id, String(err));
    }
  }

  /**
   * 续写失败回滚：把 status 恢复 ready（bodyMd 全程未动 → 报告回到原内容），仅记日志。
   * 与首次生成的 markFailed 不同——续写失败绝不能让已有报告变 failed 而「丢内容」。
   */
  private async rollbackToReady(
    reportId: string,
    reason: string,
  ): Promise<void> {
    this.logger.warn(
      `report-append：报告 ${reportId} 续写失败，回滚为原内容 ready：${reason}`,
    );
    await this.prisma.report
      .update({ where: { id: reportId }, data: { status: 'ready' } })
      .catch((e) =>
        this.logger.error(`report-append：回滚 ready 也失败：${String(e)}`),
      );
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

  /** 取会话全部消息拼成「老板/米诺」对话文本。 */
  private async loadDialogue(conversationId: string): Promise<string> {
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    return msgs
      .map((m) => `${m.role === 'user' ? '老板' : '米诺'}：${m.content}`)
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

/** 从 meta(jsonb) 读 topic（米诺主动触发时写入）。 */
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
