import { ReportType } from '@prisma/client';

/** 四类报告的中文名（与 report-prompt.ts TYPE_SPEC.name 同源；供导出/分享图标签用）。 */
const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  strategy: '战略分析',
  resume: '创业履历',
  review: '复盘战报',
  decision: '决策记录',
};

/** 取报告类型的中文标签。 */
export function reportTypeLabel(type: ReportType): string {
  return REPORT_TYPE_LABEL[type];
}

/** 一个导出段落：小节标题 / 普通段落 / 列表项。 */
export interface ExportParagraph {
  kind: 'heading' | 'text' | 'item';
  text: string;
}

/**
 * 受限 Markdown → 结构化段落（服务端自实现简版，供小程序端绘制分享图）。
 *
 * 依据受限 Markdown 规范（方案 §7.4）逐行解析：
 *  - `## 小节名`  → heading（去 `##` 标记）
 *  - `1. `/`2、`/`3)` 有序列表、`- `/`* `/`• ` 无序列表 → item（去列表标记）
 *  - 其余非空行     → text（普通段落）
 * 行内一律剥掉 `**粗体**` 星号；空行作为分隔忽略。
 * 规范外内容（图片/表格/代码块/链接/引用）本不应出现（工作流受限），若混入则按普通 text 兜底。
 */
export function parseBodyToParagraphs(bodyMd: string): ExportParagraph[] {
  const paragraphs: ExportParagraph[] = [];
  for (const rawLine of (bodyMd ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      paragraphs.push({ kind: 'heading', text: stripInline(heading[1]) });
      continue;
    }

    const ordered = line.match(/^\d+[.、)]\s+(.*)$/);
    if (ordered) {
      paragraphs.push({ kind: 'item', text: stripInline(ordered[1]) });
      continue;
    }

    const unordered = line.match(/^[-*•]\s+(.*)$/);
    if (unordered) {
      paragraphs.push({ kind: 'item', text: stripInline(unordered[1]) });
      continue;
    }

    paragraphs.push({ kind: 'text', text: stripInline(line) });
  }
  return paragraphs;
}

/** 去掉行内粗体星号（受限规范里唯一的行内标记）。 */
function stripInline(s: string): string {
  return s.replace(/\*\*/g, '').trim();
}
