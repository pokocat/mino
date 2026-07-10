import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Conversation, ReportType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChatMessage,
  FastgptChatService,
} from '../fastgpt/fastgpt-chat.service';
import { FastgptKbService } from '../fastgpt/fastgpt-kb.service';
import { KbIngestQueue } from '../queue/kb-ingest.queue';
import { JUNSHI_OPENING } from './junshi-constants';
import { ReportMarker, ReportMarkerStream } from './report-marker';

/** 一条 suggestions 气泡。 */
export interface Suggestion {
  text: string;
  primary: boolean;
  action: 'generateReport' | 'chat';
  reportType?: ReportType;
}

/** SSE 结构化事件（由 controller 序列化为线协议帧）。 */
export type SseEvent =
  | { event: 'token'; data: { t: string } }
  | { event: 'suggestions'; data: { items: Suggestion[] } }
  | { event: 'reportOffer'; data: { reportType: ReportType; topic: string } }
  | { event: 'done'; data: { messageId: string; conversationId: string } }
  | { event: 'error'; data: { code: number; message: string } };

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fastgpt: FastgptChatService,
    private readonly config: ConfigService,
    private readonly kb: FastgptKbService,
    private readonly kbIngest: KbIngestQueue,
  ) {}

  /**
   * 新建会话：生成 fastgptChatId（uuid），并同步落一条军师开场白（assistant）——
   * 端上建会话后立即 GET messages 即可拿到开场白（双端契约）；
   * 该条随会话历史一并作为 assistant 上下文喂给 FastGPT。
   */
  async createConversation(
    userId: string,
  ): Promise<{ conversationId: string; fastgptChatId: string }> {
    const conv = await this.prisma.conversation.create({
      data: {
        userId,
        fastgptChatId: randomUUID(),
        lastMessageAt: new Date(),
        messages: {
          create: { role: 'assistant', content: JUNSHI_OPENING },
        },
      },
    });
    return { conversationId: conv.id, fastgptChatId: conv.fastgptChatId };
  }

  /** 会话列表（对话页恢复上下文用）。 */
  async listConversations(userId: string, limit: number) {
    const rows = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { id: true, title: true, lastMessageAt: true },
    });
    return rows;
  }

  /** 历史消息（校验归属）。 */
  async getMessages(userId: string, conversationId: string) {
    await this.getOwnedConversation(userId, conversationId);
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return rows;
  }

  /** 取归属于该用户的会话，否则抛 403。 */
  async getOwnedConversation(
    userId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conv) {
      throw new ForbiddenException({ code: 403, message: '无权访问该会话' });
    }
    return conv;
  }

  /**
   * 发消息 → 流式回复的编排（产出结构化 SSE 事件，controller 负责落线）。
   * 流程：存用户消息 → 组装历史 → 调军师流 → 边收边发 token（拦截 report_ready 标记）
   * → 存 assistant 全文（标记已剥离）→ 更新 lastMessageAt/title → suggestions →（若有）reportOffer → done。
   */
  async *streamReply(
    conv: Conversation,
    content: string,
  ): AsyncIterable<SseEvent> {
    const conversationId = conv.id;

    // 1) 存用户消息（保留 id 供 kb.ingest 定位该轮）
    const userMsg = await this.prisma.message.create({
      data: { conversationId, role: 'user', content },
    });

    // 2) 组装上下文：本条消息检索用户知识库（战略档案摘录）→ 附加 system；再接会话历史
    const messages: ChatMessage[] = [];
    const kbContext = await this.retrieveKbContext(conv.userId, content);
    if (kbContext) {
      messages.push({ role: 'system', content: kbContext });
    }
    const history = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
    }

    // 3) 调军师流，边收边发；标记拦截器保证 report_ready 不泄漏（含跨 chunk 拆分）
    const markerStream = new ReportMarkerStream();
    const markers: ReportMarker[] = [];
    let fullText = '';
    try {
      const stream = this.fastgpt.streamChat({
        chatId: conv.fastgptChatId,
        userId: conv.userId,
        messages,
      });
      for await (const delta of stream) {
        const { text, markers: found } = markerStream.push(delta);
        markers.push(...found);
        if (text) {
          fullText += text;
          yield { event: 'token', data: { t: text } };
        }
      }
      const tail = markerStream.flush();
      markers.push(...tail.markers);
      if (tail.text) {
        fullText += tail.text;
        yield { event: 'token', data: { t: tail.text } };
      }
    } catch (err) {
      this.logger.error(`军师流式失败：${String(err)}`);
      yield {
        event: 'error',
        data: { code: 500, message: '军师正在闭关，稍后再试' },
      };
      return;
    }

    // 4) 存 assistant 全文（标记已剥离）+ 更新 lastMessageAt / 临时标题
    const assistant = await this.prisma.message.create({
      data: { conversationId, role: 'assistant', content: fullText },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        ...(conv.title ? {} : { title: content.slice(0, 20) }),
      },
    });

    // 5) suggestions（done 前必发，可空数组之外本期固定注入 primary 项）
    yield {
      event: 'suggestions',
      data: { items: this.buildSuggestions(content) },
    };

    // 6) reportOffer：拦到标记才发（只发事件，不建报告 —— 报告生成属 M3+）
    if (markers.length > 0) {
      const first = markers[0];
      yield {
        event: 'reportOffer',
        data: { reportType: first.type, topic: first.topic },
      };
    }

    // 7) 异步入队 kb.ingest（记忆旁路：入队失败仅告警，绝不影响本轮对话）
    // 双重兜底：KbIngestQueue.enqueue 自身已吞异常，这里再包一层，确保任何情况都不打断本轮 done。
    try {
      await this.kbIngest.enqueue({
        conversationId,
        messageIds: [userMsg.id, assistant.id],
      });
    } catch (err) {
      this.logger.warn(
        `kb.ingest 入队异常（已忽略，不影响对话）：${String(err)}`,
      );
    }

    // 8) done
    yield {
      event: 'done',
      data: { messageId: assistant.id, conversationId },
    };
  }

  /**
   * 用本条消息检索用户知识库，拼成附加 system 上下文（战略档案摘录，top N）。
   * 无 kb / 无命中 / 检索异常 → 返回 null（静默跳过）；此上下文不落 messages 表、不下发端上。
   */
  private async retrieveKbContext(
    userId: string,
    query: string,
  ): Promise<string | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { kbId: true },
      });
      if (!user?.kbId) return null;
      const fragments = await this.kb.search(user.kbId, query, 3);
      if (fragments.length === 0) return null;
      const lines = fragments.map((f) => `- ${f}`).join('\n');
      return `【你对这位老板的了解（战略档案摘录）】\n${lines}`;
    } catch (err) {
      this.logger.warn(`知识库检索失败，跳过上下文注入：${String(err)}`);
      return null;
    }
  }

  /**
   * 本期 suggestions 规则：固定注入一条 primary「让军师写报告」（reportType 走启发式）；
   * FASTGPT_MOCK 时附两条固定追问；真实模式两条追问暂缺省（M3/M4 再优化，接口已留）。
   */
  private buildSuggestions(content: string): Suggestion[] {
    const items: Suggestion[] = [
      {
        text: '好，帮我写一份《…》报告',
        primary: true,
        action: 'generateReport',
        reportType: inferReportType(content),
      },
    ];
    if (this.config.get<boolean>('fastgpt.mock')) {
      items.push(
        { text: '那本周我该先动哪一件？', primary: false, action: 'chat' },
        { text: '帮我把这事再拆细一点', primary: false, action: 'chat' },
      );
    }
    return items;
  }
}

/** 报告类型启发式：复盘→review；决定/要不要→decision；我为什么/当年→resume；否则 strategy。 */
export function inferReportType(content: string): ReportType {
  if (/复盘/.test(content)) return 'review';
  if (/决定|要不要/.test(content)) return 'decision';
  if (/我为什么|当年/.test(content)) return 'resume';
  return 'strategy';
}
