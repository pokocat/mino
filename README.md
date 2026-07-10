# 米诺战略参谋部 · 天势小程序（mino）

跟军师（LLM）对话 → 军师越来越懂你 → 产出 Markdown 报告。微信小程序 + 轻后端 + FastGPT。

当前处于 **V3（精简版）实现阶段**，已完成 M0 地基（monorepo 脚手架 + 数据模型 + 编排 + CI）。

## 文档

- [`docs/plan/V3-设计与规划方案.md`](docs/plan/V3-设计与规划方案.md) — **主方案**：范围、技术选型、架构、数据模型、API、前端组件、FastGPT 集成、风险与里程碑
- [`docs/research/design-analysis.md`](docs/research/design-analysis.md) — 设计稿逐屏分析报告
- [`docs/design-handoff/`](docs/design-handoff/) — 设计交接包副本（交接文档 + 主设计参考稿 `米诺 V3 · 精简版.dc.html`）

设计权威来源为 claude.ai/design 项目「mino小程序设计方案」。

## 开发

### 目录结构

```
mino/
├─ server/            NestJS 11 + Prisma 后端（鉴权/对话代理/报告/任务/streak/安全）
├─ miniprogram/       微信原生小程序（TypeScript）
├─ deploy/fastgpt/    FastGPT 运行配置占位（config.json）
├─ docker-compose.yml postgres:16 + redis:7 + FastGPT 自托管
├─ docs/              方案 / 设计分析 / 交接包 / 本地起步（dev-setup.md）
└─ .github/workflows/ CI（server + miniprogram 两个 job）
```

### 本地起步

```bash
# 1) 起依赖（数据库 / 缓存 / FastGPT）
cp server/.env.example server/.env     # 按需改密钥
docker compose up -d postgres redis     # 仅业务依赖；FastGPT 起法见 docs/dev-setup.md

# 2) 后端
cd server
npm install
npx prisma generate
npm run start:dev                        # http://localhost:3000/health → {"status":"ok"}

# 3) 小程序
cd miniprogram
npm install
npx tsc --noEmit                         # 类型检查
# 用微信开发者工具打开 miniprogram/ 目录（appid 占位 touristappid）
```

详细的 FastGPT 自托管说明、环境变量与常见问题见 [`docs/dev-setup.md`](docs/dev-setup.md)。
