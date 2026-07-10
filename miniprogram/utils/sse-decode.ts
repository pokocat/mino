// SSE 流式底层纯逻辑（不依赖 wx）：UTF-8 增量解码 + 帧切分 + 帧解析。
// 抽成独立模块以便在 Node 直接跑断言（见 scripts/sse-decode.test 说明）。
// 标识符英文、注释中文。

// ---------------------------------------------------------------------------
// UTF-8 增量解码器
// chunk 可能在多字节字符中间被截断；本解码器把尾部不完整的字节序列留存到下一次，
// 只输出能安全解码的完整部分。不假设 TextDecoder 存在（小程序环境无该 API）。
// ---------------------------------------------------------------------------
export class Utf8IncrementalDecoder {
  // 上一次遗留的不完整字节（一个多字节序列的前若干字节）
  private pending: number[] = [];

  /** 解码一段字节（ArrayLike<number>，如 Uint8Array 或普通数组）；不完整尾部留存 */
  decode(bytes: ArrayLike<number>): string {
    const buf = this.pending.concat(Array.prototype.slice.call(bytes));

    // 从尾部回看，判断是否存在未完成的多字节序列
    let contCount = 0;
    let j = buf.length - 1;
    // 连续跳过 continuation 字节（10xxxxxx），最多回看 3 个（UTF-8 序列最长 4 字节）
    while (j >= 0 && (buf[j] & 0xc0) === 0x80 && contCount < 3) {
      contCount++;
      j--;
    }

    let completeLen = buf.length;
    if (j >= 0) {
      const lead = buf[j];
      const expected = seqLen(lead);
      const have = contCount + 1; // 首字节 + 已到达的 continuation 字节数
      // 多字节序列但尚未凑齐 → 从首字节处截断，留存到下次
      if (expected > 1 && have < expected) {
        completeLen = j;
      }
    }

    const consumable = buf.slice(0, completeLen);
    this.pending = buf.slice(completeLen);
    return bytesToString(consumable);
  }

  /** 流结束时冲刷残留（一般为空；非空说明源数据被截断，尽力解码）*/
  flush(): string {
    const rest = this.pending;
    this.pending = [];
    return bytesToString(rest);
  }
}

/** 由 UTF-8 首字节推断整个序列的字节长度（非法首字节按 1 处理）*/
function seqLen(lead: number): number {
  if (lead < 0x80) return 1; // 0xxxxxxx
  if ((lead & 0xe0) === 0xc0) return 2; // 110xxxxx
  if ((lead & 0xf0) === 0xe0) return 3; // 1110xxxx
  if ((lead & 0xf8) === 0xf0) return 4; // 11110xxx
  return 1;
}

/** 手写 UTF-8 → JS 字符串（已保证输入为完整序列的字节数组）*/
function bytesToString(bytes: number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp: number;
    let n: number;
    if (b0 < 0x80) {
      cp = b0;
      n = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      n = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      n = 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      n = 4;
    } else {
      // 非法首字节：跳过一个字节
      i++;
      continue;
    }
    if (i + n > bytes.length) break; // 理论已切齐，防御性中断
    for (let k = 1; k < n; k++) {
      cp = (cp << 6) | (bytes[i + k] & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SSE 帧切分与解析
// 事件帧以 `\n\n` 分隔；帧内含 `event:` / `data:` 行（本协议各一行，data 为 JSON）。
// ---------------------------------------------------------------------------
export interface SseFrame {
  event: string; // 事件名（缺省 'message'）
  data: string; // data 行拼接后的原始字符串（通常为 JSON）
}

export class SseFrameSplitter {
  // 尚未凑齐一个完整帧（未遇到 `\n\n`）的文本缓冲
  private buffer = '';

  /** 追加一段文本，返回其中已完整的帧（可能 0~N 个）；残段留在缓冲 */
  push(text: string): SseFrame[] {
    this.buffer += text;
    const frames: SseFrame[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

/** 解析单个帧的原始文本为 {event,data}；空帧返回 null */
export function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  let data = '';
  let hasData = false;
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // SSE 规范：冒号后若有一个前导空格则去掉；多条 data 行以 \n 连接
      let v = line.slice(5);
      if (v.charAt(0) === ' ') v = v.slice(1);
      data = hasData ? data + '\n' + v : v;
      hasData = true;
    }
    // 其他字段（id/retry/注释行）本协议未用，忽略
  }
  if (!hasData && event === 'message') return null;
  return { event, data };
}
