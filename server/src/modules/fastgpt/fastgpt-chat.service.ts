import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
}

/**
 * 军师对话服务：以 OpenAI 兼容格式调 FastGPT，返回**增量文本**的 AsyncIterable。
 * FASTGPT_MOCK=true 时不触外部，吐固定军师风格假流（含跨 chunk 拆分的 report_ready 标记）。
 */
@Injectable()
export class FastgptChatService {
  private readonly logger = new Logger(FastgptChatService.name);

  constructor(private readonly config: ConfigService) {}

  /** 返回增量文本流（AsyncIterable<string>），上游 SSE 已解析、[DONE] 已处理。 */
  streamChat(params: StreamChatParams): AsyncIterable<string> {
    const messages = this.normalizeMessages(params);
    if (this.config.get<boolean>('fastgpt.mock')) {
      return this.mockStream();
    }
    return this.realStream(params.chatId, messages);
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
    const baseUrl = (this.config.get<string>('fastgpt.baseUrl') ?? '').replace(
      /\/+$/,
      '',
    );
    const appKey = this.config.get<string>('fastgpt.appKey') ?? '';
    const url = `${baseUrl}/api/v1/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appKey}`,
      },
      body: JSON.stringify({
        chatId, // FastGPT 侧据此维护会话上下文
        stream: true,
        detail: false,
        messages,
      }),
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
