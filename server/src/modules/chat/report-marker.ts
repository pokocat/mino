import { ReportType } from '@prisma/client';

/** 从回复流中拦截到的一个 report_ready 标记信息。 */
export interface ReportMarker {
  type: ReportType;
  topic: string;
}

/** push()/flush() 的返回：可安全下发的纯文本 + 本次新拦到的标记。 */
export interface MarkerParseResult {
  text: string;
  markers: ReportMarker[];
}

// 标记固定开头；完整形态形如 <mino:report_ready type="strategy" topic="…"/>
const OPENER = '<mino:report_ready';
const FULL_MARKER = /<mino:report_ready\b[^>]*?\/>/g;
const ALLOWED_TYPES: ReportType[] = [
  'strategy',
  'resume',
  'review',
  'decision',
];

/**
 * 流式米诺回复的标记拦截器。
 *
 * 核心难点：`<mino:report_ready .../>` 标记可能被 FastGPT 的 SSE 切分在多个 chunk 里。
 * 策略：内部维护缓冲区，每次 push 先抽走所有**完整**标记，再判断缓冲区尾部是否
 * 「疑似未闭合的标记前缀」——是则扣留、等下个 chunk 续上，不是则整段下发。
 * 由此保证：① 标记文本绝不泄漏给端上；② 伪前缀（如 `<mino:rep air…`）能被正常下发。
 */
export class ReportMarkerStream {
  private buffer = '';

  /** 喂入一段增量文本，返回可安全下发的文本与本次拦到的标记。 */
  push(chunk: string): MarkerParseResult {
    this.buffer += chunk;
    const markers = this.extractCompleteMarkers();

    // 找到缓冲区尾部可能属于「未完成标记」的起点，之前的内容都可安全下发。
    const holdFrom = this.suspiciousTailStart();
    if (holdFrom === -1) {
      const text = this.buffer;
      this.buffer = '';
      return { text, markers };
    }
    const text = this.buffer.slice(0, holdFrom);
    this.buffer = this.buffer.slice(holdFrom);
    return { text, markers };
  }

  /** 流结束：抽走残留完整标记后，把缓冲区剩余当作正文下发；丢弃残缺标记前缀防泄漏。 */
  flush(): MarkerParseResult {
    const markers = this.extractCompleteMarkers();
    const holdFrom = this.suspiciousTailStart();
    let text: string;
    if (holdFrom === -1) {
      text = this.buffer;
    } else {
      // 收尾时仍未闭合的疑似标记前缀是残缺标记，直接丢弃，只保留其之前的正文。
      text = this.buffer.slice(0, holdFrom);
    }
    this.buffer = '';
    return { text, markers };
  }

  /** 从缓冲区抽走所有完整标记并解析，原地删除（不下发）。 */
  private extractCompleteMarkers(): ReportMarker[] {
    const markers: ReportMarker[] = [];
    this.buffer = this.buffer.replace(FULL_MARKER, (m) => {
      markers.push(parseMarker(m));
      return '';
    });
    return markers;
  }

  /**
   * 返回缓冲区中「疑似未完成标记」的起始下标；无则 -1。
   * 判定：取最后一个 '<' 起的尾串 tail——
   *  - tail 是 OPENER 的前缀（含真前缀 `<mino:rep`，也含伪前缀被排除）→ 疑似；
   *  - tail 以 OPENER 开头但尚无 '/>'（属性还在流）→ 疑似。
   */
  private suspiciousTailStart(): number {
    const lt = this.buffer.lastIndexOf('<');
    if (lt === -1) return -1;
    const tail = this.buffer.slice(lt);
    if (OPENER.startsWith(tail)) return lt;
    if (tail.startsWith(OPENER) && !tail.includes('/>')) return lt;
    return -1;
  }
}

/** 解析一个完整标记的 type/topic；type 非法则回落 strategy，topic 缺省空串。 */
function parseMarker(marker: string): ReportMarker {
  const typeMatch = /type\s*=\s*"([^"]*)"/.exec(marker);
  const topicMatch = /topic\s*=\s*"([^"]*)"/.exec(marker);
  const rawType = typeMatch?.[1] as ReportType | undefined;
  const type =
    rawType && ALLOWED_TYPES.includes(rawType) ? rawType : 'strategy';
  const topic = topicMatch?.[1]?.trim() ?? '';
  return { type, topic };
}
