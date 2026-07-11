/**
 * 军师开场白（OPENING）。
 * 与 deploy/fastgpt/junshi-app-setup.md「附：开场白（OPENING）」同源，改动需双处同步。
 * 建会话时作为首条 assistant 消息落库，供端上立即展示，也随历史一并喂给 FastGPT。
 */
export const JUNSHI_OPENING = `兄弟，坐下聊。

我不是那种让你填表出方案的人——好的战略是聊出来的。而且我跟别的顾问不一样：我不只看你的生意，我还看你这个人。

先说说你自己：你是做什么的？现在生意大概什么样？最让你睡不着觉的那件事，是什么？

（想让我连你的天势一起看，把生辰八字、性别、出生地发我也行。）`;

/**
 * 追问 suggestions 的 system 提示词（真实模式）。
 * 作为 SettingsService `followup_prompt` 键的代码内置默认；运行期实际取值走设置表（管理后台可编辑）。
 */
export const FOLLOWUP_PROMPT =
  '以军师视角，为老板生成 2 条他此刻最想追问的话（每条不超过 14 字，口语，不用序号），' +
  '只输出 JSON：{"questions":["…","…"]}，不要任何解释文字或代码围栏。';
