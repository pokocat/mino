// SSE 流式请求封装（R1 核心）。
// 真实模式：wx.request enableChunked + onChunkReceived + UTF-8 增量解码 + `\n\n` 切帧。
// MOCK 模式：不发请求，用 setTimeout 按片段吐固定军师回复 + suggestions + done。
// 底层纯逻辑见 utils/sse-decode.ts（可在 Node 单测）。标识符英文、注释中文。

import { MOCK_API, config } from './config';
import { getToken } from './request';
import { Utf8IncrementalDecoder, SseFrameSplitter, SseFrame } from './sse-decode';
import type { ApiError, SuggestionItem, ReportType } from './api';

// 派发给上层的语义事件（token / suggestions / reportOffer；done 与 error 走独立回调）
export type SseEvent =
  | { type: 'token'; text: string }
  | { type: 'suggestions'; items: SuggestionItem[] }
  | { type: 'reportOffer'; reportType: ReportType; topic: string };

export interface SseDone {
  messageId: string;
  conversationId: string;
}

export interface SsePostOptions {
  url: string; // 相对路径，如 /conversations/:id/messages
  data: Record<string, unknown>;
  onEvent: (e: SseEvent) => void; // token / suggestions / reportOffer
  onDone?: (done: SseDone) => void; // done 事件
  onError?: (err: ApiError) => void; // error 事件或网络失败
}

// 可 abort 的任务句柄（真实 RequestTask 与 mock 均满足）
export interface SseTask {
  abort(): void;
}

/** 发起一次流式对话请求 */
export function ssePost(opts: SsePostOptions): SseTask {
  if (MOCK_API) {
    return mockSsePost(opts);
  }

  const decoder = new Utf8IncrementalDecoder();
  const splitter = new SseFrameSplitter();

  const header: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) header.Authorization = `Bearer ${token}`;

  const task = wx.request({
    url: `${config.baseUrl}${opts.url}`,
    method: 'POST',
    header,
    data: opts.data,
    enableChunked: true, // 关键：分块接收（R1）
    responseType: 'arraybuffer',
    fail: (e) => {
      opts.onError?.({ code: 'NETWORK', message: e.errMsg || '网络异常' });
    },
  });

  // 分块到达：UTF-8 安全解码 → 切帧 → 逐帧派发
  task.onChunkReceived((res) => {
    const bytes = new Uint8Array(res.data as ArrayBuffer);
    const text = decoder.decode(bytes);
    if (!text) return;
    const frames = splitter.push(text);
    for (const frame of frames) {
      dispatch(frame, opts);
    }
  });

  return task;
}

/** 单帧 → 语义事件派发（data 为 JSON 字符串）*/
function dispatch(frame: SseFrame, opts: SsePostOptions): void {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(frame.data) as Record<string, unknown>;
  } catch {
    return; // 非法 JSON：跳过该帧，不影响后续
  }
  switch (frame.event) {
    case 'token':
      opts.onEvent({ type: 'token', text: String(payload.t ?? '') });
      break;
    case 'suggestions':
      opts.onEvent({
        type: 'suggestions',
        items: (payload.items as SuggestionItem[]) || [],
      });
      break;
    case 'reportOffer':
      opts.onEvent({
        type: 'reportOffer',
        reportType: (payload.reportType as ReportType) || 'strategy',
        topic: String(payload.topic ?? ''),
      });
      break;
    case 'done':
      opts.onDone?.({
        messageId: String(payload.messageId ?? ''),
        conversationId: String(payload.conversationId ?? ''),
      });
      break;
    case 'error':
      opts.onError?.({
        code: String(payload.code ?? 500),
        message: String(payload.message ?? '军师正在闭关'),
      });
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// MOCK 实现：按片段吐一段固定军师回复，事件结构与真实协议一致
// ---------------------------------------------------------------------------
function mockSsePost(opts: SsePostOptions): SseTask {
  // 固定回复：按标点切成若干片段，模拟逐 token 流入
  const reply =
    '这就是你的根据地——别人拿钱砸半年也砸不动的东西。' +
    '信任攒起来慢，但一旦成了，就是你最硬的一张牌。' +
    '要不要我把这段整理成一份《战略分析》报告？';
  const chunks = reply.match(/[^，。—…]+[，。—…]?/g) || [reply];

  const timers: number[] = [];
  let aborted = false;
  const step = 90; // 每片段间隔（ms），模拟流式节奏

  chunks.forEach((piece, i) => {
    const id = setTimeout(() => {
      if (aborted) return;
      opts.onEvent({ type: 'token', text: piece });
    }, step * (i + 1)) as unknown as number;
    timers.push(id);
  });

  const after = step * (chunks.length + 1);

  // reportOffer（军师主动提议写报告，前端插系统提示行）
  timers.push(
    setTimeout(() => {
      if (aborted) return;
      opts.onEvent({
        type: 'reportOffer',
        reportType: 'strategy',
        topic: '最值钱的牌',
      });
    }, after) as unknown as number
  );

  // suggestions（done 前必有，可空）
  timers.push(
    setTimeout(() => {
      if (aborted) return;
      opts.onEvent({
        type: 'suggestions',
        items: [
          {
            text: '好，帮我写一份《战略分析》报告',
            primary: true,
            action: 'generateReport',
            reportType: 'strategy',
          },
          { text: '这张牌别人半年能抄走吗？', action: 'chat' },
          { text: '它是怎么一点点攒起来的？', action: 'chat' },
        ],
      });
    }, after + step) as unknown as number
  );

  // done
  timers.push(
    setTimeout(() => {
      if (aborted) return;
      opts.onDone?.({
        messageId: `mock-msg-${Date.now()}`,
        conversationId: String(opts.data.conversationId ?? 'mock-conv-1'),
      });
    }, after + step * 2) as unknown as number
  );

  return {
    abort() {
      aborted = true;
      timers.forEach((t) => clearTimeout(t));
    },
  };
}
