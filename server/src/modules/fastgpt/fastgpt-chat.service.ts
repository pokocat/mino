import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReportType } from '@prisma/client';

/** 传给 FastGPT 的单条消息（OpenAI 兼容）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** streamChat 入参：messages 与 prompt 二选一（prompt 会包成单条 user 消息）。 */
export interface StreamChatParams {
  chatId: string;
  userId: string;
  messages?: ChatMessage[];
  prompt?: string;
  /**
   * 仅 FASTGPT_MOCK：给定报告类型时 complete() 返回该类型的固定报告 JSON（供 M4 报告链路联调/测试）；
   * 真实模式忽略此字段（报告结构由 messages 中的提示词决定）。
   */
  reportType?: ReportType;
  /**
   * 仅 FASTGPT_MOCK：置 true 时 complete() 返回「今日一问」固定 JSON（设计稿那条），供 M5 回访链路联调/测试；
   * 真实模式忽略此字段（问题由 messages 中的提示词决定）。
   */
  dailyQuestion?: boolean;
  /**
   * 仅 FASTGPT_MOCK：报告续写（append）分支——给定原正文时 complete() 返回「原文 + 一段可辨识的
   * 续写新叙事」的修订版报告 JSON，供 #4 续写链路联调/测试；真实模式忽略此字段（修订版由 messages 提示词决定）。
   */
  appendOriginalBody?: string;
}

/**
 * 军师对话服务：以 OpenAI 兼容格式调 FastGPT，返回**增量文本**的 AsyncIterable。
 * FASTGPT_MOCK=true 时不触外部，吐固定军师风格假流（含跨 chunk 拆分的 report_ready 标记）。
 */
@Injectable()
export class FastgptChatService {
  private readonly logger = new Logger(FastgptChatService.name);

  constructor(private readonly config: ConfigService) {}

  /** 当前 LLM 供应商（fastgpt 默认 | openai 直连）。 */
  private get provider(): string {
    return this.config.get<string>('llm.provider') ?? 'fastgpt';
  }

  /**
   * 构造上游请求（供应商感知）。
   * - openai：POST {LLM_BASE_URL}/chat/completions，body 带 model，无 chatId/detail；
   * - fastgpt（默认）：POST {FASTGPT_BASE_URL}/api/v1/chat/completions，body 带 chatId/detail。
   * 两者响应均为 OpenAI 兼容（choices[].delta.content / choices[].message.content），下游解析共用。
   */
  private buildUpstream(
    chatId: string,
    messages: ChatMessage[],
    stream: boolean,
  ): { url: string; headers: Record<string, string>; body: string } {
    if (this.provider === 'openai') {
      const baseUrl = (this.config.get<string>('llm.baseUrl') ?? '').replace(
        /\/+$/,
        '',
      );
      const apiKey = this.config.get<string>('llm.apiKey') ?? '';
      const model = this.config.get<string>('llm.model') ?? '';
      return {
        url: `${baseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, stream, messages }),
      };
    }
    const baseUrl = (this.config.get<string>('fastgpt.baseUrl') ?? '').replace(
      /\/+$/,
      '',
    );
    const appKey = this.config.get<string>('fastgpt.appKey') ?? '';
    return {
      url: `${baseUrl}/api/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appKey}`,
      },
      body: JSON.stringify({ chatId, stream, detail: false, messages }),
    };
  }

  /** 返回增量文本流（AsyncIterable<string>），上游 SSE 已解析、[DONE] 已处理。 */
  streamChat(params: StreamChatParams): AsyncIterable<string> {
    const messages = this.normalizeMessages(params);
    if (this.config.get<boolean>('fastgpt.mock')) {
      return this.mockStream();
    }
    return this.realStream(params.chatId, messages);
  }

  /**
   * 非流式一次性补全（M3 用于要点提取等轻量任务）。返回完整文本。
   * POST /api/v1/chat/completions（stream:false）；FASTGPT_MOCK 时返回固定要点串。
   */
  async complete(params: StreamChatParams): Promise<string> {
    const messages = this.normalizeMessages(params);
    if (this.config.get<boolean>('fastgpt.mock')) {
      // 报告续写：把原文追织一段可辨识的新叙事，返回修订版 JSON（title 交由 Worker 用原标题）；
      // 报告链路：按类型返回固定报告 JSON；今日一问：返回固定问题 JSON；
      // 其余（如 kb.ingest 要点提取 / 追问 suggestions）返回固定要点串
      if (typeof params.appendOriginalBody === 'string') {
        return buildMockAppendReport(params.appendOriginalBody);
      }
      if (params.reportType) return MOCK_REPORTS[params.reportType];
      if (params.dailyQuestion) return MOCK_DAILY_QUESTION;
      return MOCK_EXTRACTION;
    }

    const upstream = this.buildUpstream(params.chatId, messages, false);
    const res = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: upstream.body,
    });
    if (!res.ok) {
      this.logger.error(`FastGPT complete 异常：HTTP ${res.status}`);
      throw new Error(`FastGPT upstream error: ${res.status}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json?.choices?.[0]?.message?.content ?? '';
  }

  /** messages 优先；否则用 prompt 包一条 user 消息。 */
  private normalizeMessages(params: StreamChatParams): ChatMessage[] {
    if (params.messages && params.messages.length > 0) {
      return params.messages;
    }
    return [{ role: 'user', content: params.prompt ?? '' }];
  }

  /** 真实模式：POST /api/v1/chat/completions（stream:true），解析上游 SSE。 */
  private async *realStream(
    chatId: string,
    messages: ChatMessage[],
  ): AsyncIterable<string> {
    const upstream = this.buildUpstream(chatId, messages, true);
    const res = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: upstream.body,
    });

    if (!res.ok || !res.body) {
      this.logger.error(`FastGPT 响应异常：HTTP ${res.status}`);
      throw new Error(`FastGPT upstream error: ${res.status}`);
    }

    const decoder = new TextDecoder();
    let sseBuffer = '';
    // Web ReadableStream 异步迭代读取
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      sseBuffer += decoder.decode(chunk, { stream: true });
      // 上游帧以空行分隔，逐帧解析
      let sepIndex: number;
      while ((sepIndex = sseBuffer.indexOf('\n\n')) !== -1) {
        const frame = sseBuffer.slice(0, sepIndex);
        sseBuffer = sseBuffer.slice(sepIndex + 2);
        const delta = this.parseSseFrame(frame);
        if (delta === DONE) return;
        if (delta) yield delta;
      }
    }
  }

  /** 解析一帧上游 SSE，返回增量文本；遇 [DONE] 返回哨兵。 */
  private parseSseFrame(frame: string): string | typeof DONE | null {
    let delta = '';
    for (const line of frame.split('\n')) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return DONE;
      if (!payload) continue;
      try {
        const json = JSON.parse(payload);
        const piece = json?.choices?.[0]?.delta?.content;
        if (typeof piece === 'string') delta += piece;
      } catch {
        // 非 JSON 的心跳/注释行忽略
      }
    }
    return delta || null;
  }

  /**
   * Mock 流：按 40–80ms/片段吐固定军师回复。
   * 末尾的 report_ready 标记被**故意拆在两个片段**里，用于联调与拦截器测试。
   */
  private async *mockStream(): AsyncIterable<string> {
    const fragments = buildMockFragments();
    for (const frag of fragments) {
      await delay(40 + Math.floor(Math.random() * 40));
      yield frag;
    }
  }
}

/** [DONE] 哨兵。 */
const DONE = Symbol('done');

/** Mock 模式下要点提取的固定返回（两条要点，供 kb.ingest 联调/测试）。 */
const MOCK_EXTRACTION =
  '1. 这位老板做宠物殡葬生意\n2. 当前最大关切是获客渠道断裂、怕客源断掉';

/** Mock 续写织入的可辨识新段落标识串（测试/联调据此判定「已织入」）。 */
export const MOCK_APPEND_MARK = '（这是续写织入的新段落）';

/**
 * Mock 模式下续写（append）的固定返回：把原正文原样保留、自然织入一段带可辨识标识的新叙事，
 * 返回修订版 {bodyMd, annotation, wordCount}（title 留空，Worker 用原标题不变）。
 */
function buildMockAppendReport(originalBodyMd: string): string {
  const woven =
    `${originalBodyMd.trimEnd()}\n\n` +
    `${MOCK_APPEND_MARK}老板后来又补了一手：把最要紧的那条渠道单独派了个人盯，风险敞口一下小了半截。`;
  return JSON.stringify({
    title: '',
    bodyMd: woven,
    annotation: '续上这一手，根据地又稳了三分。',
    wordCount: 0,
  });
}

/**
 * Mock 模式下「今日一问」的固定返回（即设计稿那条），供 M5 回访链路联调/测试。
 * 结构与真实提示词契约一致：{question, hint, estMinutes}。
 */
const MOCK_DAILY_QUESTION = JSON.stringify({
  question: '你最值钱的一张牌是什么？',
  hint: '别急着答。先想想——离了它，你的生意还剩几成。',
  estMinutes: 3,
});

/**
 * Mock 模式下四类报告工作流的固定 JSON 返回（符合受限 Markdown 规范，供 M4 报告链路联调/测试）。
 * strategy 那份即设计稿《战略分析》全文「你的护城河：把信任做成根据地」。
 */
const MOCK_REPORTS: Record<ReportType, string> = {
  strategy: JSON.stringify({
    title: '你的护城河：把信任做成根据地',
    bodyMd:
      '## 主要矛盾\n\n你想扩张，但你真正的家底——客户信任——是慢功夫攒出来的，快不得。**扩张的速度 vs 信任的沉淀速度**，这是当前最主要的矛盾。\n\n## 定位\n\n不做「更多」，做「更被信任」。你的根据地是老客户的口碑，别人拿钱砸半年也砸不动。\n\n## 三步走\n\n1. **守。**先把现有老客户的复购和转介绍做到极致，别分心。\n2. **攒。**把「凭什么被信任」拆成可复制的动作，写成手册。\n3. **扩。**手册跑通后再开第二家，让信任可迁移，而非从零再来。',
    annotation: '别急着摊大。风来了先把帆张稳，扩张是水到渠成的事。',
    wordCount: 0,
  }),
  resume: JSON.stringify({
    title: '起势：我为什么下海',
    bodyMd:
      '二〇一七年冬天，牧之在一家国企干到第七个年头，忽然觉得日子像一潭静水。\n\n他辞职那天没跟任何人商量。不是冲动——是攒了太久的一口气。他想验证一件事：离开体系的庇护，自己那点本事还值不值钱。\n\n头半年很苦。可他发现，真正让客户留下来的，从来不是价格，是那种「交给他放心」的踏实感。这后来成了他整盘生意的底色。',
    annotation:
      '你说是赌一口气，其实是你早就看清了自己的牌。下海不是冲动，是时势到了。',
    wordCount: 0,
  }),
  review: JSON.stringify({
    title: '留住回头客的复盘',
    bodyMd:
      '## 打得怎么样\n\n这一仗你把新客拉进来了，声量也起来了。但**回头率没跟上**，等于前面攻下的阵地没守住。\n\n## 关键失手\n\n只顾着往前冲，忘了给老客一个「再来一次」的由头。热闹是别人的，复购才是你的。\n\n## 下一仗\n\n1. **盘。**把来过三次以上的老客拉一张名单。\n2. **勾。**给他们一个只有熟客才有的由头再进店。\n3. **问。**每天花十分钟亲自问一句「今天哪儿不满意」。',
    annotation: '仗要一场一场打穿。别摊开五个战场，先把回头客这块根据地站稳。',
    wordCount: 0,
  }),
  decision: JSON.stringify({
    title: '要不要接这单大客户',
    bodyMd:
      '## 要决的事\n\n一个大客户抛来长期订单，量大、能撑营收，但要你几乎押上全部产能。接，还是不接。\n\n## 两条路\n\n1. **接。**营收立刻上台阶，但你被一家攥住命门，议价权拱手让人。\n2. **不接。**保住盘子的均衡与主动，增长慢一些，睡得踏实。\n\n## 军师建议\n\n若这单让单一客户占比超过四成，**宁可慢，不可险**。先谈一个能退的短约试水，别一次把身家压上去。',
    annotation: '把命门交给别人换来的增长，不是你的势，是你的债。',
    wordCount: 0,
  }),
};

/** 40–80ms 延迟。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 构造 mock 片段：正文分片 + 跨 chunk 拆开的 report_ready 标记。 */
function buildMockFragments(): string[] {
  const body = [
    '兄弟，我听明白了。',
    '你现在的主要矛盾不是没客人，',
    '是回头客留不住——这才是要打的歼灭战。\n\n',
    '先别急着扩张。这周把兵力集中在老客身上：',
    '一是把最近来过三次的客人拉个名单，',
    '二是给他们一个只有熟客才有的由头再进店，',
    '三是每天花十分钟亲自问一句「今天哪儿不满意」。\n\n',
    '顺势的时候就该猛攻一把打穿。',
    '等这条根据地站稳了，我再跟你聊怎么往外扩。',
  ];
  // 标记故意从中间劈开成两片，模拟上游分包边界不齐
  const markerHead = '\n<mino:report';
  const markerTail = '_ready type="review" topic="留住回头客的复盘"/>';
  return [...body, markerHead, markerTail];
}
