import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { buildDailyQuestionMessages, parseDailyQuestion } from './task-prompt';
import { shanghaiYmd } from '../streak/streak.util';

/** GET /tasks/today 响应（camelCase 硬契约；无任务返回 null）。 */
export interface TodayTaskView {
  id: string;
  question: string;
  hint: string | null;
  estMinutes: number | null;
  status: TaskStatus;
}

/** 兜底问题（LLM 解析失败时使用，保证卡片永远可用）。 */
const FALLBACK_QUESTION = {
  question: '今天，你最该想通的一件事是什么？',
  hint: '别贪多。挑一件，想透它。',
  estMinutes: 3,
};

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fastgpt: FastgptChatService,
    private readonly kb: FastgptKbService,
  ) {}

  // ============ 查询 / 惰性生成 ============

  /**
   * 今日一问：返回当日有效任务；无则**惰性生成**（新用户当天也能拿到，不必等 cron）。
   * 「有效」= type=daily_q 且 status ∈ pending|started 且未过期（expiresAt > now）。
   */
  async getToday(
    userId: string,
    now: Date = new Date(),
  ): Promise<TodayTaskView | null> {
    const existing = await this.findActiveToday(userId, now);
    if (existing) return toView(existing);

    const created = await this.generateForUser(userId, now);
    return created ? toView(created) : null;
  }

  /**
   * 为某用户生成当日 daily_q（幂等：已有当日 pending/started 未过期任务则直接返回，不重复建）。
   * 问题由 FastgptChatService.complete 生成，参考画像与知识库近期关切。
   */
  async generateForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<TaskRow | null> {
    // 幂等：先查当日有效任务
    const existing = await this.findActiveToday(userId, now);
    if (existing) return existing;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, industry: true, bizNote: true, kbId: true },
    });
    if (!user) return null;

    // 参考知识库近期关切（best-effort：无 kb / 异常 → 空）
    const kbFragments = await this.retrieveConcerns(user.kbId, user.bizNote);

    // 调米诺出题（FASTGPT_MOCK 返回设计稿那条「你最值钱的一张牌是什么？」）
    let parsed = FALLBACK_QUESTION;
    try {
      const raw = await this.fastgpt.complete({
        chatId: randomUUID(),
        userId,
        dailyQuestion: true,
        messages: buildDailyQuestionMessages({
          industry: user.industry,
          bizNote: user.bizNote,
          kbFragments,
        }),
      });
      parsed = parseDailyQuestion(raw) ?? FALLBACK_QUESTION;
    } catch (err) {
      this.logger.warn(`今日一问生成失败，用兜底问题：${String(err)}`);
    }

    const promptSeed = buildPromptSeed(parsed.question, parsed.hint);
    const task = await this.prisma.task.create({
      data: {
        userId,
        type: 'daily_q',
        status: 'pending',
        question: parsed.question,
        hint: parsed.hint,
        promptSeed,
        estMinutes: parsed.estMinutes ?? null,
        expiresAt: shanghaiEndOfDay(now),
      },
      select: TASK_SELECT,
    });
    this.logger.log(`已为用户 ${userId} 生成今日一问 ${task.id}`);
    return task;
  }

  /** 标记任务已推送（cron 推送后回写 pushedAt）。 */
  async markPushed(taskId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.task
      .update({ where: { id: taskId }, data: { pushedAt: now } })
      .catch((e) => this.logger.warn(`markPushed 失败（忽略）：${String(e)}`));
  }

  // ============ 开始聊（复用报告回流同款机制） ============

  /**
   * POST /tasks/:id/start：新建 conversation（开场 assistant 消息 = promptSeed 包装的米诺提问），
   * task 置 started + conversationId，返回 {conversationId}。
   * 幂等：任务已 started 且有 conversationId → 直接返回既有 conversationId。归属校验失败 → 403。
   */
  async start(
    userId: string,
    taskId: string,
  ): Promise<{ conversationId: string }> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, userId },
      select: {
        id: true,
        status: true,
        conversationId: true,
        promptSeed: true,
      },
    });
    if (!task) {
      throw new ForbiddenException({ code: 403, message: '无权访问该任务' });
    }
    // 幂等：已 started 且已建会话 → 直接返回
    if (task.status === 'started' && task.conversationId) {
      return { conversationId: task.conversationId };
    }

    // 新建会话：开场白 = promptSeed（米诺今日一问）
    const conv = await this.prisma.conversation.create({
      data: {
        userId,
        fastgptChatId: randomUUID(),
        lastMessageAt: new Date(),
        messages: { create: { role: 'assistant', content: task.promptSeed } },
      },
      select: { id: true },
    });
    await this.prisma.task.update({
      where: { id: task.id },
      data: { status: 'started', conversationId: conv.id },
    });
    return { conversationId: conv.id };
  }

  // ============ 内部 ============

  /** 查当日有效（pending/started 未过期）daily_q 任务，取最新一条。 */
  private async findActiveToday(
    userId: string,
    now: Date,
  ): Promise<TaskRow | null> {
    return this.prisma.task.findFirst({
      where: {
        userId,
        type: 'daily_q',
        status: { in: ['pending', 'started'] as TaskStatus[] },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: TASK_SELECT,
    });
  }

  /** 检索知识库近期关切（无 kb / 异常 → 空）。query 用生意背景兜底。 */
  private async retrieveConcerns(
    kbId: string | null,
    bizNote: string | null,
  ): Promise<string[]> {
    if (!kbId) return [];
    try {
      const query = bizNote?.trim() || '最近最关切、最放不下的一件事';
      return await this.kb.search(kbId, query, 3);
    } catch (err) {
      this.logger.warn(`今日一问检索关切失败，跳过：${String(err)}`);
      return [];
    }
  }
}

/** 任务行 select 投影。 */
const TASK_SELECT = {
  id: true,
  question: true,
  hint: true,
  estMinutes: true,
  status: true,
  conversationId: true,
} as const;

/** findFirst/create 的返回行类型。 */
export interface TaskRow {
  id: string;
  question: string;
  hint: string | null;
  estMinutes: number | null;
  status: TaskStatus;
  conversationId: string | null;
}

/** 行 → 端上视图（剥离 conversationId 等内部字段）。 */
function toView(t: TaskRow): TodayTaskView {
  return {
    id: t.id,
    question: t.question,
    hint: t.hint,
    estMinutes: t.estMinutes,
    status: t.status,
  };
}

/** 把问题包装成对话开场（米诺口吻，进对话即见）。 */
function buildPromptSeed(question: string, hint: string | null): string {
  const tail = hint ? `\n\n${hint}` : '';
  return `兄弟，今天先想通这一件事——\n\n${question}${tail}\n\n慢慢说，我陪你捋。`;
}

/** Asia/Shanghai 当日 23:59:59 对应的 UTC 时刻（今日一问当日过期）。 */
export function shanghaiEndOfDay(now: Date): Date {
  const { y, m, d } = shanghaiYmd(now);
  return new Date(Date.UTC(y, m, d, 23, 59, 59) - 8 * 3600 * 1000);
}
