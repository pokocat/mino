#!/usr/bin/env bash
# 一次性基础设施准备（幂等）：系统用户 / 目录 / PostgreSQL 库角色 / redis 容器 / 机密 / .env / systemd 单元。
# 不改动任何既有 junshi 资源，只做「新增」。可重复运行。
#
# 用法：  ./deploy/mino/01-provision.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "同步部署脚本与模板到服务器 /tmp/mino-deploy ..."
rrun 'rm -rf /tmp/mino-deploy && mkdir -p /tmp/mino-deploy'
scp "${SSH_OPTS[@]}" -q \
  "$HERE/.env.production.example" "$HERE/mino-api.service" "$HERE/nginx-api_mino.location.conf" \
  "$SSH_HOST:/tmp/mino-deploy/"

log "在服务器上执行基础设施准备（sudo，幂等）..."
rexec <<REMOTE
set -euo pipefail

SERVICE_USER="$SERVICE_USER"
DEPLOY_DIR="$DEPLOY_DIR"
SECRET_DIR="$SECRET_DIR"
PG_DB="$PG_DB"; PG_USER="$PG_USER"; PG_HOST="$PG_HOST"; PG_PORT="$PG_PORT"
UPSTREAM_PORT="$UPSTREAM_PORT"; REDIS_PORT="$REDIS_PORT"; REDIS_CONTAINER="$REDIS_CONTAINER"
SERVICE_NAME="$SERVICE_NAME"

echo ">> 确认 rsync 存在"
command -v rsync >/dev/null 2>&1 || sudo dnf install -y rsync

echo ">> 确认端口 \$UPSTREAM_PORT 空闲"
if ss -tlnp 2>/dev/null | grep -q ":\${UPSTREAM_PORT} "; then
  echo "端口 \$UPSTREAM_PORT 已被占用，请改 UPSTREAM_PORT 后重试"; exit 1
fi

echo ">> 系统用户 \$SERVICE_USER"
id "\$SERVICE_USER" >/dev/null 2>&1 || sudo useradd -r -m -d "\$SECRET_DIR" -s /usr/sbin/nologin "\$SERVICE_USER"

echo ">> 目录 \$DEPLOY_DIR"
sudo mkdir -p "\$DEPLOY_DIR"
sudo chown -R "\$SERVICE_USER:\$SERVICE_USER" "\$SECRET_DIR"

echo ">> 机密：数据库密码 / JWT 密钥（仅首次生成）"
if [ ! -f "\$SECRET_DIR/.db_pass" ]; then
  openssl rand -hex 24 | sudo tee "\$SECRET_DIR/.db_pass" >/dev/null
  sudo chown "\$SERVICE_USER:\$SERVICE_USER" "\$SECRET_DIR/.db_pass"; sudo chmod 600 "\$SECRET_DIR/.db_pass"
fi
if [ ! -f "\$SECRET_DIR/.jwt_secret" ]; then
  openssl rand -hex 32 | sudo tee "\$SECRET_DIR/.jwt_secret" >/dev/null
  sudo chown "\$SERVICE_USER:\$SERVICE_USER" "\$SECRET_DIR/.jwt_secret"; sudo chmod 600 "\$SECRET_DIR/.jwt_secret"
fi
DB_PASS="\$(sudo cat "\$SECRET_DIR/.db_pass")"
JWT_SECRET="\$(sudo cat "\$SECRET_DIR/.jwt_secret")"

echo ">> PostgreSQL：角色 \$PG_USER + 库 \$PG_DB（UTF8，独立于 junshi）"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='\$PG_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE \$PG_USER LOGIN PASSWORD '\$DB_PASS'"
# 确保密码与 .db_pass 一致（幂等修正）
sudo -u postgres psql -c "ALTER ROLE \$PG_USER WITH PASSWORD '\$DB_PASS'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='\$PG_DB'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE \$PG_DB OWNER \$PG_USER ENCODING 'UTF8' TEMPLATE template0"

echo ">> pgvector 扩展（per-user 记忆链路依赖；由 postgres 超级用户建，app 用户迁移里的 CREATE EXTENSION IF NOT EXISTS 随后为幂等 no-op）"
PG_MAJOR="\$(sudo -u postgres psql -tAc "SELECT current_setting('server_version_num')::int/10000")"
echo "   共享 PostgreSQL 大版本：\$PG_MAJOR"
if ! sudo -u postgres psql -d "\$PG_DB" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" | grep -q 1; then
  echo "   pgvector 未就绪，尝试 dnf 安装 pgvector_\$PG_MAJOR ..."
  # PGDG 包名形如 pgvector_16；退化尝试无版本后缀；都失败则给出源码编译提示并中止
  sudo dnf install -y "pgvector_\$PG_MAJOR" || sudo dnf install -y pgvector || {
    echo "   !! 无法通过 dnf 安装 pgvector（可能未启用 PGDG 源或包名不同）。"
    echo "      请手动安装后重跑本脚本，例如源码编译："
    echo "        sudo dnf install -y git make gcc redhat-rpm-config postgresql\${PG_MAJOR}-devel"
    echo "        git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git"
    echo "        cd pgvector && make && sudo make install"
    exit 1
  }
fi
sudo -u postgres psql -d "\$PG_DB" -c 'CREATE EXTENSION IF NOT EXISTS vector'
sudo -u postgres psql -d "\$PG_DB" -tAc "SELECT 'pgvector_ok ' || extversion FROM pg_extension WHERE extname='vector'"

echo ">> redis 专属容器 \$REDIS_CONTAINER（127.0.0.1:\$REDIS_PORT）"
if ! docker ps -a --format '{{.Names}}' | grep -qx "\$REDIS_CONTAINER"; then
  docker run -d --name "\$REDIS_CONTAINER" --restart always \
    -p 127.0.0.1:\${REDIS_PORT}:6379 -v mino_redis_data:/data \
    redis:7 redis-server --appendonly yes
else
  docker start "\$REDIS_CONTAINER" >/dev/null 2>&1 || true
fi

echo ">> 生成 /opt/mino/server/.env（已存在则保留，不覆盖手配的 LLM/微信凭据）"
ENV_FILE="\$DEPLOY_DIR/.env"
if [ ! -f "\$ENV_FILE" ]; then
  sudo cp /tmp/mino-deploy/.env.production.example "\$ENV_FILE"
  sudo sed -i \
    -e "s|__PORT__|\$UPSTREAM_PORT|g" \
    -e "s|__PG_USER__|\$PG_USER|g" \
    -e "s|__PG_PASS__|\$DB_PASS|g" \
    -e "s|__PG_HOST__|\$PG_HOST|g" \
    -e "s|__PG_PORT__|\$PG_PORT|g" \
    -e "s|__PG_DB__|\$PG_DB|g" \
    -e "s|__REDIS_PORT__|\$REDIS_PORT|g" \
    -e "s|__JWT_SECRET__|\$JWT_SECRET|g" \
    "\$ENV_FILE"
  sudo chown "\$SERVICE_USER:\$SERVICE_USER" "\$ENV_FILE"; sudo chmod 600 "\$ENV_FILE"
  echo "   已生成 .env"
else
  echo "   .env 已存在，跳过"
fi

echo ">> 安装 systemd 单元 \$SERVICE_NAME.service"
sudo sed \
  -e "s|__DEPLOY_DIR__|\$DEPLOY_DIR|g" \
  -e "s|__SERVICE_USER__|\$SERVICE_USER|g" \
  -e "s|__UPSTREAM_PORT__|\$UPSTREAM_PORT|g" \
  /tmp/mino-deploy/mino-api.service | sudo tee /etc/systemd/system/\$SERVICE_NAME.service >/dev/null
sudo systemctl daemon-reload

echo ">> 基础设施就绪。redis: \$(docker inspect -f '{{.State.Status}}' \$REDIS_CONTAINER 2>/dev/null)"
sudo -u postgres psql -tAc "SELECT 'db_ok' FROM pg_database WHERE datname='\$PG_DB'"
REMOTE

log "01-provision 完成。下一步：./deploy/mino/02-deploy.sh"
