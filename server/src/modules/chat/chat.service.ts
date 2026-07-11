import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
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
import { ReportService } from '../report/report.service';
import { WxSecService } from '../safety/wx-sec.service';
import { StreakService } from '../streak/streak.service';
import { SettingsService } from '../settings/settings.service';
import { ReportMarker, ReportMarkerStream } from './report-marker';

/** 一条 suggestions 气泡。 */
export interface Suggestion {
  text: string;
  primary: boolean;
  // generateReport：让米诺写报告；chat：追问气泡；appendCommit：把续写会话织进目标报告
  action: 'generateReport' | 'chat' | 'appendCommit';
  reportType?: ReportType;
  reportId?: string; // action=appendCommit 时携带目标报告 id
}

/** SSE 结构化事件（由 controller 序列化为线协议帧）。 */
export type SseEvent =
  | { event: 'token'; data: { t: string } }
  | { event: 'suggestions'; data: { items: Suggestion[] } }
  | {
      event: 'reportOffer';
      // 米诺主动建了报告则带 reportId；命中每日上限（只发事件不建报告）则无该字段
      data: { reportType: ReportType; topic: string; reportId?: string };
    }
  // R7 内容安全撤回：流式无法逐 token 审，流结束后对 assistant 全文审核命中风险时下发。
  // 端上契约：收到 retract 后把 messageId 对应的那条 assistant 气泡整条替换为撤回文案
  //   （落库内容已同步替换为 RETRACT_TEXT）。retract 出现时本轮不再发 suggestions / reportOffer，
  //   紧随其后即 done。前面已流出的 token 均作废，以 retract 为准。
  | { event: 'retract'; data: { messageId: string } }
  | { event: 'done'; data: { messageId: string; conversationId: string } }
  | { event: 'error'; data: { code: number; message: string } };

/** assistant 输出被内容安全撤回后的占位文案（落库 + 端上气泡替换共用）。 */
export const RETRACT_TEXT = '（这段话米诺收回了）';

/** 用户输入命中内容安全时的 400 文案。 */
export const INPUT_REJECTED_MESSAGE = '这段话我不能收，换个说法';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fastgpt: FastgptChatService,
    private readonly config: ConfigService,
    private readonly kb: FastgptKbService,
    private readonly kbIngest: KbIngestQueue,
    private readonly reports: ReportService,
    private readonly streak: StreakService,
    private readonly safety: WxSecService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * 发消息入口：先审用户输入（R7 接线 a）。命中风险抛 400（不落库、不调 LLM）。
   * 由 controller 在切换 SSE 流之前调用（此时尚未写响应头，异常走全局过滤器返回 JSON 400）。
   */
  async assertInputSafe(openid: string, content: string): Promise<void> {
    const verdict = await this.safety.checkText(openid, content, 3);
    if (verdict.risky) {
      this.logger.warn(
        `用户输入命中内容安全（label=${verdict.label}），已拦截`,
      );
      throw new BadRequestException({
        code: 400,
        message: INPUT_REJECTED_MESSAGE,
      });
    }
  }

  /**
   * 新建会话：生成 fastgptChatId（uuid），并同步落一条米诺开场白（assistant）——
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
          create: {
            role: 'assistant',
            content: this.settings.getString('mino_opening'),
          },
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
   * 流程：存用户消息 → 组装历史 → 调米诺流 → 边收边发 token（拦截 report_ready 标记）
   * → 存 assistant 全文（标记已剥离）→ 更新 lastMessageAt/title → suggestions →（若有）reportOffer → done。
   */
  async *streamReply(
    conv: Conversation,
    content: string,
    openid = '',
  ): AsyncIterable<SseEvent> {
    const conversationId = conv.id;

    // 1) 存用户消息（保留 id 供 kb.ingest 定位该轮）
    const userMsg = await this.prisma.message.create({
      data: { conversationId, role: 'user', content },
    });

    // 1.5) streak 结算（R6，异步旁路）：每日首条消息 +1，当日重复不变；
    //      settleOnMessage 内部已吞异常，此处 void 不阻塞、失败绝不影响对话。
    void this.streak.settleOnMessage(conv.userId);

    // 2) 组装上下文：openai 直连模式先注入米诺 system prompt（fastgpt 模式由 FastGPT 应用内置，注入会重复）
    //    → 本条消息检索用户知识库（战略档案摘录）附加 system → 再接会话历史
    const messages: ChatMessage[] = [];
    if ((this.config.get<string>('llm.provider') ?? 'fastgpt') === 'openai') {
      messages.push({
        role: 'system',
        content: this.settings.getSystemPrompt(),
      });
    }
    const kbContext = await this.retrieveKbContext(conv.userId, content);
    if (kbContext) {
      messages.push({ role: 'system', content: kbContext });
    }
    const history = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    // 「跟米诺聊这份报告」新建的会话：首轮把源报告全文作为附加 system 上下文拼入
    // （与 kb 检索注入同源；只在首个用户回合注入一次，不落 messages、不下发端上）
    const userTurns = history.filter((m) => m.role === 'user').length;
    if (conv.seedReportId && userTurns <= 1) {
      const seed = await this.loadSeedReportContext(conv.seedReportId);
      if (seed) messages.push({ role: 'system', content: seed });
    }
    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
    }

    // 3) 调米诺流，边收边发；标记拦截器保证 report_ready 不泄漏（含跨 chunk 拆分）
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
      this.logger.error(`米诺流式失败：${String(err)}`);
      yield {
        event: 'error',
        data: { code: 500, message: '米诺正在闭关，稍后再试' },
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

    // 4.5) LLM 输出审核（R7 接线 b）：流式无法逐 token 审，流结束后对 assistant 全文审核。
    //   命中风险 → 落库内容替换为撤回文案 → 发 retract → 直接 done（跳过 suggestions/reportOffer/kb.ingest，
    //   不把风险内容回喂知识库、不据其建报告）。
    const outVerdict = await this.safety.checkText(openid, fullText, 3);
    if (outVerdict.risky) {
      this.logger.warn(
        `米诺输出命中内容安全（label=${outVerdict.label}），撤回消息 ${assistant.id}`,
      );
      await this.prisma.message.update({
        where: { id: assistant.id },
        data: { content: RETRACT_TEXT },
      });
      yield { event: 'retract', data: { messageId: assistant.id } };
      yield {
        event: 'done',
        data: { messageId: assistant.id, conversationId },
      };
      return;
    }

    // 5) suggestions（done 前必发）：primary 项（写报告 / 续写会话则换 appendCommit）+ 追问两条。
    //    写报告 primary 受门控：米诺本轮发了 report_ready 标记，或对话已达回退轮次阈值，才提供。
    yield {
      event: 'suggestions',
      data: {
        items: await this.buildSuggestions(conv, content, {
          markersFired: markers.length > 0,
          userTurns,
        }),
      },
    };

    // 6) reportOffer（§8.4 米诺主动触发）：拦到标记 → origin=agent 建报告并入队；
    //    每用户每日 origin=agent 上限 1 份，超限只发事件不建报告（无 reportId 字段）。
    //    续写会话（appendReportId 非空）标记仍被拦截剥离，但不建 origin=agent 报告、不发 reportOffer。
    if (markers.length > 0 && !conv.appendReportId) {
      const first = markers[0];
      let reportId: string | undefined;
      try {
        const created = await this.reports.createAgentReport(
          conv.userId,
          conversationId,
          first.type,
          first.topic,
        );
        reportId = created?.reportId;
      } catch (err) {
        // 米诺主动建报告失败绝不打断对话，仅告警后照常发事件（无 reportId）
        this.logger.warn(`米诺主动建报告失败（已忽略）：${String(err)}`);
      }
      yield {
        event: 'reportOffer',
        data: {
          reportType: first.type,
          topic: first.topic,
          ...(reportId ? { reportId } : {}),
        },
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
   * 加载源报告全文，拼成首轮附加 system 上下文（供「跟米诺聊这份报告」回流）。
   * 报告不存在 / 无正文 / 异常 → null（静默跳过）。此上下文不落 messages、不下发端上。
   */
  private async loadSeedReportContext(
    reportId: string,
  ): Promise<string | null> {
    try {
      const report = await this.prisma.report.findUnique({
        where: { id: reportId },
        select: { title: true, bodyMd: true },
      });
      if (!report?.bodyMd) return null;
      return `【这份报告的全文，供你回答时参考（老板正想跟你聊它）】\n《${report.title}》\n${report.bodyMd}`;
    } catch (err) {
      this.logger.warn(`加载源报告上下文失败，跳过：${String(err)}`);
      return null;
    }
  }

  /**
   * suggestions 规则：primary 项（可能没有）+ 两条追问。
   * - 续写会话（appendReportId 非空）：primary 恒为「把这段织进报告」（action=appendCommit，携带目标报告 id）。
   * - 普通会话：写报告 primary 受门控——米诺本轮发了 report_ready 标记（markersFired）
   *   或对话已达回退轮次阈值（userTurns >= 配置阈值）才提供「让米诺写报告」；否则不出 primary，只回追问。
   * - 追问两条：mock 时用固定两条；真实模式调 complete() 生成（4 秒超时/解析失败 → 空数组）。
   */
  private async buildSuggestions(
    conv: Conversation,
    content: string,
    opts: { markersFired: boolean; userTurns: number },
  ): Promise<Suggestion[]> {
    const followups = await this.buildFollowups(conv);
    if (conv.appendReportId) {
      const primary: Suggestion = {
        text: '好，把这段织进报告',
        primary: true,
        action: 'appendCommit',
        reportId: conv.appendReportId,
      };
      return [primary, ...followups];
    }
    const reportReady =
      opts.markersFired || opts.userTurns >= this.settings.getReportMinTurns();
    if (!reportReady) {
      return followups;
    }
    const primary: Suggestion = {
      text: '好，帮我写一份《…》报告',
      primary: true,
      action: 'generateReport',
      reportType: inferReportType(content),
    };
    return [primary, ...followups];
  }

  /**
   * 追问两条（action=chat）：mock 返回固定两条；真实模式以米诺视角调 complete() 生成
   * 「老板此刻最想追问的话」。4 秒超时（Promise.race）或解析失败 → 空数组回退，错误只记日志。
   */
  private async buildFollowups(conv: Conversation): Promise<Suggestion[]> {
    if (this.config.get<boolean>('fastgpt.mock')) {
      return [
        { text: '那本周我该先动哪一件？', primary: false, action: 'chat' },
        { text: '帮我把这事再拆细一点', primary: false, action: 'chat' },
      ];
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const dialogue = await this.loadRecentDialogue(conv.id, 3);
      if (!dialogue) return [];
      const questions = await Promise.race([
        this.completeFollowups(conv, dialogue).catch(() => [] as string[]),
        new Promise<string[]>((resolve) => {
          timer = setTimeout(() => resolve([]), FOLLOWUP_TIMEOUT_MS);
        }),
      ]);
      return questions
        .slice(0, 2)
        .map((text) => ({ text, primary: false, action: 'chat' as const }));
    } catch (err) {
      this.logger.warn(`追问 suggestions 生成失败，回退空数组：${String(err)}`);
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 调 complete() 生成两条追问并解析出字符串数组（失败/异常抛出，由调用方兜底为空）。 */
  private async completeFollowups(
    conv: Conversation,
    dialogue: string,
  ): Promise<string[]> {
    const raw = await this.fastgpt.complete({
      chatId: conv.fastgptChatId,
      userId: conv.userId,
      messages: [
        { role: 'system', content: this.settings.getString('followup_prompt') },
        { role: 'user', content: dialogue },
      ],
    });
    return parseFollowups(raw);
  }

  /** 取最近至多 rounds 轮对话（每条截断 200 字），拼成「老板/米诺」文本供追问提示词使用。 */
  private async loadRecentDialogue(
    conversationId: string,
    rounds: number,
  ): Promise<string> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: rounds * 2, // 一轮≈一问一答
      select: { role: true, content: true },
    });
    return rows
      .reverse()
      .map(
        (m) =>
          `${m.role === 'user' ? '老板' : '米诺'}：${m.content.slice(0, 200)}`,
      )
      .join('\n');
  }
}

/** 追问 suggestions 生成的 4 秒超时。 */
const FOLLOWUP_TIMEOUT_MS = 4000;

/** 解析 complete() 返回的追问 JSON：取 questions 数组中至多 2 条非空字符串；失败返回空数组。 */
function parseFollowups(raw: string): string[] {
  const text = (raw ?? '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      questions?: unknown;
    };
    if (!Array.isArray(obj.questions)) return [];
    return obj.questions
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 2);
  } catch {
    return [];
  }
}

/** 报告类型启发式：复盘→review；决定/要不要→decision；我为什么/当年→resume；否则 strategy。 */
export function inferReportType(content: string): ReportType {
  if (/复盘/.test(content)) return 'review';
  if (/决定|要不要/.test(content)) return 'decision';
  if (/我为什么|当年/.test(content)) return 'resume';
  return 'strategy';
}
