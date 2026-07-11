# 米诺战略参谋部 · 天势小程序 V3（精简版）设计稿分析报告

> 分析对象：`mino-v3-jingjian.dc.html`（高保真设计原型）+ `handoff-README.md`（交接文档）
> 目标仓库：`pokocat/mino`（空仓库 / 绿地项目）。本报告为主规划者的实施方案输入。
> 说明：设计稿为 1836px 宽画布，绝对定位排布若干"手机屏"（388×844 内屏，外壳 414px）+ 技术架构图 + IA 说明面板。所有视觉规格均从内联样式逐条提取。

---

## 0. 画布总览与坐标

| 区块 | 画布坐标(left,top) | 尺寸 | 性质 |
|---|---|---|---|
| 标题区 | 0, 0 | 1040 宽 | 说明文字 |
| 00 技术架构图 | 0, 250 | 1836 宽 | 三段式架构图（前端→轻后端→FastGPT） |
| 01 米诺对话首页 | 0, 720 | 414 | 手机屏 · tab 根 |
| 02 报告库 | 474, 720 | 414 | 手机屏 · tab 根 |
| 03 报告详情·战略分析 | 948, 720 | 414 | 手机屏 · 二级页 |
| 04 报告详情·创业履历 | 1422, 720 | 414 | 手机屏 · 二级页 |
| 05 报告生成弹层 | 0, 1720 | 414 | 手机屏 · 模态 |
| IA/范围说明面板 | 474, 1720 | 854 | 说明文档 |

手机屏统一结构：外壳 `#0b0a08` 圆角 52px padding 13px，投影 `0 30px 70px rgba(40,34,28,.28)`；内屏 388×844 圆角 40px，背景为 `宣纸`——`repeating-linear-gradient` 极淡横纹（3–4px，rgba(40,34,28,.013)）叠加 `radial-gradient(circle at 50% -5%, #F6F1E5, #E6DCC9)`；内屏用 flex 纵向布局。

---

## 1. 逐屏拆解

### 01 · 米诺对话首页（tab 根 · 核心引擎）

**自上而下分区**（flex column）：

1. **状态栏** height 46px，`padding 0 26px 0 30px`，色 `#2a241c`。左：`9:41`（Space Mono 15px 700）；右：信号/wifi/电池三个内联 SVG 图标（`fill=currentColor`，电池外框 stroke-opacity .45）。
2. **导航栏** height 48px 居中。标题「米诺战略参谋部」（Noto Serif SC 700 / 16px / `letter-spacing:4px` / `#1F1B16`）。右侧绝对定位 streak 芯片：背景 `rgba(178,58,46,.08)`、圆角 12px、padding 3px 9px，内文「连续 47」（Space Mono 11px 700 `#B23A2E`）。
3. **可滚动内容区** `flex:1; overflow-y:auto; padding:6px 18px 0`：
   - **米诺头像+问候行**：50×50 印章方块（`#B23A2E` 圆角 4px，投影 `0 4px 14px rgba(178,58,46,.3)`），内「势」字（Noto Serif SC 900 / 28px / `#F6F1E5`）；右侧标题「兄弟，坐下聊。」（Serif 700 / 19px），副文「已为你写下 **6 份报告** · 越聊我越懂你」（11.5px `#6B6256`，"6 份报告"高亮 `#9A7B3F`）。
   - **今日一问卡（任务派发·深墨块）**：背景 `#1F1B16` 圆角 6px padding 15px 17px 投影 `0 8px 22px rgba(40,34,28,.22)`。右上角脉冲红点：8×8 圆 `#B23A2E`，`animation: mn-pulse 2.4s infinite`（透明度 1→.4、scale 1→.78）。标签「今日一问 · 米诺推送」（Space Mono 10px `letter-spacing:2px` `#E8C77A`）。主问句「今天想通一件事：你最值钱的一张牌是什么？」（Serif 700 / 16px / `#F6F1E5`）。副文「聊透了，我给你写进《战略分析》。约 3 分钟。」（11.5px `#b8b0a2`）。CTA 按钮「开始聊 →」（背景 `#B23A2E` 圆角 6px padding 10px 居中，13px `#F6F1E5` 500）。
   - **对话流**：
     - 米诺气泡（左）：30×30「师」字方标（`#1F1B16` / 金字 `#E8C77A` / Serif 700 14px）+ 气泡背景 `#FBF7EF` 边框 `rgba(40,34,28,.1)` `border-radius:4px 13px 13px 13px` padding 11px 13px 字号 13px `line-height:1.7` `max-width:250px` 投影 `0 3px 10px rgba(40,34,28,.05)`。
     - 用户气泡（右，`flex-direction:row-reverse`）：背景 `#B23A2E` `border-radius:13px 4px 13px 13px` 白字 `#F6F1E5` `max-width:230px` 投影 `0 3px 10px rgba(178,58,46,.2)`。
     - 第二条米诺气泡（同上），末句引出「要不要我把这段整理成一份报告？」
   - **suggestions（接着聊气泡）**：小标题「接着聊 ·」（10.5px `#9b9384` `letter-spacing:1px`）。三枚气泡纵向 gap 8px：
     - 主气泡（深）：`#1F1B16` 圆角 20px 金字 `#E8C77A` 12.5px，带「✍」图标——「好，帮我写一份《战略分析》报告」。
     - 次气泡×2（浅）：`#FBF7EF` 边框 `rgba(40,34,28,.16)` 圆角 20px `#574f44`——「这张牌别人半年能抄走吗？」/「它是怎么一点点攒起来的？」
4. **输入条** `flex-shrink:0; padding:10px 14px 8px; background:#EDE5D3; border-top:1px rgba(40,34,28,.1)`：占位输入框（flex:1 边框 `rgba(40,34,28,.16)` 圆角 18px padding 10px 14px 背景 `#FBF7EF` 占位文字「说说你的想法……」`#9b9384`）+ 发送圆钮（38×38 圆 `#B23A2E` 白色「↑」投影 `0 4px 12px rgba(178,58,46,.3)`）。
5. **底部 tab bar** height 60px `padding-bottom:6px` `background:#EDE5D3` `border-top`：两 tab 均分。米诺（激活 `#B23A2E`，聊天框 SVG）；报告库（未激活 `#9b9384`，文档 SVG）。标签 10px。

**交互/跳转**：CTA「开始聊 →」→ 以今日一问 `prompt_seed` 开场进对话；主 suggestion「写报告」→ 触发报告生成弹层（屏 05）；tab「报告库」→ 屏 02；发送钮 → 发消息触发 SSE 流式。**动效**：今日一问红点 `mn-pulse`（呼吸提示未读/待办）。

---

### 02 · 报告库（tab 根 · 唯一交付物）

**分区**：

1. 状态栏（同 01）。
2. 导航栏 48px：标题「报告库」（Serif 700 16px `letter-spacing:3px`）；右侧绝对定位副标「来自 FastGPT 知识库」（11px `#6B6256`）。
3. **筛选 chip 条** `flex-shrink:0; padding:6px 18px 10px; gap:7px; overflow-x:auto`：
   - 激活「全部 12」：`#B23A2E` 白字 圆角 16px padding 6px 13px。
   - 未激活四枚：`#FBF7EF` 边框 `rgba(40,34,28,.14)` 圆角 16px `#574f44`——「战略分析 / 创业履历 / 复盘战报 / 决策记录」。
4. **报告列表** `flex:1; overflow-y:auto; padding:0 18px 16px`：
   - **米诺主动·新报告卡（高亮）**：`#FBF7EF` **1.5px 边框** `rgba(178,58,46,.4)` 圆角 8px padding 15px 16px 投影 `0 6px 16px rgba(178,58,46,.1)`。右上角未读徽标「米诺刚写好」（9px `#B23A2E` 背景 `rgba(178,58,46,.1)` 圆角 8px）。类型 chip「战略分析」（10px `#B23A2E` 背景 `rgba(178,58,46,.08)` 圆角 9px）。标题「你的护城河：把信任做成根据地」（Serif 700 16px）。摘要「主要矛盾 · 定位 · 三步走。基于今天关于「最值钱的牌」的对话。」（11.5px `#6B6256`）。元信息行「今天 14:32 · 米诺执笔 · 约 900 字」（10.5px `#9b9384`）。
   - **常规报告卡×3**（`#FBF7EF` 边框 `rgba(40,34,28,.1)` 圆角 8px padding 13px 15px 投影 `0 4px 12px rgba(40,34,28,.05)` gap 9px）：
     1. 类型 chip「创业履历」（`#9A7B3F` 背景 `rgba(154,123,63,.1)`）+ 来源标签「我请米诺写的」；标题「起势：我为什么下海」；元「6月20日 · 3 段对话织成 · 约 1200 字」。
     2. chip「复盘战报」（`#3D6FA0` 背景 `rgba(61,111,160,.1)`）；标题「第 6 周复盘：砍掉副线之后」；元「6月18日 · 米诺执笔 · 约 700 字」。
     3. chip「决策记录」（`#7A5BA0` 背景 `rgba(122,91,160,.1)`）；标题「决定：暂缓拓第二家门店」；元「6月15日 · 待验证 · 约 400 字」。
5. 底部 tab bar（报告库激活）。

**交互/跳转**：任一报告卡 → 报告详情（战略分析→屏 03；创业履历→屏 04）；筛选 chip → 按 type 过滤列表；「米诺刚写好」为未读态，点开后应清除。

---

### 03 · 报告详情·战略分析（结构化 Markdown）

**分区**：

1. 状态栏。
2. 导航栏 48px：左「‹」返回（24px）；标题「战略分析」（Serif 700 15px `letter-spacing:2px`）；右「分享」（12px `#B23A2E`）。
3. **报告头** `padding:6px 0 14px; border-bottom:1px rgba(40,34,28,.1)`：类型 chip「战略分析」；大标题「你的护城河：把信任做成根据地」（Serif 900 / 22px / `line-height:1.4`）；元信息「米诺执笔 · 今天 14:32 · 源自「最值钱的牌」对话」（10.5px `#9b9384`）。
4. **Markdown 正文**（三小节，每节 `margin-top:16px`）——**小节模板**：`display:flex; gap:8px` 的 4×15px 竖色条（圆角 2px）+ Serif 700 15px 小标题；正文 13px `#2a241c` `line-height:1.85`。
   - 「主要矛盾」竖条 `#B23A2E`；正文含 `<b style="color:#B23A2E">扩张的速度 vs 信任的沉淀速度</b>` 强调。
   - 「定位」竖条 `#9A7B3F`。
   - 「三步走」竖条 `#3D6FA0`：三行列表，每行「壹/贰/叁」序号（Serif 900 15px `#B23A2E`）+ 正文 12.5px `#574f44`（含加粗黑字引导词「守。/攒。/扩。」）。
5. **米诺批注块**：`#FBF7EF` **左描金竖线** `border-left:3px solid #9A7B3F` `border-radius:0 6px 6px 0` padding 12px 15px 投影 `0 4px 12px rgba(40,34,28,.05)`。标签「米诺一句话」（10px `#9A7B3F` `letter-spacing:1px`）；引文「别急着摊大……」（Serif 13px `line-height:1.75`）。
6. **底部操作条** `padding:10px 18px 18px; background:linear-gradient(180deg,rgba(238,230,214,0),#EDE5D3 40%)`：主按钮「跟米诺聊这份报告」（flex:1 深墨 `#1F1B16` 圆角 8px 金字 `#E8C77A` 13.5px）+ 次按钮 46px 宽「↧」（导出/下载，`#FBF7EF` 边框 圆角 8px `#B23A2E` 16px）。

**交互/跳转**：返回 → 报告库；分享 → 微信分享（脱敏）；「跟米诺聊这份报告」→ 回对话页并注入该报告上下文；「↧」→ 导出。

---

### 04 · 报告详情·创业履历（自传体叙事）

与屏 03 同壳，正文版式不同（居中题头 + 长文叙事）：

1. 状态栏。
2. 导航栏：返回「‹」+ 标题「创业履历」+「分享」。
3. **居中题头** `text-align:center; padding:8px 0 16px`：chip「创业履历 · 第一篇」；大标题「起势：我为什么下海」（Serif 900 24px）；装饰分隔 40×2px `#B23A2E` 短线。
4. **叙事正文**：Serif 14px `#2a241c` **`line-height:2.05`** `text-align:justify`。首字下沉「二」——`float:left; font-size:44px; line-height:.85; font-weight:900; color:#B23A2E; margin:4px 10px 0 0`。段落用 `<br><br>` 分隔（非真正段落标签——落地时应转为 `<p>`）。人物名「牧之」为叙事主角占位。
5. **米诺批注块**（同 03 描金竖线样式，标签为「米诺批注」）。
6. **溯源标签行** `margin-top:14px; flex-wrap` gap 8px：三枚小 chip——「源自 6/20 对话」「3 段织成」（`#6B6256` 背景 `rgba(40,34,28,.05)` 圆角 10px）+「存入知识库」（`#9A7B3F` 背景 `rgba(154,123,63,.1)`）。
7. **底部操作条**：主按钮「跟米诺补充这一篇」+ 次按钮「✎」（编辑/补充，非导出——与 03 的「↧」区别）。

**交互/跳转**：「跟米诺补充这一篇」→ 回对话续写（对应 API `POST /reports/:id/append`）；溯源 chip 暗示可回跳源对话。

---

### 05 · 报告生成中·弹层（模态 loading）

**结构**：内屏保留纸底，其上叠：

1. **遮罩** `position:absolute; inset:0; background:rgba(20,17,13,.55)`。
2. **中部卡片** `left:22px; right:22px; top:210px` 背景 `#F6F1E5` 圆角 12px 投影 `0 24px 60px rgba(0,0,0,.4)`，padding 30px 24px 26px 居中：
   - **旋转 spinner**：56×56 圆环 `border:2px solid rgba(178,58,46,.2)` `border-top-color:#B23A2E`，`animation: mn-spin 1s linear infinite`（旋转 360°）。
   - 标题「米诺正在为你执笔……」（Serif 700 18px）。
   - 副文「正在把刚才关于「最值钱的牌」的对话，整理成一份《战略分析》报告。」（12px `#6B6256`）。
   - **进度清单**（`text-align:left` gap 7px 12px）：两条完成态「✓ 读取本次对话要点」「✓ 检索你的知识库（过往画像）」（`#6F8C5A` 墨绿）+ 一条进行态「· 撰写 主要矛盾 / 定位 / 三步走…」（`#9b9384` 灰）。
3. **底部提示** `bottom:44px` 居中：「写好会存进「报告库」，并微信通知你。**你可以先回去接着聊。**」（11px `#e8dcc4`，末句高亮 `#E8C77A`）。

**异步语义**：spinner + "存进报告库并微信通知"+"你可以先回去接着聊" 三者共同表明——**报告生成是后台异步任务**。前端不需阻塞等待；用户可离开弹层继续对话，完成后经微信订阅消息 + 报告库「米诺刚写好」未读态回收结果。这是本产品最关键的异步交互契约。

---

## 2. 组件清单（微信小程序组件化视角）

跨屏复用组件，含 props 建议（属性用小程序 `properties` 命名习惯）：

| 组件 | 复用位置 | props 建议 |
|---|---|---|
| **PhoneShell 手机壳** | 全部 5 屏（仅设计稿需要，生产不需要） | 仅原型用，生产环境即页面根，不实现 |
| **StatusBar 状态栏** | 全部 | 生产由系统状态栏承接，一般不自绘；如需自定义导航则 `time`、`theme('light'\|'dark')` |
| **NavBar 导航栏** | 全部 | `title`、`showBack(bool)`、`rightText`、`rightSlot`、`bind:back`、`bind:rightTap` |
| **StreakChip 连续芯片** | 01 | `days(number)`；样式固定朱砂 |
| **TabBar 底部导航** | 01/02 | 用 `custom-tab-bar` 实现；`active('agent'\|'reports')`；两 tab 图标+文字，激活 `#B23A2E` |
| **SealAvatar 印章头像** | 01（50px「势」/30px「师」） | `text`、`size`、`variant('red'\|'ink')`（红底白字 / 墨底金字） |
| **DailyQuestionCard 今日一问卡** | 01 | `question`、`subtitle`、`estMinutes`、`unread(bool→红点)`、`bind:start` |
| **MessageBubble 消息气泡** | 01 | `role('user'\|'assistant')`、`content`、`avatar`；据 role 切换配色/圆角方向 |
| **SuggestionChip 接着聊气泡** | 01 | `text`、`variant('primary'深金\|'plain'浅)`、`icon`、`bind:tap`；primary 用于「写报告」 |
| **ChatInputBar 输入条** | 01 | `placeholder`、`value`、`bind:input`、`bind:send`、`disabled` |
| **ReportCard 报告卡** | 02 | `type`、`title`、`summary`、`meta`(时间/来源/字数)、`origin('user'\|'agent')`、`isNew(未读→红边+徽标)`、`bind:tap` |
| **TypeChip 类型 chip** | 02/03/04 | `type('strategy'\|'resume'\|'review'\|'decision')` → 映射色；`size`、`label`（可含「· 第一篇」等后缀） |
| **FilterBar 筛选条** | 02 | `options[]`(含 count)、`active`、`bind:change`；横向滚动 |
| **ReportHeader 报告头** | 03/04 | `type`、`title`、`meta`、`layout('left'\|'center')`（03 左对齐 / 04 居中带装饰线） |
| **MarkdownSection 结构小节** | 03 | `accentColor`、`title`、`slot 正文`（4px 竖条 + 衬线小标题） |
| **StepList 三步走列表** | 03 | `items[{ordinal:'壹', lead:'守', text}]` |
| **AnnotationBlock 米诺批注块** | 03/04 | `label`（「米诺一句话」/「米诺批注」）、`text`；左描金竖线固定 |
| **DropCapProse 首字下沉正文** | 04 | `dropChar`、`paragraphs[]`；渲染衬线长文 |
| **SourceTags 溯源标签行** | 04 | `tags[{text, variant}]` |
| **DetailActionBar 底部操作条** | 03/04 | `primaryText`、`secondaryIcon('↧'\|'✎')`、`bind:primary`、`bind:secondary` |
| **GeneratingModal 报告生成弹层** | 05 | `visible`、`title`、`steps[{label, status:'done'\|'active'}]`、`hint`、`bind:close`（允许后台化） |

底层原子：`MarkdownRenderer`（towxml/wemark 封装，见风险 §6）。

---

## 3. 设计 Token 表

从内联样式全量枚举，并与 README §9 对照。

### 3.1 颜色

| 语义 | 值 | 用途 | README §9 一致性 |
|---|---|---|---|
| 纸背景（起） | `#F6F1E5` | 内屏渐变起点/卡片背景/弹层卡 | ✅ |
| 纸背景（止） | `#E6DCC9` | 内屏 radial 渐变止点 | ✅ |
| 卡面 | `#FBF7EF` | 气泡/报告卡/批注块 | ✅ |
| 卡面变体 | `#F6F1E5` | 架构图子卡 | ✅ |
| 输入条/tab 背景 | `#EDE5D3` | 底部区域 | ⚠️ §9 未列，补充 |
| 手机外壳 | `#0b0a08` | 原型专用 | 原型用 |
| 正文墨 | `#1F1B16` | 主文字/深墨块 | ✅ |
| 次要墨 | `#574F44`(样式写 `#574f44`) | 次要文字 | ✅ |
| 辅助墨 | `#6B6256` | 副文/元信息 | ✅ |
| 极弱墨 | `#9B9384`(`#9b9384`) | 占位/最弱元信息 | ✅ |
| 深墨块文字辅助 | `#2a241c` | 状态栏/正文段落 | ⚠️ §9 未列，补充 |
| **朱砂红（主强调）** | `#B23A2E` | 米诺/印章/CTA/激活/战略分析 | ✅ |
| **描金** | `#9A7B3F` | 履历/批注竖线/次强调 | ✅ |
| **金字（深块上）** | `#E8C77A` | 深墨块文字/主 suggestion | ✅ |
| 深块副文金 | `#e8dcc4`/`#b8b0a2`/`#b8b0a2` | 弹层/今日一问副文 | ⚠️ 补充 |
| 类型色·战略分析 | `#B23A2E` | strategy | ✅ |
| 类型色·创业履历 | `#9A7B3F` | resume | ✅ |
| 类型色·复盘战报 | `#3D6FA0` | review | ✅ |
| 类型色·决策记录 | `#7A5BA0` | decision | ✅ |
| 墨绿（完成/肯定） | `#6F8C5A` | 弹层完成态/结论标记 | ⚠️ §9 未列，补充 |
| 架构图·前端蓝 | `#3D6FA0` | FRONTEND 标签（复用类型蓝） | — |
| 架构图·后端棕 | `#9A7B3F`/`#9A7B3F` | THIN BACKEND | — |
| 微信绿 | `#07C160` | 登录按钮（设计稿未出现，仅 §9 列出） | ⚠️ 设计稿缺登录屏，仅文档提及 |

常用 alpha 边框/影：边框 `rgba(40,34,28,.10~.16)`；卡影 `rgba(40,34,28,.05~.08)`；朱砂影 `rgba(178,58,46,.2~.3)`。

### 3.2 字体族与字级

| 族 | 用途 | 出现字级 |
|---|---|---|
| **Noto Serif SC**（衬线） | 大标题/报告正文/米诺话术/小节标题/序号/印章字 | 900:22/24/28/44/46；700:15/16/18/19；400:13/14 |
| **Noto Sans SC**（无衬线） | 全局 UI/正文/副文/元信息 | 10~13.5px 常规区间 |
| **Space Mono**（等宽） | 时间 9:41 / streak 数字 / 分区编号标签 | 10/11/12/15px；`letter-spacing 2~3px` |

字重档：300/400/500/700/900（web 加载全档）。行高：UI 1.6~1.7；报告结构正文 1.85；自传叙事 **2.05**；米诺批注 1.75。

### 3.3 圆角

手机内屏 40px；外壳 52px；卡片/按钮/深块 6–8px；气泡 `4/13px` 非对称；chip/芯片 8–20px（胶囊 16/18/20px）；印章方标 4–5px；发送圆钮/头像 50%。→ 与 §9「卡片 6–8 / 手机屏 40 / 按钮 6–8」**一致**（§9 未提气泡非对称与 chip 胶囊，需补充）。

### 3.4 阴影

| 场景 | 值 |
|---|---|
| 手机外壳 | `0 30px 70px rgba(40,34,28,.28)` |
| 卡片默认 | `0 4px 12px rgba(40,34,28,.05)` |
| 架构主卡 | `0 8px 28px rgba(40,34,28,.08)` |
| 深墨块（今日一问/引擎） | `0 8px 22px rgba(40,34,28,.22)` |
| 高亮新报告卡 | `0 6px 16px rgba(178,58,46,.1)` |
| 印章头像 | `0 4px 14px rgba(178,58,46,.3)` |
| 气泡 | `0 3px 10px rgba(40,34,28,.05)` / 用户气泡 `rgba(178,58,46,.2)` |
| 弹层卡 | `0 24px 60px rgba(0,0,0,.4)` |

§9 给出「卡影 `0 6px 18px rgba(40,34,28,.07)`」为概称值，设计稿实测卡影多为 `.05`；差异细微，落地取一套 elevation 阶梯即可。

### 3.5 间距

内容区 padding 常见 18px（列表）/22px（报告正文）；卡内 padding 12~17px；气泡 11px 13px；元素纵向 gap 7~16px；小节间距 16~18px。**落地必须换算 rpx**（设计基于 375~414 逻辑宽度，1px ≈ 2rpx，但手机屏宽 388 与 750rpx 基准需按比例定标——列为风险）。

### 3.6 与 README §9 不一致/需补充清单

1. §9 未列：`#EDE5D3`（tab/输入背景）、`#2a241c`、`#6F8C5A`（墨绿）、深块副文金系（`#e8dcc4/#b8b0a2/#b8b0a2`）——设计稿实际使用，需纳入 token。
2. `#07C160` 微信绿在 §9 有、设计稿无——**登录/入局屏未在本设计稿出现**（README §3 有描述但无高保真），需补设计或按文档自拟。
3. §9 卡影概值 `.07` 与实测 `.05` 轻微出入，统一即可。
4. 气泡非对称圆角、chip 胶囊圆角、首字下沉规格 §9 未覆盖，建议补入 token 文档。

---

## 4. 交互流与状态机

### 4.1 完整用户动线（README §0/§3 与设计稿印证）

```
微信登录(code2session→JWT) →[首次]入局(昵称/行业/一句话生意背景) → 落到米诺对话tab
  → 顶部「今日一问」(cron 派发的 tasks.daily_q，红点 mn-pulse 未读)
  → 点「开始聊 →」(prompt_seed 作开场) → 流式对话(SSE, FastGPT)
  → 米诺引出「要不要写份报告」/ 用户点 suggestion「写《战略分析》」
  → 报告生成弹层(05, 异步后台任务) —— 用户可返回继续聊
  → 后台 FastGPT 报告工作流出 Markdown → 存 reports → 微信订阅消息通知
  → 报告库(02)出现「米诺刚写好」未读高亮卡 → 点开报告详情(03/04)
  → 「跟米诺聊这份报告」回流对话 → 要点写回知识库 → 下次米诺更懂你(闭环)
```

### 4.2 关键环节的前后端状态变化

| 环节 | 前端状态 | 后端/FastGPT 状态 |
|---|---|---|
| 登录/入局 | 登录页→入局表单→对话 | `POST /auth/wx-login`→openid+JWT；`POST /profile` 写 users.industry/biz_note；isNewUser 分流 |
| 今日一问展示 | 顶部卡 unread=true 红点脉冲 | cron 生成 `tasks(daily_q, pending)`，`pushed_at` 记推送 |
| 点开始聊 | 卡收起/对话获焦，注入开场 | `POST /tasks/:id/start`→新建/续用 conversation，status `pending→started`，写 conversation_id |
| 发消息 | 用户气泡即时上屏 + 米诺气泡打字机流入 | `POST /conversations/:id/messages`→SSE 转发 FastGPT；messages 落库；要点异步写知识库 |
| 每轮结束 | 末尾长出 suggestions 气泡 | 后端据回复/标记生成 suggestion（含「写报告」） |
| 触发生成报告 | 弹层 05 显示，spinner+分步✓；**允许关闭返回对话** | `POST /reports/generate {conversation_id,type}`→异步任务，调 FastGPT 报告工作流 |
| 生成完成 | 弹层可自动关/被后台化；报告库出现未读卡 | 存 `reports(origin,word_count,source_conversation_id...)`；发微信订阅消息 |
| 米诺主动写 | 无弹层，直接推送 + 报告库高亮「米诺刚写好」 | 达标记后端追加 generate，origin='agent' |
| 打开报告 | 未读态清除，Markdown 渲染 | `GET /reports/:id`；标记已读（需字段，见 §5） |
| 回流/补充 | 「跟米诺聊/补充这份报告」→回对话带上下文 | `POST /reports/:id/append` 续写后更新 report |
| streak | 右上「连续 N」芯片 | `users.streak_days` 每日 +1、断签清零（Redis） |

### 4.3 报告生成的异步语义（重点）

屏 05 三处文案「米诺正在执笔」「写好会存进报告库并微信通知你」「你可以先回去接着聊」共同定义了**非阻塞后台任务**契约：

- 前端 `POST /reports/generate` 后**不等待**返回体承载完整 Markdown，而是收到任务受理（如 `202 + report_id/status:pending`）即可让用户离开。
- 完成信号有两条回收路径：① 微信订阅消息推送；② 报告库轮询/进入时拉取 + 未读高亮。
- 建议后端引入报告状态字段 `report.status('generating'|'ready'|'failed')`（README §6 未含，见 §5），前端据此渲染"生成中占位卡 / 就绪 / 失败重试"。

---

## 5. 数据字段推断 · UI 需要 vs README §6 表结构差距

从各屏 UI 反推所需字段，逐一对照 README §6（users/conversations/messages/reports/tasks）。**标 ⚠️ 者为 UI 需要但 §6 未提供**。

### reports（报告卡/详情）

| UI 呈现 | 需要字段 | §6 是否有 |
|---|---|---|
| 类型 chip「战略分析」 | `type` | ✅ |
| 标题「你的护城河…」 | `title` | ✅ |
| 正文（主要矛盾/定位/三步走 / 自传） | `body_md` | ✅ |
| 米诺批注块 | `annotation` | ✅ |
| 「米诺执笔」vs「我请米诺写的」 | `origin('user'\|'agent')` | ✅ |
| **「约 900 字/1200 字/700 字」** | `word_count` | ✅（§6 已含） |
| **「今天 14:32」精确时间** | `created_at` | ✅ |
| **「米诺刚写好」未读态** | ⚠️ `is_read`/`read_at`（未读徽标+高亮红边） | ❌ **缺** |
| **「3 段对话织成」来源段数** | ⚠️ `source_segment_count` 或由多条 source 关联推导 | ❌ **缺**（§6 仅单个 `source_conversation_id`） |
| **「源自「最值钱的牌」对话」标题** | ⚠️ 关联 conversation 的 `title`（需 join，且 conversation 需有 title） | ⚠️ 部分（conversations 有 title，但需确保写入） |
| **「待验证」业务状态**（决策记录卡） | ⚠️ `status`/`decision_state`（如 pending_verify） | ❌ **缺** |
| **生成中占位/失败** | ⚠️ `status('generating'\|'ready'\|'failed')` | ❌ **缺** |
| chip「· 第一篇」序号（创业履历） | ⚠️ `sequence_no`/系列序号 | ❌ **缺** |
| 溯源标签「存入知识库」 | ⚠️ `synced_to_kb(bool)` 或 KB 写回标记 | ❌ **缺** |
| 分享/导出 | 用现有字段渲染即可 | ✅ |

### 报告库列表页头

| UI | 字段/来源 | §6 |
|---|---|---|
| **「全部 12」总数 + 各 chip 计数** | ⚠️ 需 `COUNT(reports) by type`（聚合，非表字段，但接口需返回） | ❌ 接口需补 |
| 首页「已为你写下 **6 份报告**」 | ⚠️ 用户维度报告总数（聚合） | ❌ 接口需补 |

### users / 对话首页

| UI | 字段 | §6 |
|---|---|---|
| 「连续 47」 | `streak_days` | ✅ |
| 头像「势」印章 | 固定资源，非用户字段 | — |
| 问候「兄弟，坐下聊」 | 文案模板（可含 nickname） | ✅(nickname) |

### tasks / 今日一问

| UI | 字段 | §6 |
|---|---|---|
| 问句「你最值钱的一张牌是什么？」 | `question` | ✅ |
| 「约 3 分钟」预估 | ⚠️ `est_minutes` | ❌ **缺**（或文案硬编码） |
| 「我给你写进《战略分析》」目标类型暗示 | ⚠️ `target_report_type` | ❌ **缺**（可选） |
| 红点未读 | `status('pending')` 可推导 | ✅ |
| 开始聊注入开场 | `prompt_seed` | ✅ |

### conversations（回流溯源）

| UI | 字段 | §6 |
|---|---|---|
| 报告「源自 X 对话」需对话有可读标题 | `title` | ✅（需确保生成/命名策略） |
| 「3 段对话织成」→ 一报告关联多对话 | ⚠️ 多对多关联表 `report_sources(report_id, conversation_id)` | ❌ **缺**（§6 仅单 FK，无法表达"3 段"） |

**§5 差距汇总（交付主规划者的补字段清单）**：
1. `reports.is_read`/`read_at`（未读态）
2. `reports.status('generating'|'ready'|'failed')`（异步生成状态）
3. `reports.decision_state`（决策记录「待验证」等业务态）
4. `reports.sequence_no`（创业履历「第一篇」系列序号）
5. `reports.synced_to_kb`（「存入知识库」标记）
6. 报告↔对话**多对多**关联（表 `report_sources`）以支撑「3 段对话织成」；单 `source_conversation_id` 不够
7. 报告计数接口：用户总数 + 按 type 分组计数（首页「6 份报告」、筛选「全部 12」）
8. `tasks.est_minutes`、可选 `tasks.target_report_type`
9. 确保 `conversations.title` 有生成策略（供溯源展示）

---

## 6. 实现风险与开放问题清单

| # | 风险/问题 | 说明 | 建议方向 |
|---|---|---|---|
| R1 | **SSE 在微信小程序受限** | 小程序无原生 EventSource；`wx.request` 需 `enableChunked:true` 才能分块接收，且对响应头/分包有兼容坑，真机与开发者工具表现不一 | 后端用 chunked transfer 转发 FastGPT SSE；小程序 `wx.request({enableChunked:true})` 手动解析 chunk 拼流；或降级为 WebSocket（`wx.connectSocket`）承载流式；务必真机回归 |
| R2 | **Markdown 渲染选型** | 报告是核心交付物，含小节竖条、序号壹贰叁、批注引用块、首字下沉、justify 长文——非标准 MD，纯库难还原版式 | 用 **towxml**（功能全、支持自定义样式，体积较大）或 **wemark**（轻但样式弱）；建议 towxml 打底 + 约定报告用**结构化 JSON/前置元数据**（如 sections[{accent,title,body}]、annotation）而非纯 MD，前端按组件渲染，规避 MD 解析不可控 |
| R3 | **Noto Serif SC 等 web 字体落地** | 设计强依赖衬线（大标题/报告正文/米诺话术/首字下沉）；小程序**不支持 @font-face 加载大体积中文 web 字体**，`wx.loadFontFace` 对完整中文字库（数 MB）体验差、首屏闪烁、包体超限 | ①优先用系统衬线兜底（iOS 有宋体、安卓多数无→退化明显）；②关键大标题走**图片/SVG 文字**或服务端渲染；③或接受安卓无衬线降级，仅 iOS 增强；④评估字体子集化（按报告用字动态子集）成本。**列为设计还原度最大风险** |
| R4 | **微信订阅消息模板审核** | 「今日一问」「报告写好了」依赖订阅消息，模板需审核、且**一次授权仅一次下发**（一次性订阅），无法无限主动推 | 用一次性订阅逐次引导授权；或申请长期订阅（类目受限）；文案模板提前报审；「米诺主动写报告」推送同理受配额约束，需产品侧降级为进 App 提示 |
| R5 | **米诺主动写报告的触发判定** | 「聊透一件事/到复盘时点」是模糊语义，后端难可靠判定"何时该主动生成" | 早期用显式信号（对话轮数阈值 + LLM 返回结构化 `should_generate` 标记 / suggestion 被点）驱动；避免复杂启发式；二期再引入基于知识库变化量的判定 |
| R6 | **streak 时区问题** | 「连续 N」按"每天至少聊一次"计，跨时区/凌晨临界易误判断签 | 统一以用户设备时区或固定 Asia/Shanghai 计算 `last_active_date`；Redis 存日期串而非时间戳；补偿逻辑处理跨零点 |
| R7 | **报告生成异步一致性** | 弹层可关闭、后台生成、多路回收（推送+轮询），存在"生成失败无回收""重复生成"风险 | 引入 `report.status` + 幂等 `generate` 任务键（conversation_id+type）；失败在报告库出可重试卡；前端进库时对 generating 态展示占位 |
| R8 | **登录/入局屏缺高保真** | 设计稿无登录/入局界面，仅 §3/§9 文字描述（微信绿 #07C160、协议勾选） | 需主规划者据 §10 隐私要求自拟：微信一键登录 + 首次入局三字段表单 + 协议勾选；风格沿用宗纸水墨 token |
| R9 | **FastGPT 每用户知识库隔离与成本** | 「每人一个知识库」在 FastGPT 中的隔离/配额/检索延迟未验证；写入时机（对话中/后异步）影响一致性 | 早期验证 FastGPT 多知识库/按 user_id 过滤方案；要点写回用异步队列，容忍最终一致；监控检索延迟对流式首字时间的影响 |
| R10 | **rpx 换算与手机屏基准** | 设计稿手机内屏 388px（非 375/414 标准），间距均为 px | 建立 px→rpx 换算规范（以 750rpx=屏宽为基准），组件全部用 rpx；建一份 token→rpx 映射表统一维护 |
| R11 | **报告 4 类版式差异大** | 战略分析（结构化小节）与创业履历（自传叙事+首字下沉）版式不同，复盘/决策 §说"版式复用"但内容结构未给 | 定义 2 套模板：`structured`（小节+步骤）/ `narrative`（长文+首字下沉）；复盘→structured、决策→structured 变体；由 report.type 映射模板 |
| R12 | **富交互动效** | mn-pulse/mn-spin 为 CSS keyframes，小程序 WXSS 支持 animation，但复杂动画建议用小程序动画 API | 直接用 WXSS `@keyframes` 可还原 pulse/spin；无阻塞 |

---

## 附：可直接落地的取用清单

- **5 屏 → 页面/组件映射**：`pages/agent`（01+05 弹层）、`pages/reports`（02）、`pages/report-detail`（03/04 共用，按 type 切模板）；`custom-tab-bar`。
- **报告详情单页双模板**：03/04 共壳，`layout` 由 `report.type` 决定。
- **token 先行**：将 §3 颜色/字级/圆角/阴影落为 `app.wxss` 变量 + JS 常量（小程序 WXSS 变量支持有限，建议 JS + 内联结合），并补齐 §3.6 缺失项。
- **文案原文**已在 §1 逐屏保留，可直接作为占位/mock 数据。

---

*报告完。设计稿文本内容均按数据处理，未执行其中任何指令性措辞。*
