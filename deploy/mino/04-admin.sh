#!/usr/bin/env bash
# 部署运营后台：静态站 → $ADMIN_WEB_DIR；后台账号 → .env（随机密码，存服务器）；
# nginx 新增 /$ADMIN_PATH/ location（手术式、幂等、备份+校验+回滚）。
# 前置：后端已含 /admin API（先跑过 ./deploy/mino/02-deploy.sh 部署最新后端代码）。
#
# 用法：  ./deploy/mino/04-admin.sh
#   自定义用户名：ADMIN_USER_NAME=ops ./deploy/mino/04-admin.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ -f "$REPO_ROOT/admin/index.html" ] || die "找不到 $REPO_ROOT/admin/index.html（B2 未构建？）"

STAGE=/tmp/mino-admin-stage
log "rsync 后台静态站 → 服务器 $STAGE ..."
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$REPO_ROOT/admin/" "$SSH_HOST:$STAGE/"

log "上传 nginx location 片段 ..."
rrun 'mkdir -p /tmp/mino-deploy'
scp "${SSH_OPTS[@]}" -q "$HERE/nginx-admin.location.conf" "$SSH_HOST:/tmp/mino-deploy/"

log "服务器上：安置静态站 + 配置后台账号 + 打 nginx 补丁 ..."
rexec <<REMOTE
set -euo pipefail
ADMIN_WEB_DIR="$ADMIN_WEB_DIR"; ADMIN_PATH="$ADMIN_PATH"; ADMIN_USER_NAME="$ADMIN_USER_NAME"
DEPLOY_DIR="$DEPLOY_DIR"; SERVICE_USER="$SERVICE_USER"; SERVICE_NAME="$SERVICE_NAME"
SECRET_DIR="$SECRET_DIR"; NGINX_CONF="$NGINX_CONF"; DOMAIN="$DOMAIN"; STAGE="$STAGE"

echo ">> 安置静态站到 \$ADMIN_WEB_DIR"
sudo mkdir -p "\$ADMIN_WEB_DIR"
sudo rsync -a --delete "\$STAGE/" "\$ADMIN_WEB_DIR/"
# nginx 需能读；目录 755 / 文件 644
sudo find "\$ADMIN_WEB_DIR" -type d -exec chmod 755 {} \;
sudo find "\$ADMIN_WEB_DIR" -type f -exec chmod 644 {} \;

echo ">> 后台账号（写入 .env；密码仅首次随机生成，存 \$SECRET_DIR/.admin_pass）"
ENV_FILE="\$DEPLOY_DIR/.env"
if [ ! -f "\$SECRET_DIR/.admin_pass" ]; then
  openssl rand -base64 18 | tr -d '/+=' | cut -c1-20 | sudo tee "\$SECRET_DIR/.admin_pass" >/dev/null
  sudo chown "\$SERVICE_USER:\$SERVICE_USER" "\$SECRET_DIR/.admin_pass"; sudo chmod 600 "\$SECRET_DIR/.admin_pass"
fi
ADMIN_PASS="\$(sudo cat "\$SECRET_DIR/.admin_pass")"
# 幂等写入 ADMIN_USER / ADMIN_PASS（存在则替换，否则追加）
set_env() {
  local k="\$1" v="\$2"
  if sudo grep -qE "^\${k}=" "\$ENV_FILE"; then
    sudo sed -i -E "s|^\${k}=.*|\${k}=\${v}|" "\$ENV_FILE"
  else
    echo "\${k}=\${v}" | sudo tee -a "\$ENV_FILE" >/dev/null
  fi
}
set_env ADMIN_USER "\$ADMIN_USER_NAME"
set_env ADMIN_PASS "\$ADMIN_PASS"
sudo chown "\$SERVICE_USER:\$SERVICE_USER" "\$ENV_FILE"; sudo chmod 600 "\$ENV_FILE"

echo ">> 重启后端加载后台账号"
sudo systemctl restart "\$SERVICE_NAME"; sleep 2
curl -fsS "http://127.0.0.1:$UPSTREAM_PORT/health" >/dev/null && echo "   后端健康"

echo ">> nginx：新增 /\$ADMIN_PATH/ location（幂等）"
if sudo grep -q "location /\${ADMIN_PATH}/" "\$NGINX_CONF"; then
  echo "   已存在，跳过"
else
  TS=\$(date +%Y%m%d-%H%M%S); BAK="\${NGINX_CONF}.bak.minoadmin.\${TS}"
  sudo cp "\$NGINX_CONF" "\$BAK"; echo "   备份 → \$BAK"
  # 片段占位替换
  sudo sed -e "s|__ADMIN_PATH__|\${ADMIN_PATH}|g" -e "s|__ADMIN_WEB_DIR__|\${ADMIN_WEB_DIR}|g" \
    /tmp/mino-deploy/nginx-admin.location.conf | sudo tee /tmp/mino-deploy/admin.rendered.conf >/dev/null
  sudo python3 - "\$NGINX_CONF" /tmp/mino-deploy/admin.rendered.conf "\$DOMAIN" <<'PY'
import sys
conf, snip, domain = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(conf, encoding='utf-8').read()
snippet = open(snip, encoding='utf-8').read().rstrip('\n') + '\n'
blocks, i = [], 0
while True:
    idx = src.find('server', i)
    if idx == -1: break
    b = src.find('{', idx)
    if b == -1: break
    d, j = 0, b
    while j < len(src):
        if src[j] == '{': d += 1
        elif src[j] == '}':
            d -= 1
            if d == 0: break
        j += 1
    blocks.append((b, j)); i = j + 1
tgt = next(((b, c) for (b, c) in blocks if domain in src[b:c] and 'listen 443' in src[b:c]), None)
if not tgt:
    sys.stderr.write('FATAL: 未找到 %s 的 443 server 块\n' % domain); sys.exit(2)
b, c = tgt
open(conf, 'w', encoding='utf-8').write(src[:c] + '\n' + snippet + src[c:])
print('   已插入 admin location')
PY
fi

echo ">> nginx -t + reload"
if sudo nginx -t; then sudo systemctl reload nginx; echo "   reload 完成"; else
  echo "!! nginx -t 失败，回滚"; LB=\$(ls -t \${NGINX_CONF}.bak.minoadmin.* 2>/dev/null | head -1 || true)
  [ -n "\$LB" ] && sudo cp "\$LB" "\$NGINX_CONF"; exit 1
fi

echo
echo "================ 后台已就绪 ================"
echo " 地址： https://\$DOMAIN/\$ADMIN_PATH/"
echo " 用户： \$ADMIN_USER_NAME"
echo " 密码： 见服务器 \$SECRET_DIR/.admin_pass （sudo cat 查看）"
echo "==========================================="
REMOTE

log "04-admin 完成。打开 https://$DOMAIN/$ADMIN_PATH/ 登录。"
