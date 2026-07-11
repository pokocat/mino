#!/usr/bin/env bash
# 可重复的应用部署：rsync 源码 → npm ci → prisma migrate deploy → build → 重启 systemd → 健康检查。
# 不触碰 .env（保留手配凭据）、不动 node_modules 之外的机密。
#
# 用法：  ./deploy/mino/02-deploy.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ -d "$REPO_ROOT/server" ] || die "找不到 $REPO_ROOT/server"

STAGE=/tmp/mino-server-stage
log "rsync 源码 → 服务器 $STAGE（排除 node_modules/dist/.env/test 等）..."
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude 'node_modules' --exclude 'dist' --exclude '.env' --exclude '.env.*' \
  --exclude 'coverage' --exclude 'test' --exclude '*.spec.ts' \
  "$REPO_ROOT/server/" "$SSH_HOST:$STAGE/"

log "服务器上：安置代码 + 构建 + 迁移 + 重启（以 $SERVICE_USER 用户构建）..."
rexec <<REMOTE
set -euo pipefail
DEPLOY_DIR="$DEPLOY_DIR"; SERVICE_USER="$SERVICE_USER"; SERVICE_NAME="$SERVICE_NAME"
UPSTREAM_PORT="$UPSTREAM_PORT"; STAGE="$STAGE"

echo ">> 安置代码到 \$DEPLOY_DIR（保护 .env / node_modules，不被删除）"
sudo rsync -a --delete \
  --exclude '.env' --exclude '.env.*' --exclude 'node_modules' \
  "\$STAGE/" "\$DEPLOY_DIR/"
sudo chown -R "\$SERVICE_USER:\$SERVICE_USER" "\$DEPLOY_DIR"

echo ">> 依赖 + 生成 + 迁移 + 构建"
sudo -u "\$SERVICE_USER" bash -lc "cd '\$DEPLOY_DIR' && \
  npm ci && \
  npx prisma generate && \
  npx prisma migrate deploy && \
  npm run build"

echo ">> 启用并重启服务"
sudo systemctl enable "\$SERVICE_NAME" >/dev/null 2>&1 || true
sudo systemctl restart "\$SERVICE_NAME"
sleep 2

echo ">> 本机健康检查 http://127.0.0.1:\$UPSTREAM_PORT/health"
for i in 1 2 3 4 5 6 7 8; do
  if curl -fsS "http://127.0.0.1:\$UPSTREAM_PORT/health"; then echo; echo "OK"; break; fi
  echo "…等待服务起来（\$i）"; sleep 2
  if [ "\$i" = 8 ]; then echo "健康检查失败，最近日志："; sudo journalctl -u "\$SERVICE_NAME" -n 40 --no-pager; exit 1; fi
done
REMOTE

log "02-deploy 完成。首次部署后执行一次：./deploy/mino/03-nginx.sh"
