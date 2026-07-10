# 本地开发环境搭建（M0 地基）

本文说明如何在本地把米诺 V3 的双端与依赖服务跑起来。

## 0. 先决条件

- Node.js 20（CI 基准；本地 20/22 均可）
- npm 10+
- Docker + Docker Compose v2（起 postgres / redis / FastGPT）
- 微信开发者工具（运行小程序）

## 1. 依赖服务（Docker Compose）

根目录 `docker-compose.yml` 编排四类服务：

| 服务 | 镜像（固定 tag） | 用途 | 端口 |
|---|---|---|---|
| `postgres` | `postgres:16` | 应用业务库（Prisma 迁移目标） | 5432 |
| `redis` | `redis:7` | 缓存 / BullMQ 队列 / streak | 6379 |
| `fastgpt` | `ghcr.io/labring/fastgpt:v4.9.11` | LLM 引擎（军师应用 / 知识库 / 报告工作流） | 3001→3000 |
| `fastgpt-mongo` | `mongo:5.0.18` | FastGPT 文档库 | 内网 |
| `fastgpt-pg` | `pgvector/pgvector:0.8.0-pg15` | FastGPT 向量库 | 内网 |
| `fastgpt-sandbox` | `ghcr.io/labring/fastgpt-sandbox:v4.9.11` | FastGPT 代码沙箱 | 内网 |

### 只起业务依赖（日常开发后端够用）

```bash
docker compose up -d postgres redis
```

### 起全套（含 FastGPT）

```bash
docker compose up -d
```

密钥/密码通过根目录 `.env` 覆盖（compose 里用 `${VAR:-默认值}` 兜底），例如：

```env
POSTGRES_USER=mino
POSTGRES_PASSWORD=mino
POSTGRES_DB=mino
FASTGPT_MONGO_USER=myusername
FASTGPT_MONGO_PASSWORD=mypassword
FASTGPT_TOKEN_KEY=please-change-me
FASTGPT_ROOT_KEY=please-change-me
FASTGPT_FILE_TOKEN_KEY=please-change-me
# 模型接入（产品方后续填入）
FASTGPT_OPENAI_BASE_URL=
FASTGPT_CHAT_API_KEY=
```

## 2. FastGPT 说明与出处

`docker-compose.yml` 的 FastGPT 部分取自官方 **pgvector 版** `docker-compose-pgvector.yml`
的最小可跑子集（fastgpt + mongo + pgvector + sandbox）。

- 官方仓库：<https://github.com/labring/FastGPT>
- 官方编排目录：`FastGPT/deploy/docker/`（`docker-compose-pgvector.yml`）
- 官方文档（Docker 部署 / 配置文件）：<https://doc.fastgpt.io/docs/development/docker/>
- 参考版本：镜像 tag 固定为 `v4.9.11`（fastgpt / sandbox）、`mongo:5.0.18`、`pgvector/pgvector:0.8.0-pg15`。
  升级前请对照官方同版本编排文件核对环境变量与依赖。

已知需产品方接入的部分（M0 仅留占位，未接入即无法真正对话）：

1. **模型 API / AK**：`config.json`（`deploy/fastgpt/config.json`）中的 `llmModels` / `vectorModels`
   与 compose 里的 `OPENAI_BASE_URL` / `CHAT_API_KEY`（通常指向 OneAPI / AIProxy）。
2. **Mongo 副本集初始化**：`mongo:5.0.18` 首次启动需 `--replSet` + keyFile 初始化；
   完整步骤见官方文档「Docker 部署」章节（生成 keyFile → `rs.initiate()`）。

> M0 目标是把地基和编排落地，不要求 FastGPT 完整跑通对话；模型接入在 M2 与产品方并行推进。

## 3. 后端（server/）

```bash
cd server
cp .env.example .env          # 按需修改
npm install
npx prisma generate           # 生成 Prisma Client（需 DATABASE_URL 存在）
npx prisma validate           # 校验 schema
npm run start:dev             # 开发模式
```

健康检查：

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

数据库迁移（需 postgres 已起）：迁移基线已纳入版本库（`server/prisma/migrations/`，首条 `..._init` 建全部 6 张表 + 枚举 + 索引），按环境二选一：

```bash
# 生产 / CI / 联调：只应用已有迁移，不改 schema、不需要 shadow database
npx prisma migrate deploy

# 开发：改了 schema.prisma 后生成并应用新迁移（会用到 shadow database，
# 故连接用户需有 CREATEDB 权限）
npx prisma migrate dev --name <改动说明>
```

> 快速原型 / 一次性本地起库时，也可用 `npx prisma db push` 直接把 schema 推进库里
> （不生成迁移文件、不留历史），适合还没定型的调试。但**入库前与生产务必走 `migrate deploy`**
> 以保留可回溯、可复现的迁移历史；同一套库上不要把 `db push` 与 `migrate` 两条路线混用。

常用脚本：`npm run build` / `npm run lint` / `npm test`。

### Mock 登录（无真实微信 appid 也能联调）

`.env` 里置 `WX_MOCK=true` 后，`POST /auth/wx-login` 不请求微信 `jscode2session`，
而是用 `openid = mock_<code 的 sha256 前缀>` 造一个稳定用户 —— 同一 `code` 恒等同一用户，
方便本地把「登录 → 入局 → /me」闭环跑通。示例（先 `docker compose up -d postgres`
或本地起 PostgreSQL，再 `npx prisma migrate deploy` 建表；急着调试也可 `npx prisma db push`）：

```bash
# 1) 登录拿 token（新用户 isNewUser=true）
curl -s -X POST http://localhost:3000/auth/wx-login \
  -H 'Content-Type: application/json' -d '{"code":"test-code-123"}'
# 2) 填入局资料（带 Bearer token）
curl -s -X POST http://localhost:3000/me/profile \
  -H 'Content-Type: application/json' -H "Authorization: Bearer <token>" \
  -d '{"nickname":"阿明","industry":"餐饮","bizNote":"开了家小面馆"}'
# 3) 拉当前用户（含 streakDays 与报告计数摘要 reportStats）
curl -s http://localhost:3000/me -H "Authorization: Bearer <token>"
```

生产/真机联调务必置 `WX_MOCK=false` 并填 `WX_APPID` / `WX_SECRET`。

### 记忆（M3：知识库 + kb.ingest 队列）

M3 让军师「越来越懂你」：每轮对话结束后异步把要点写入该用户的 FastGPT 知识库，
下一轮用本条消息检索知识库、把命中片段作为附加上下文喂给军师（不落 `messages` 表、不下发端上）。

- **队列（BullMQ + ioredis）**：要点写入是后台 job（`kb-ingest` 队列）。本地起 Redis：

  ```bash
  docker compose up -d redis          # 推荐
  # 或宿主已装 redis-server：
  redis-server --daemonize yes --port 6379 && redis-cli ping   # 期望 PONG
  ```

- **Redis 降级（记忆是旁路，绝不拖垮对话）**：若无 `REDIS_URL`、置 `QUEUE_ENABLED=false`、
  或 Redis 不可达，应用**照常启动、对话照常完成**，仅「要点写入」这一后台任务降级为空操作
  （入队失败/超时仅告警日志）。因此本地只想调对话时，不起 Redis 也能跑。

- **无真实 FastGPT 也能跑通记忆闭环**：置 `FASTGPT_MOCK=true` 时，知识库的建库/写入/检索
  全走进程内存实现（`kbId=mock_kb_<userId>`，检索为朴素关键词包含匹配），配合本地 Redis 即可
  端到端验证「第一轮透露事实 → kb.ingest 消费写入 → 第二轮检索命中并拼进上下文」。
  真实模式下建库/检索所需模型名由 `FASTGPT_KB_VECTOR_MODEL` / `FASTGPT_KB_AGENT_MODEL` 指定，
  须与产品方 FastGPT `config.json` 登记的模型一致。

### 回访（M5：今日一问 + 订阅消息 + streak）

M5 收尾回访闭环：每日 cron 派发「今日一问」，微信订阅消息送达，连续天数 streak 结算。

- **今日一问**：`GET /tasks/today` 返回当日一问 `{id, question, hint, estMinutes, status}`
  或 `null`；**当日无任务时惰性生成**（新用户当天即可拿到，不必等 cron）。
  `POST /tasks/:id/start` 新建会话（开场 assistant 消息 = 军师今日一问），返回 `{conversationId}`，幂等。
  `FASTGPT_MOCK=true` 时问题固定为设计稿那条「你最值钱的一张牌是什么？」。

- **cron（每日 08:30 Asia/Shanghai）**：为活跃用户（近 14 天有消息或 `streakDays>0`）生成
  当日 daily_q 并推送。可临时在代码中调用 `TaskCron.runDailyDispatch()` 手动触发验证。

- **订阅消息（R4）**：`WxPushService.sendDailyQuestion` / `sendReportReady`。
  `WX_MOCK=true` 时不触外网，仅结构化打印 `[mock push]`；发送失败（43101 用户未授权等）
  只记日志绝不抛出。模板 id 走 `WX_TMPL_DAILY_Q` / `WX_TMPL_REPORT_READY`（产品方申请后填入）。
  `access_token` 进程内内存缓存 7000s（单实例足够；多实例各自缓存，微信侧对 token 幂等）。

- **streak（R6）**：以 Asia/Shanghai 日界，用户每日**第一条消息**触发结算——
  昨天活跃 +1、今天已活跃不变、断签重置为 1。日界计算见 `modules/streak/streak.util.ts`
  纯函数（显式 +8 偏移，无 DST，不依赖服务器本地时区）。`GET /me/streak`、`GET /me` 返回最新值。

## 4. 小程序（miniprogram/）

```bash
cd miniprogram
npm install
npx tsc --noEmit              # 类型检查
```

用微信开发者工具「导入项目」，目录选 `miniprogram/`，AppID 使用占位 `touristappid`
（无需真实 AppID 即可预览；正式联调时替换为真实 AppID）。

- 底部为自定义 3 tab（军师 / 报告库 / 我），见 `custom-tab-bar/`。
- 设计 token 统一在 `styles/tokens.wxss`，`app.wxss` 引入并铺纸底背景。

## 5. 提前并行事项（方案 §10）

微信主体资质与类目、订阅消息模板申请、FastGPT 部署与模型 key、域名 + HTTPS + ICP 备案
（request 合法域名）——均需在 M0 阶段并行启动。
