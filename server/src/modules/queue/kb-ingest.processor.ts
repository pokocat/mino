import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FastgptChatService } from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { KbIngestJobData } from './kb-ingest.types';

/** 要点提取提示词：从一轮对话中抽取值得长期记住的用户事实/决策/关切。 */
const EXTRACTION_SYSTEM =
  '你是一位战略参谋的记忆助手。请从下面这轮对话中，提取值得长期记住的「这位老板」的事实、决策或关切，' +
  '每条一句话，输出 1-3 条要点（用换行分隔，可带序号）。若这轮没有值得长期记住的信息，只输出 NONE，不要输出其它任何内容。';

/**
 * kb.ingest 的实际处理逻辑（与 BullMQ Worker 解耦，便于单测）。
 *
 * 流程：取该轮 user+assistant 消息 → 军师一次非流式轻量提取 →
 *       NONE/失败则跳过；否则逐条 pushText 写入该用户知识库（title 带日期与会话 id）。
 * 抛出异常 = 交由 Worker 重试（attempts 上限 2）。
 */
@Injectable()
export class KbIngestProcessor {
  private readonly logger = new Logger(KbIngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fastgptChat: FastgptChatService,
    private readonly kb: FastgptKbService,
  ) {}

  async process(data: KbIngestJobData): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: data.conversationId },
      select: { id: true, userId: true, fastgptChatId: true },
    });
    if (!conv) {
      this.logger.warn(`kb.ingest：会话 ${data.conversationId} 不存在，跳过`);
      return;
    }

    // 取该轮 user + assistant 消息（按创建序）
    const msgs = await this.prisma.message.findMany({
      where: { id: { in: data.messageIds } },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    if (msgs.length === 0) {
      this.logger.warn(`kb.ingest：会话 ${conv.id} 无可提取消息，跳过`);
      return;
    }

    const dialogue = msgs
      .map((m) => `${m.role === 'user' ? '老板' : '军师'}：${m.content}`)
      .join('\n');

    // 一次非流式轻量提取
    const raw = await this.fastgptChat.complete({
      chatId: conv.fastgptChatId,
      userId: conv.userId,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM },
        { role: 'user', content: dialogue },
      ],
    });

    const points = parsePoints(raw);
    if (points.length === 0) {
      this.logger.log(
        `kb.ingest：会话 ${conv.id} 提取结果为 NONE/空，跳过写入`,
      );
      return;
    }

    // 确保知识库存在（惰性建库并回填 users.kbId），逐条写入
    const kbId = await this.kb.ensureUserKb(conv.userId);
    const date = new Date().toISOString().slice(0, 10);
    const convShort = conv.id.slice(0, 8);
    for (const point of points) {
      await this.kb.pushText(kbId, `记忆·${date}·会话${convShort}`, point);
    }
    this.logger.log(
      `kb.ingest：会话 ${conv.id} 写入 ${points.length} 条要点到知识库 ${kbId}`,
    );
  }
}

/** 解析提取输出为要点数组：NONE/空 → []；否则按行切、去序号、最多 3 条。 */
export function parsePoints(raw: string): string[] {
  const text = (raw ?? '').trim();
  if (!text || /^none$/i.test(text)) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '').trim())
    .filter((line) => line.length > 0 && !/^none$/i.test(line))
    .slice(0, 3);
}
