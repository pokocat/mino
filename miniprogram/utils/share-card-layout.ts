// 分享图布局计算（纯逻辑，零依赖，可在 Node 直接跑断言）。
// 与 utils/sse-decode.ts 同一模式：把不依赖 wx/canvas 的部分抽出便于自测。
// canvas 绘制与编排见 utils/share-card.ts。标识符英文、注释中文。

// ---------------------------------------------------------------------------
// 布局度量常量（750 逻辑像素坐标系）
// ---------------------------------------------------------------------------
export const CARD_W = 750;
const PAD_X = 56; // 左右边距
const PAD_TOP = 60;
const PAD_BOTTOM = 72;
export const CONTENT_W = CARD_W - PAD_X * 2; // 正文可用宽

export const SEAL = 72; // 品牌行印章方块边长
const BRAND_H = 108; // 品牌行占高（印章 + 名号）
const TYPELABEL_H = 56; // type 色章行

export const TITLE_SIZE = 42;
const TITLE_LH = 62;
const TITLE_GAP = 18;

const META_H = 48; // 来源 · 日期 · 字数

export const HEADING_SIZE = 32;
const HEADING_H = 66; // 竖色条小节标题行（含上下留白）

export const TEXT_SIZE = 28;
const TEXT_LH = 48;
const PARA_GAP = 20; // 段落间距
export const ITEM_INDENT = 56; // 壹贰叁序号占位缩进

export const ANNO_SIZE = 27;
const ANNO_LH = 46;
export const ANNO_PAD = 30; // 批注块内边距
const ANNO_GAP = 40; // 批注块上留白

const FOOTER_GAP = 44;
const FOOTER_H = 96; // slogan + 名号/日期

const MAX_PARAS = 6; // 正文段落上限，超出截断防长图过高

// 边距导出给绘制层复用
export const METRICS = {
  PAD_X,
  TITLE_LH,
  HEADING_H,
  TEXT_LH,
  ITEM_INDENT,
  ANNO_LH,
  ANNO_PAD,
};

// 壹贰叁…（1..10），超出退回阿拉伯数字
const CN_ORDINAL = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'];
export function ordinal(n: number): string {
  return n >= 1 && n <= 10 ? CN_ORDINAL[n - 1] : String(n);
}

const ORIGIN_LABEL: Record<string, string> = {
  user: '我请米诺写的',
  agent: '米诺执笔',
};

// 导出图输入（ExportData 的结构子集；ExportData 可直接传入）
export interface CardParagraph {
  kind: 'heading' | 'text' | 'item';
  text: string;
}
export interface CardData {
  title: string;
  typeLabel: string;
  createdAt: string;
  wordCount: number;
  origin: string;
  paragraphs: CardParagraph[];
  annotation: string;
  brand: { name: string; slogan: string };
}

// ---------------------------------------------------------------------------
// 折行（纯函数）：手写中文按 measure 逐字累加换行；显式 \n 强制换行。
// measure 只需返回给定字符串在目标字体下的像素宽度。
// ---------------------------------------------------------------------------
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const lines: string[] = [];
  let line = '';
  // Array.from 按码点切分，中文/emoji 均安全
  for (const ch of Array.from(text)) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    const test = line + ch;
    // 超宽且当前行非空 → 换行；单字超宽也至少独占一行（line==='' 时不再切）
    if (line !== '' && measure(test) > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line !== '') lines.push(line);
  return lines.length ? lines : [''];
}

// 尺寸测量函数签名：给定文本与字号（及可选字重/衬线）返回像素宽
export type MeasureFn = (
  text: string,
  fontSize: number,
  opts?: { weight?: 'normal' | 'bold'; serif?: boolean }
) => number;

// 布局块（drawCard 逐块绘制；颜色在绘制层按报告类型解析，此处不含色值）
export type CardBlock =
  | { kind: 'brand'; y: number }
  | { kind: 'typeLabel'; y: number; label: string }
  | { kind: 'title'; y: number; lines: string[] }
  | { kind: 'meta'; y: number; text: string }
  | { kind: 'heading'; y: number; text: string }
  | { kind: 'item'; y: number; index: number; lines: string[] }
  | { kind: 'text'; y: number; lines: string[] }
  | { kind: 'more'; y: number }
  | { kind: 'annotation'; y: number; lines: string[]; height: number }
  | { kind: 'footer'; y: number; brand: string; slogan: string; date: string };

export interface CardPlan {
  width: number;
  height: number;
  blocks: CardBlock[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// 布局计算（纯函数）：累计 y 得到每块位置与总高度。
// ---------------------------------------------------------------------------
export function planCard(data: CardData, measure: MeasureFn): CardPlan {
  const blocks: CardBlock[] = [];
  let y = PAD_TOP;

  // 品牌行
  blocks.push({ kind: 'brand', y });
  y += BRAND_H;

  // type 色章
  blocks.push({ kind: 'typeLabel', y, label: data.typeLabel });
  y += TYPELABEL_H;

  // 衬线大标题（折行）
  const titleLines = wrapText(data.title, CONTENT_W, (s) =>
    measure(s, TITLE_SIZE, { serif: true, weight: 'bold' })
  );
  blocks.push({ kind: 'title', y, lines: titleLines });
  y += titleLines.length * TITLE_LH + TITLE_GAP;

  // 元信息
  const metaText = `${ORIGIN_LABEL[data.origin] || '米诺执笔'} · ${formatDate(
    data.createdAt
  )} · 约 ${data.wordCount} 字`;
  blocks.push({ kind: 'meta', y, text: metaText });
  y += META_H;

  // 正文段落（截断至 MAX_PARAS）
  const truncated = data.paragraphs.length > MAX_PARAS;
  const paras = data.paragraphs.slice(0, MAX_PARAS);
  let itemNo = 0;
  for (const p of paras) {
    if (p.kind === 'heading') {
      blocks.push({ kind: 'heading', y, text: p.text });
      y += HEADING_H;
    } else if (p.kind === 'item') {
      itemNo += 1;
      const lines = wrapText(p.text, CONTENT_W - ITEM_INDENT, (s) => measure(s, TEXT_SIZE));
      blocks.push({ kind: 'item', y, index: itemNo, lines });
      y += lines.length * TEXT_LH + PARA_GAP;
    } else {
      const lines = wrapText(p.text, CONTENT_W, (s) => measure(s, TEXT_SIZE));
      blocks.push({ kind: 'text', y, lines });
      y += lines.length * TEXT_LH + PARA_GAP;
    }
  }

  // 截断提示行
  if (truncated) {
    blocks.push({ kind: 'more', y });
    y += TEXT_LH + PARA_GAP;
  }

  // 米诺批注块（左描金竖线 + 引号文案）
  if (data.annotation) {
    const lines = wrapText(data.annotation, CONTENT_W - ANNO_PAD * 2, (s) =>
      measure(s, ANNO_SIZE, { serif: true })
    );
    const height = ANNO_PAD * 2 + lines.length * ANNO_LH;
    y += ANNO_GAP;
    blocks.push({ kind: 'annotation', y, lines, height });
    y += height;
  }

  // 底部 slogan + 名号 + 日期
  y += FOOTER_GAP;
  blocks.push({
    kind: 'footer',
    y,
    brand: data.brand.name,
    slogan: data.brand.slogan,
    date: formatDate(data.createdAt),
  });
  y += FOOTER_H;

  y += PAD_BOTTOM;
  return { width: CARD_W, height: Math.ceil(y), blocks, truncated };
}

// ISO → 「YYYY年M月D日」
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
