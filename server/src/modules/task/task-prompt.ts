import { ChatMessage } from '../fastgpt/fastgpt-chat.service';

/** 今日一问解析结果。 */
export interface ParsedDailyQuestion {
  question: string;
  hint: string;
  estMinutes: number;
}

/**
 * 组装「今日一问」出题的 messages（喂给 FastgptChatService.complete，非流式）。
 * 米诺给这位老板出今天想通的一件事：一句话问题 + 一句钩子文案 + 预计分钟数，参考画像与近期关切。
 */
export function buildDailyQuestionMessages(params: {
  industry?: string | null;
  bizNote?: string | null;
  kbFragments: string[];
}): ChatMessage[] {
  const system =
    '你是「米诺战略参谋部」的米诺。给这位老板出今天想通的一件事——' +
    '一句话问题（question）+ 一句钩子文案（hint，勾起他想答的欲望）+ 预计分钟数（estMinutes，2-5 的整数）。' +
    '参考他的画像与知识库检索到的近期关切，问到他心里去。' +
    '只输出一个 JSON 对象：{"question","hint","estMinutes"}，不要任何解释文字或代码围栏。' +
    '语气延续米诺人格：势/节奏的比喻叙事，不用「赋能/抓手/底层逻辑」等黑话，不输出任何精确命理或统计数字。';

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

  const user =
    `【用户画像】\n${profileLine}\n\n` +
    `【知识库检索片段（近期关切）】\n${kbBlock}\n\n` +
    '请据此出今天的一问。';

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 解析今日一问返回：剥 ```json 围栏 → JSON.parse → 校验 question 非空。
 * estMinutes 收敛到 1-10 的整数（缺省 3）；hint 缺省空串。失败返回 null。
 */
export function parseDailyQuestion(raw: string): ParsedDailyQuestion | null {
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
  const question = typeof o.question === 'string' ? o.question.trim() : '';
  if (!question) return null;
  const hint = typeof o.hint === 'string' ? o.hint.trim() : '';
  const rawMin =
    typeof o.estMinutes === 'number' ? Math.round(o.estMinutes) : 3;
  const estMinutes = Math.min(Math.max(rawMin, 1), 10);
  return { question, hint, estMinutes };
}

/** 从原始返回中抽出 JSON 文本：去 ```json 围栏，取第一个 { 到最后一个 }。 */
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
