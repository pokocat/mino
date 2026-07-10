// 受限 Markdown 解析器（纯函数，不依赖 wx）——方案 §7.4 决策：自研，不引 towxml。
// 抽成独立模块以便在 Node 直接跑断言（见 scripts/md-lite.test.js）。标识符英文、注释中文。
//
// 受限规范（报告工作流输出约定）：
//   `## 小节名`   → section 小节标题
//   `1. 列表项`   → 有序列表（连续多行归并为一个 olist 节点）
//   普通行        → 段落（多行连排归并为一段；空行分段）
//   `**粗体**`    → 段落 / 列表项内的粗体 span
// 规范外语法（无序列表 `-`、表格 `|`、`#`/`###` 等）一律按普通段落兜底渲染，
// 保证任何 LLM 输出都能读。

// 行内片段：一段文本 + 是否粗体
export interface MdSpan {
  text: string;
  bold: boolean;
}

// 结构化节点
export type MdNode =
  | { type: 'section'; title: string } // ## 小节
  | { type: 'paragraph'; spans: MdSpan[] } // 普通段落（含兜底）
  | { type: 'olist'; items: MdSpan[][] }; // 有序列表（每项为 span 数组）

const RE_SECTION = /^##\s+(.+)$/; // 恰两个 # + 空格（### 不匹配 → 兜底段落）
const RE_OLIST = /^\d+\.\s+(.+)$/; // 有序列表项 "1. xxx"

/** 把含 `**粗体**` 的文本拆成 span 数组；无粗体则单个 span。空文本返回空数组。 */
export function splitBold(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  let rest = text;
  // 逐个匹配成对的 ** ... **；未闭合的 ** 按普通文本保留
  const re = /\*\*([^*]+)\*\*/;
  let m = re.exec(rest);
  while (m) {
    const before = rest.slice(0, m.index);
    if (before) spans.push({ text: before, bold: false });
    spans.push({ text: m[1], bold: true });
    rest = rest.slice(m.index + m[0].length);
    m = re.exec(rest);
  }
  if (rest) spans.push({ text: rest, bold: false });
  return spans;
}

/** 受限 Markdown → 结构化节点数组 */
export function parseMdLite(md: string): MdNode[] {
  const nodes: MdNode[] = [];
  const lines = (md || '').replace(/\r\n?/g, '\n').split('\n');

  let paraBuf: string[] = []; // 累积的普通段落行
  let listBuf: MdSpan[][] = []; // 累积的有序列表项

  const flushPara = () => {
    if (paraBuf.length) {
      // 连续普通行归并为一段（中文无需空格连接）
      nodes.push({ type: 'paragraph', spans: splitBold(paraBuf.join('')) });
      paraBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf.length) {
      nodes.push({ type: 'olist', items: listBuf });
      listBuf = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === '') {
      // 空行：结束当前段落 / 列表（空行不产出空段落）
      flushPara();
      flushList();
      continue;
    }

    const secM = RE_SECTION.exec(line);
    if (secM) {
      flushPara();
      flushList();
      nodes.push({ type: 'section', title: secM[1].trim() });
      continue;
    }

    const listM = RE_OLIST.exec(line);
    if (listM) {
      // 有序列表：先结束普通段落，累积到 listBuf
      flushPara();
      listBuf.push(splitBold(listM[1].trim()));
      continue;
    }

    // 普通行（含 `-` 无序、`|` 表格、`###` 等规范外语法）：兜底为段落
    flushList();
    paraBuf.push(line);
  }

  flushPara();
  flushList();
  return nodes;
}
