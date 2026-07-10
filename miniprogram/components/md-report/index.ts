// md-report：受限 Markdown 报告渲染器（方案 §7.4，自研解析器，不引 towxml）。
// 按 type 分两种版式：
//   structured（strategy/review/decision）——小节前 4px 竖色条（色板按小节序轮换：
//     朱砂/描金/黛蓝）、有序列表项用 壹/贰/叁 衬线序号；
//   narrative（resume）——衬线正文、行高 2.05、两端对齐、首段首字下沉（朱砂 44px）。
// 标识符英文、注释中文。
import { parseMdLite } from '../../utils/md-lite';
import type { MdNode, MdSpan } from '../../utils/md-lite';
import type { ReportType } from '../../utils/api';

// 有序列表衬线序号（超出 10 项退回阿拉伯数字）
const ORDINALS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'];

interface RenderBlock {
  kind: 'section' | 'paragraph' | 'olist';
  title?: string;
  accent?: number; // 小节色条序（0/1/2 轮换）
  spans?: MdSpan[];
  dropCap?: string; // 自传体首段首字下沉
  items?: { ordinal: string; spans: MdSpan[] }[];
}

Component({
  options: { addGlobalClass: true },
  properties: {
    bodyMd: { type: String, value: '', observer: 'refresh' },
    type: { type: String, value: 'strategy', observer: 'refresh' },
  },
  data: {
    narrative: false,
    blocks: [] as RenderBlock[],
  },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const type = this.data.type as ReportType;
      const narrative = type === 'resume';
      const nodes = parseMdLite(this.data.bodyMd as string);
      this.setData({ narrative, blocks: buildBlocks(nodes, narrative) });
    },
  },
});

// 结构化节点 → 渲染块（解析色条序、序号、首字下沉）
function buildBlocks(nodes: MdNode[], narrative: boolean): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let sectionIdx = 0;
  let firstParaDone = false;

  for (const node of nodes) {
    if (node.type === 'section') {
      blocks.push({ kind: 'section', title: node.title, accent: sectionIdx % 3 });
      sectionIdx += 1;
    } else if (node.type === 'olist') {
      blocks.push({
        kind: 'olist',
        items: node.items.map((spans, i) => ({
          ordinal: ORDINALS[i] || String(i + 1),
          spans,
        })),
      });
    } else {
      // paragraph
      let spans = node.spans;
      let dropCap = '';
      // 自传体：首段首字下沉（从首个 span 抽出第一个字符）
      if (narrative && !firstParaDone && spans.length > 0 && spans[0].text.length > 0) {
        dropCap = spans[0].text.charAt(0);
        const head: MdSpan = { text: spans[0].text.slice(1), bold: spans[0].bold };
        spans = [head, ...spans.slice(1)];
        firstParaDone = true;
      }
      blocks.push({ kind: 'paragraph', spans, dropCap });
    }
  }
  return blocks;
}
