import { ReportType } from '@prisma/client';
import { ChatMessage } from '../fastgpt/fastgpt-chat.service';

/** 报告工作流解析出的结构化结果（与 deploy/fastgpt/report-workflow-prompt.md §2 契约同构）。 */
export interface ParsedReport {
  title: string;
  bodyMd: string;
  annotation: string;
}

/** 四类报告的中文名与正文结构说明（与 report-workflow-prompt.md §3 同源，改动需两处同步）。 */
const TYPE_SPEC: Record<ReportType, { name: string; structure: string }> = {
  strategy: {
    name: '战略分析',
    structure:
      '固定三小节，依次用 `## 主要矛盾`、`## 定位`、`## 三步走`；三步走小节用有序列表三项（1. 2. 3.），每项以「**动词。**」开头。',
  },
  resume: {
    name: '创业履历',
    structure:
      '自传体叙事，**不使用任何小节标题**，只用段落（段间空行）；首段可作首字下沉，围绕「这位老板为什么走到今天」讲一段有温度的故事。',
  },
  review: {
    name: '复盘战报',
    structure:
      '小节式结构自拟，2-4 个 `## 小节名`（例如 `## 打得怎么样`、`## 关键失手`、`## 下一仗`），可含一处有序列表。',
  },
  decision: {
    name: '决策记录',
    structure:
      '小节式结构自拟，2-4 个 `## 小节名`（例如 `## 要决的事`、`## 两条路`、`## 军师建议`），把利弊讲清。',
  },
};

/** 受限 Markdown 规范（system 提示词共用段）。 */
const LIMITED_MD_RULES =
  'bodyMd 遵循受限 Markdown 规范，只允许：`## 小节名`、有序列表 `1. `、普通段落、`**粗体**`；' +
  '禁止一级标题 `#`、图片、表格、代码块、链接、引用块。批注只放 annotation 字段，绝不写进 bodyMd。';

/**
 * 组装报告生成的 messages（喂给 FastgptChatService.complete，非流式）。
 * 变量位：对话内容、知识库检索片段、用户画像（industry/bizNote）、（可选）主题。
 */
export function buildReportMessages(params: {
  type: ReportType;
  dialogue: string;
  kbFragments: string[];
  industry?: string | null;
  bizNote?: string | null;
  topic?: string | null;
}): ChatMessage[] {
  const spec = TYPE_SPEC[params.type];
  const system =
    `你是「米诺战略参谋部」的军师，正在把一段对话总结成一份《${spec.name}》报告。\n` +
    `${LIMITED_MD_RULES}\n` +
    `本类型（${params.type} / ${spec.name}）正文结构要求：${spec.structure}\n` +
    '只输出一个 JSON 对象：{"title","bodyMd","annotation","wordCount"}，不要任何解释文字或代码围栏。' +
    'annotation 是一句独立的军师点睛话（不混入正文）。语气延续军师人格：势/节奏的比喻叙事，不用「赋能/抓手/底层逻辑」等黑话，不输出任何精确命理或统计数字。';

  const profileLine =
    [
      params.industry ? `行业：${params.industry}` : '',
      params.bizNote ? `生意背景：${params.bizNote}` : '',
    ]
      .filter(Boolean)
      .join('；') || '（暂无画像）';
  const kbBlock =
    params.kbFragments.length > 0
      ? params.kbFragments.map((f) => `- ${f}`).join('\n')
      : '（暂无检索片段）';
  const topicLine = params.topic ? `\n【本次聚焦主题】\n${params.topic}\n` : '';

  const user =
    `【用户画像】\n${profileLine}\n\n` +
    `【知识库检索片段（过往画像）】\n${kbBlock}\n${topicLine}\n` +
    `【本次对话内容】\n${params.dialogue}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 组装「报告续写」（append）的 messages：把原报告全文 + 军师批注 + 本次续写会话对话喂给 complete，
 * 要求把新内容**自然织进原文**（而非附加在尾部）、保持同一 type 的正文结构与受限 Markdown 规范，
 * title/type 不变（故只需输出 {bodyMd, annotation, wordCount}，不输出 title）。
 */
export function buildAppendMessages(params: {
  type: ReportType;
  originalTitle: string;
  originalBodyMd: string;
  originalAnnotation?: string | null;
  dialogue: string;
}): ChatMessage[] {
  const spec = TYPE_SPEC[params.type];
  const system =
    `你是「米诺战略参谋部」的军师，正在**续写并修订**一份已完成的《${spec.name}》报告——` +
    '老板刚补充了新的想法，你要把这些新内容自然地织进原报告，而不是简单附加在末尾。\n' +
    `${LIMITED_MD_RULES}\n` +
    `保持本类型（${params.type} / ${spec.name}）的正文结构：${spec.structure}\n` +
    '标题与报告类型保持不变。只输出一个 JSON 对象：{"bodyMd","annotation","wordCount"}，' +
    '不要 title 字段、不要任何解释文字或代码围栏。bodyMd 是织入新内容后的**完整修订版正文**（含原有内容），' +
    'annotation 是一句独立的军师点睛话。语气延续军师人格：势/节奏的比喻叙事，' +
    '不用「赋能/抓手/底层逻辑」等黑话，不输出任何精确命理或统计数字。';

  const annotationLine = params.originalAnnotation
    ? `\n【原批注】\n${params.originalAnnotation}\n`
    : '';
  const user =
    `【原报告标题】\n${params.originalTitle}\n\n` +
    `【原报告正文】\n${params.originalBodyMd}\n${annotationLine}\n` +
    `【老板本次补充的对话】\n${params.dialogue}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 解析续写返回：与 parseReportJson 同构但**不要求 title**（续写保持原标题不变）。
 * 校验 bodyMd 非空；失败返回 null（供 Worker 判定重试/回滚）。
 */
export function parseAppendReportJson(
  raw: string,
): { bodyMd: string; annotation: string } | null {
  const text = extractJsonBlock(raw);
  if (!text) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const bodyMd = typeof o.bodyMd === 'string' ? o.bodyMd.trim() : '';
  if (!bodyMd) return null;
  const annotation =
    typeof o.annotation === 'string' ? o.annotation.trim() : '';
  return { bodyMd, annotation };
}

/**
 * 解析报告工作流返回：剥离可能的 ```json 围栏 → JSON.parse → 校验 title/bodyMd 非空。
 * 任一步失败返回 null（供 Worker 判定重试/置 failed）。
 */
export function parseReportJson(raw: string): ParsedReport | null {
  const text = extractJsonBlock(raw);
  if (!text) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const bodyMd = typeof o.bodyMd === 'string' ? o.bodyMd.trim() : '';
  if (!title || !bodyMd) return null;
  const annotation =
    typeof o.annotation === 'string' ? o.annotation.trim() : '';
  return { title, bodyMd, annotation };
}

/** 从原始返回中抽出 JSON 文本：去 ```json 围栏，取第一个 { 到最后一个 } 的子串。 */
function extractJsonBlock(raw: string): string | null {
  const stripped = (raw ?? '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

/** 正文字数：剥离受限 Markdown 标记后按非空白字符计数（服务端权威值）。 */
export function countWords(bodyMd: string): number {
  return stripMarkdown(bodyMd).replace(/\s/g, '').length;
}

/** 列表摘要：正文首段去 Markdown 标记后截 60 字（供 GET /reports 列表 summary）。 */
export function buildSummary(bodyMd: string): string {
  const blocks = (bodyMd ?? '').split(/\n{2,}/);
  const firstPara =
    blocks.find((b) => b.trim() && !b.trim().startsWith('##')) ??
    blocks[0] ??
    '';
  return stripMarkdown(firstPara).slice(0, 60);
}

/** 去掉受限 Markdown 标记（小节号/列表号/粗体星号），得纯文本。 */
function stripMarkdown(md: string): string {
  return (md ?? '')
    .replace(/^\s*#{1,6}\s*/gm, '') // 小节标题标记
    .replace(/^\s*\d+[.、)]\s*/gm, '') // 有序列表号
    .replace(/\*\*/g, '') // 粗体星号（须先于无序列表规则，避免吃掉 **粗体** 的星号）
    .replace(/^\s*[-*•]\s*/gm, '') // 无序列表号（兜底）
    .replace(/\s+/g, ' ')
    .trim();
}
