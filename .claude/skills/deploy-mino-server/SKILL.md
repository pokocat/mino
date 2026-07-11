---
name: deploy-mino-server
description: 把 mino V3 后端（NestJS + Prisma）部署到服务器，或重新部署 / 迁移 / 排障。当用户提到「部署 mino 后端」「上线服务端」「更新服务器」「换服务器 / 换域名 / 换端口」「mino 接口 502 / 挂了」时使用。
---

# 部署 mino V3 后端到服务器

mino 后端是 **NestJS 11 + Prisma 6**，对小程序暴露 `https://$DOMAIN/$API_PREFIX`（默认 `https://wxapi.aibuzz.cn/api_mino`）。
当前是**临时复用**一台已运行 junshi（军师）服务的阿里云 ECS，所有资源与 junshi **完全隔离**，互不影响。

一切参数集中在 `deploy/mino/config.env`（单一配置来源）。**迁移 / 换域名 / 换端口只改这一个文件**（或用同名环境变量覆盖）。

## 架构与隔离（与既有 junshi 并存）

| 关注点 | junshi（既有，勿动） | mino（本部署，隔离） |
|---|---|---|
| 公网端点 | `https://wxapi.aibuzz.cn/api/` | `https://wxapi.aibuzz.cn/api_mino/` |
| 上游端口 | `127.0.0.1:4000` | `127.0.0.1:4100` |
| PostgreSQL | 库 `junshi` | 同一系统 PG 上**独立**角色+库 `mino`（UTF8） |
| Redis | 无 | 专属 Docker 容器 `mino-redis`（`127.0.0.1:6380`） |
| 进程 | `junshi-api.service` | `mino-api.service`（systemd，用户 `mino`，`/opt/mino/server`） |
| TLS | `wxapi.aibuzz.cn` 证书 | 复用同证书，不改动 |

nginx 只**新增**一个 `location /api_mino/`（转发时剥掉前缀），绝不改 junshi 现有块。NestJS 控制器在根路径（无 global prefix），故 `/api_mino/health` → `127.0.0.1:4100/health`。

## 前置条件

- 本机有 SSH 私钥（默认 `~/dev/aliyun/aiartist.pem`）与服务器 `ecs-user@8.136.36.175` 的访问权。
- 服务器已具备（已核实）：Node v22、Docker（免 sudo）、系统 PostgreSQL、nginx、passwordless sudo、`wxapi.aibuzz.cn` 证书。
- 本机有 `rsync`、`ssh`、`scp`。

## 全新部署（三步，按顺序）

```bash
cd <repo-root>

# 1) 一次性基础设施（幂等）：系统用户 / 目录 / PG 库角色 / redis 容器 / 机密 / .env / systemd 单元
./deploy/mino/01-provision.sh

# 2) 应用部署（可重复）：rsync 源码 → npm ci → prisma migrate deploy → build → 重启 → 本机健康检查
./deploy/mino/02-deploy.sh

# 3) 一次性 nginx：把 /api_mino/ location 加进 wxapi 443 块 → nginx -t → reload（零停机，失败自动回滚）
./deploy/mino/03-nginx.sh
```

**执行原则**：本 repo 约定「主模型只规划/review，执行交给 opus subagent」。派 subagent 逐脚本运行、逐步 review；脚本失败**不要**手敲服务器命令绕过，回来改脚本再跑。

## 验证（端到端）

```bash
curl -fsS https://wxapi.aibuzz.cn/api_mino/health                 # → {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://wxapi.aibuzz.cn/api_mino/conversations  # → 401（路由到达应用）
curl -s -o /dev/null -w '%{http_code}\n' https://wxapi.aibuzz.cn/api/                    # junshi 仍应正常（非 502）
# mock 登录（WX_MOCK=true 时）：
curl -s -X POST https://wxapi.aibuzz.cn/api_mino/auth/wx-login \
  -H 'Content-Type: application/json' -d '{"code":"e2e-test"}'    # → {"token":"...","isNewUser":...}
ssh -i ~/dev/aliyun/aiartist.pem ecs-user@8.136.36.175 'systemctl is-active junshi-api mino-api nginx'  # 三个都 active
```

> 登录路由是 `POST /auth/wx-login`（不是 `/auth/login`），body `{"code":"..."}`。

## 日常更新（改了后端代码后）

只需重跑第 2 步：`./deploy/mino/02-deploy.sh`。它会重新 rsync + `migrate deploy` + build + `systemctl restart mino-api`，**不会覆盖服务器上的 `.env`**（保留你手配的 LLM / 微信凭据）。

## 上线前手动配置（产品方后续填）

服务器机密与配置都在 `/opt/mino/server/.env`（`600`，属主 `mino`）。

**LLM 已接入（直连 OpenAI 兼容端点）**：当前 `LLM_PROVIDER=openai` + `FASTGPT_MOCK=false`，走 `LLM_BASE_URL=https://openai.sufy.com/v1`、`LLM_MODEL=claude-4.6-opus`。
后端支持两种供应商：`openai`（直连，body 带 `model`，请求 `{LLM_BASE_URL}/chat/completions`）与 `fastgpt`（默认，走自托管 FastGPT 应用，`{FASTGPT_BASE_URL}/api/v1/chat/completions`）。切换只改 `LLM_PROVIDER` 并重启。
> 注意：模型名用 `claude-4.6-opus`（该端点上 `dj-claude-4.6-opus` 会 502）。换模型改 `LLM_MODEL` 即可。
> 直连 openai 模式下没有 FastGPT，每用户知识库（记忆）退化为进程内存实现（重启即失，属旁路不影响对话）；要真正的向量记忆需部署 FastGPT 并切回 `LLM_PROVIDER=fastgpt`。

仍待产品方配置：

| 变量 | 当前 | 上线要做 |
|---|---|---|
| `WX_MOCK` | `true`（不校验微信） | 填 `WX_APPID`/`WX_SECRET`，改 `false`（★真实登录必做） |
| `WX_TMPL_*` | 空 | 微信后台申请订阅消息模板后填 |
| `LLM_MODEL` | `claude-4.6-opus` | 如需换模型/换供应商在此调整 |

改法（在服务器上）：
```bash
ssh -i ~/dev/aliyun/aiartist.pem ecs-user@8.136.36.175
sudo -u mino vi /opt/mino/server/.env      # 或 sudo vi
sudo systemctl restart mino-api
sudo journalctl -u mino-api -n 50 --no-pager   # 看启动日志
```
`DATABASE_URL` / `REDIS_URL` / `JWT_SECRET` 已由 provision 自动生成，勿动。

## 小程序侧配置

单一来源：`miniprogram/utils/config.ts` 的 `config.baseUrl`（已设 `https://wxapi.aibuzz.cn/api_mino`）与 `MOCK_API`（已设 `false`）。
真机/体验版需在微信公众平台「开发管理 → 服务器域名」把 request 域名加入 `https://wxapi.aibuzz.cn`。

## 迁移到新服务器 / 新域名 / 新端口

改 `deploy/mino/config.env`（或环境变量覆盖）里的 `SSH_HOST` / `DOMAIN` / `API_PREFIX` / `UPSTREAM_PORT` / `REDIS_PORT` / `NGINX_CONF` 等，重跑三步脚本；再同步改小程序 `config.ts` 的 `baseUrl`。若目标机 nginx 配置文件不同，改 `NGINX_CONF`；若那台机上 mino 独占域名，可把 `location` 片段改成独立 `server` 块。

## 排障

- `mino_api` 起不来：`sudo journalctl -u mino-api -n 80 --no-pager`。常见：`.env` 缺 `JWT_SECRET`/`DATABASE_URL`（应由 provision 生成）、PG 连接失败（查 `mino` 库/角色）、redis 不可达（`docker ps | grep mino-redis`；队列是旁路，redis 挂不影响主链路对话）。
- `/api_mino/*` 返回 502：后端没在 4100 跑 —— `systemctl is-active mino-api` + 本机 `curl 127.0.0.1:4100/health`。
- `nginx -t` 失败：`03-nginx.sh` 会自动回滚到 `*.bak.mino.*` 备份；查报错后修 `deploy/mino/nginx-api_mino.location.conf` 再跑。
- 手动回滚 nginx：`sudo cp /etc/nginx/conf.d/junshi.conf.bak.mino.<ts> /etc/nginx/conf.d/junshi.conf && sudo nginx -t && sudo systemctl reload nginx`。
- **务必用 `systemctl reload nginx`（非 restart）**，reload 零停机、不打断 junshi。

## 文件清单（`deploy/mino/`）

- `config.env` —— 单一配置来源
- `lib.sh` —— 公共库（加载配置 + SSH 助手）
- `01-provision.sh` / `02-deploy.sh` / `03-nginx.sh` —— 三步部署脚本
- `.env.production.example` —— 服务器 `.env` 模板（占位符由 provision 替换）
- `mino-api.service` —— systemd 单元模板
- `nginx-api_mino.location.conf` —— 新增的 nginx location 片段
