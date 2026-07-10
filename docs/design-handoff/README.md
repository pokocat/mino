# 交接文档：米诺战略参谋部 · 天势小程序 · V3（精简·可实现优先）

> 给 coding agent 的实现交接包。目标：把本设计落地为**真实可运行**的微信小程序 + 轻后端。
>
> **本版为 V3。** V3 的原则是「可实现性优先」：只保留能用成熟组件搭出来的东西，砍掉一切需要自研算法或让 LLM 生成精确数字的设计。主设计参考稿为 `米诺 V3 · 精简版.dc.html`。

---

## 0. 一句话理解这个产品

原本是一套「V6.0 军师提示词」放在 Claude Code 里给人用：**用户跟 AI 对话 → AI 理解用户 → 产出报告**。V3 就是把这套原样搬进小程序。

**只有两大块**：
- **军师对话**：唯一的核心交互引擎。
- **报告库**：唯一的交付物。报告 = LLM 把对话总结成的 Markdown 文档，也是「越来越懂用户」的沉淀。

**唯一动线**：收到「今日一问」推送 → 跟军师聊透 → 点「让军师写份报告」或军师主动写 → 报告进库 + 微信通知 → 回来接着聊，下次军师更懂你。**对话产出报告，报告喂养对话。**

---

## 1. 技术架构（先读这一节 · 决定能不能做出来）

一切围绕 **FastGPT**。四种能力全是成熟组件，没有一处需要自研算法。

```
微信小程序前端
  ├─ 对话页 ── SSE 流式 ──▶ 自有后端 ──▶ FastGPT Chat API
  └─ 报告库 ── REST ───────▶ 自有后端 (reports CRUD)

自有轻后端 (Node/NestJS 或 Go，任选)
  ├─ 微信登录 code2session → openid/unionid + JWT
  ├─ 代理 FastGPT 对话：注入 chatId(=用户会话) 与用户标识，转发 SSE
  ├─ reports 表：存 LLM 生成的 Markdown 报告（4 类）
  ├─ tasks 表：cron/随机派发「今日一问」+ 微信订阅消息推送
  └─ users.streak_days：连续天数（Redis 维护）

FastGPT（引擎，产品灵魂）
  ├─ 应用：装 V6.0 提示词 = 军师人格（轻量「势/节奏」比喻叙事，**不排盘**）
  ├─ 每用户知识库：把对话要点写入 → 下次对话自动检索 = 「越来越懂你」（FastGPT 自带，不自造记忆）
  └─ 「总结成报告」工作流/提示：读对话 + 检索知识库 → 输出 Markdown 报告
```

**可实现性结论**：
| 能力 | 怎么实现 | 风险 |
|---|---|---|
| 对话 + 流式 | FastGPT Chat API（SSE），后端转发 | 无，标准 |
| 长期记忆 / 越来越懂你 | FastGPT 每用户**知识库**，对话要点写入、自动检索 | 无，FastGPT 自带 |
| 报告生成 | LLM 产出 **Markdown**，存 `reports` | 无，纯文本生成 |
| 报告展示 | 小程序 Markdown 渲染组件 | 无，成熟库 |
| 任务派发 / 回访 | cron + 任务队列 + 微信**订阅消息** | 无，标准 |
| 连续天数 | `users.streak_days`（Redis） | 无 |

> **关键**：没有八字排盘引擎，没有评分公式，不让 LLM 生成任何精确数字。军师只做「对话 + 写 Markdown」。

---

## 2. 关于设计文件

`.dc.html` 是**用 HTML 制作的高保真设计参考稿（原型）**，表达最终视觉与交互意图，**不是可直接搬运的生产代码**。请在目标技术栈里**重建**这些界面。像素/颜色/间距/文案以源码内联样式为准，通用 token 见 §9。

---

## 3. 信息架构（V3 · 底部 2 tab）

```
进入：微信登录 → [首次] 简单入局（昵称/行业/一句话生意背景）→ 落到对话
├─ 军师 tab（对话 · 引擎 · 默认）
│   ├─ 对话首页                入口=tab根
│   ├─ 顶部「今日一问」卡        = 任务派发的最轻形态；CTA「开始聊」进对话
│   ├─ 右上「连续 N」            = streak 芯片
│   ├─ 流式对话                 直连 FastGPT
│   ├─ 对话后 suggestions        每轮回复末尾长出「接着聊」气泡，其一是「让军师写份报告」
│   └─ 报告生成弹层             点「生成报告」/军师主动写 → loading → 进库 + 推送
└─ 报告库 tab（交付物 = 知识库）
    ├─ 报告列表                 入口=tab根；顶部 4 类筛选 chip
    ├─ 报告详情·战略分析         Markdown：主要矛盾 / 定位 / 三步走 + 军师批注
    ├─ 报告详情·创业履历         自传体叙事正文 + 军师批注 + 溯源
    ├─ 报告详情·复盘战报 / 决策记录  同为 Markdown 文档，版式复用
    └─ 每份报告：可读 / 分享 / 导出 / 「跟军师聊这份报告」回对话
```

**没有独立的「任务」「列传」「我」tab**——任务/streak 用最轻形态塞进对话页；报告库即知识库。

---

## 4. 报告系统（核心交付物）

**报告 = Markdown 文档**，存 `reports` 表。4 类：

| type | 内容 | 触发 |
|---|---|---|
| `strategy` 战略分析 | 主要矛盾 / 定位 / 三步走 | 用户点生成 / 军师主动 |
| `resume` 创业履历 | 个人履历·创业故事·自传体叙事 | 用户点生成 / 军师主动 |
| `review` 复盘战报 | 阶段性复盘、这一周/这一阶段的战报 | 用户点生成 / 定时提醒后 |
| `decision` 决策记录 | 一个决定的理由/预期/待验证 | 用户点生成 / 对话中提炼 |

**两种触发**（都要）：
1. **用户按需**：对话里点 suggestion「让军师写份报告」→ 弹生成弹层 → 后端调 FastGPT「总结成报告」工作流 → 存库 → 微信通知。
2. **军师主动**：对话达成某标记（聊透一件事 / 到复盘时点）时，后端追加一次生成调用，主动产出并推送「军师刚写好一份…」。

**生成流程（技术）**：
```
用户对话若干轮（FastGPT，要点已写入知识库）
  → 触发「生成报告」：后端带 {conversation要点 + 用户知识库检索} 调 FastGPT 报告工作流
  → 返回 Markdown（title + body + 军师批注 annotation + 关联对话 source）
  → 存 reports；前端 Markdown 渲染
  → 报告要点亦可再写回知识库，形成「对话→报告→更懂你」闭环
```

> 报告是「叙事/结构化文字」，全部由 LLM 写；命理/统计精确数字一律不做。

---

## 5. 任务 / 推送 / 连续天数（最轻形态）

保留，但**不做复杂任务体系、不占 tab**：
- **今日一问（任务派发）**：cron 每天生成一条 `tasks` 记录（军师的一个引导问题），渲染成对话页顶部卡；点「开始聊」把该问题作为对话开场（`prompt_seed`）。
- **随机「军师突然找你」**：后台按沉默天数随机推一条带悬念的邀约（可选，二期）。
- **微信订阅消息推送**：把「今日一问」「报告写好了」送达用户微信（需用户授权模板消息）。
- **连续天数 streak**：`users.streak_days`，每天至少聊一次 +1，断签清零（Redis）。仅作对话页右上角一个芯片，不做段位/里程碑/解锁。

---

## 6. 数据模型（PostgreSQL 建议）

只需 5 张核心表，全部以 `user_id` 串联。

```
users
  id, wx_openid(uniq), wx_unionid, nickname, avatar_url,
  industry, biz_note,                         # 入局时一句话生意背景
  streak_days, last_active_date, created_at

conversations                                 # 对话会话
  id, user_id(FK), fastgpt_chat_id,           # 对应 FastGPT 的 chatId
  title, last_message_at, created_at
messages
  id, conversation_id(FK), role('user'|'assistant'),
  content(text), created_at

reports                                       # 核心交付物 = Markdown 文档
  id, user_id(FK),
  type('strategy'|'resume'|'review'|'decision'),
  title, body_md(text), annotation(text),     # body_md=正文, annotation=军师批注
  source_conversation_id(FK,null),            # 溯源
  origin('user'|'agent'),                     # 用户点生成 / 军师主动
  word_count, created_at

tasks                                         # 今日一问 / 随机邀约（轻）
  id, user_id(FK),
  type('daily_q'|'random'),
  question(text), prompt_seed(text),          # prompt_seed = 进对话时的开场
  status('pending'|'started'|'done'|'expired'),
  conversation_id(FK,null),
  pushed_at, expires_at, created_at
```

> 无 `bazi_profiles`、无 `monthly_fortunes`、无 `reviews` 评分表、无 `milestones`/`rank_events` —— 这些 V2 表在 V3 全部删除。命理只作对话中的比喻叙事，不落结构化库。

---

## 7. API 设计（建议 · REST + SSE）

```
# 鉴权 / 入局
POST /auth/wx-login          {code} → {token, isNewUser}
POST /profile                {nickname, industry, biz_note}

# 对话（直连 FastGPT）
POST /conversations          → {conversation_id, fastgpt_chat_id}
POST /conversations/:id/messages  {content} → SSE 流式（后端转发 FastGPT）
GET  /conversations/:id/messages

# 报告
POST /reports/generate       {conversation_id, type} → 触发 FastGPT 报告工作流 → 存库
GET  /reports?type=          列表（4 类筛选）
GET  /reports/:id            Markdown 详情
POST /reports/:id/append     「跟军师补充」→ 回对话续写后更新报告

# 任务 / 推送 / streak
GET  /tasks/today            今日一问
POST /tasks/:id/start        → 新建/续用 conversation，注入 prompt_seed
GET  /me/streak
# 后台：cron 生成 daily_q + 微信订阅消息推送
```

---

## 8. 军师 LLM 集成（产品灵魂）

**人格权威来源**：项目根目录的系统提示词文档 `⽶诺战略参谋部 · 天势终极版 V6.0`。把其中【哲学内核「势」/ 五种角色语气 / 术语翻译成比喻 / 禁用词 / 鼓励用词 / 埋悬念钩子 / 十二问 / 复盘流程】作为 FastGPT 应用的 system prompt。`军师对话（可对话）.dc.html` 内含一份浓缩可用版可直接取用。

**在 FastGPT 里怎么配**：
1. 新建一个**应用**，system prompt = V6.0 浓缩版（去掉排盘相关，改为「势/节奏」的比喻叙事口径）。
2. 给应用挂一个**知识库**，按 `user_id` 隔离（或每人一个知识库）。对话中/对话后，把用户透露的关键信息写入该知识库；下轮对话开启知识库检索 → 实现「越来越懂你」。
3. 建一个**「总结成报告」的工作流/提示**：输入=对话内容+知识库检索结果，输出=对应 type 的 Markdown（含军师批注）。后端 `/reports/generate` 调它。

**上下文拼装**（保证因人而异、跨对话记忆）：
```
system = 军师人格（势哲学/语气铁律/输出口径，禁用赋能·抓手·底层逻辑等词）
       + 知识库检索片段（该用户过往画像 / 已写报告要点）
context = 该 conversation 的历史 messages
→ 流式返回；关键要点异步写回知识库
```

**铁律**：八字术语严禁直出，翻译成剧情/比喻（如 势起=风来帆张）；不生成任何精确命理/统计数字；报告只写叙事与结构化文字。

---

## 9. 设计 Token（宣纸水墨）

```
背景 纸：  radial(#F6F1E5 → #E6DCC9) + 极淡横纹
卡面：     #FBF7EF（边框 rgba(40,34,28,.10)，影 0 6px 18px rgba(40,34,28,.07)）
正文墨：   #1F1B16   次要：#574F44   辅助：#6B6256   极弱：#9B9384
朱砂红（主强调/军师/印章）：#B23A2E
描金（履历/细节）：#9A7B3F     深墨面（头像/今日一问/引擎块）：#1F1B16 + 金字 #E8C77A
报告类型色：战略分析 #B23A2E · 创业履历 #9A7B3F · 复盘战报 #3D6FA0 · 决策记录 #7A5BA0
微信绿（登录按钮）：#07C160
字体：标题/正文/报告正文 衬线 Noto Serif SC；UI 无衬线 Noto Sans SC；数字/标签 等宽 Space Mono
圆角：卡片 6–8px；手机屏 40px；按钮 6–8px。手机框 388×844。
底部 tab：高 60–64px，2 tab（军师/报告库），激活 #B23A2E，未激活 #9B9384。
Markdown 报告版式：小节前加 4px 竖色条 + 衬线小标题；军师批注用左描金竖线引用块。
```

---

## 10. 鉴权与隐私

- 微信 `code2session` 拿 openid/unionid，服务端签发 JWT，`users.wx_openid` 唯一。
- 对话内容与报告属个人数据：传输加密、最小化存储、提供删除；登录页含《用户协议》《隐私政策》勾选。
- 报告仅本人可见；分享时导出脱敏摘要或图片。

---

## 11. 文件清单（设计参考）

- `米诺 V3 · 精简版.dc.html` — **V3 主参考**。技术架构图 + 2 tab 全部界面（对话首页 / 报告库 / 报告详情·战略分析 / 报告详情·创业履历 / 报告生成弹层）+ 范围取舍说明。
- `军师对话（可对话）.dc.html` — 可真实对话的军师页（含内置 system prompt、指令栏）。**LLM 行为参考**。
- `米诺 V2 · 产品全景.dc.html` / `米诺战略参谋部 · 产品全景.dc.html` — 历史版本（含更重的任务/列传/命盘设计，仅供取用文案与细节，**架构以 V3 为准**）。
- `support.js` — 预览运行时（非生产代码）。

---

## 12. 建议实现里程碑

1. **骨架**：微信登录 + JWT + 底部 2 tab + 设计 token。
2. **对话（MVP 核心）**：FastGPT 应用配好 → 后端转发 SSE → 对话页流式 + suggestions。
3. **知识库记忆**：对话要点写入 FastGPT 每用户知识库 + 检索接入上下文。
4. **报告**：`/reports/generate`（FastGPT 报告工作流）→ 存库 → Markdown 渲染 → 4 类筛选。
5. **回访**：today 今日一问（cron）+ 微信订阅消息推送 + streak。
6. **打磨**：报告分享/导出、「跟军师补充/聊这份报告」回流、随机邀约（可选）。
