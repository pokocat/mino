#!/usr/bin/env bash
# 一次性：把 /api_mino/ location 追加进 wxapi.aibuzz.cn 的 443 server 块，然后校验并 reload。
# 手术式、幂等、带备份：只新增一个 location，绝不改动 junshi 现有块；nginx -t 通过才 reload，失败自动回滚。
#
# 用法：  ./deploy/mino/03-nginx.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "上传 location 片段到服务器 ..."
rrun 'mkdir -p /tmp/mino-deploy'
scp "${SSH_OPTS[@]}" -q "$HERE/nginx-api_mino.location.conf" "$SSH_HOST:/tmp/mino-deploy/"

log "在服务器上打补丁（备份 → 插入 → nginx -t → reload；失败回滚）..."
rexec <<REMOTE
set -euo pipefail
NGINX_CONF="$NGINX_CONF"
DOMAIN="$DOMAIN"
API_PREFIX="$API_PREFIX"

if sudo grep -q "location /\${API_PREFIX}/" "\$NGINX_CONF"; then
  echo ">> 已存在 location /\${API_PREFIX}/ ，跳过插入（幂等）"
else
  TS=\$(date +%Y%m%d-%H%M%S)
  BAK="\${NGINX_CONF}.bak.mino.\${TS}"
  echo ">> 备份 \$NGINX_CONF → \$BAK"
  sudo cp "\$NGINX_CONF" "\$BAK"

  echo ">> 用 Python 定位 \$DOMAIN 的 443 server 块并追加 location"
  SNIPPET=/tmp/mino-deploy/nginx-api_mino.location.conf
  sudo python3 - "\$NGINX_CONF" "\$SNIPPET" "\$DOMAIN" <<'PY'
import sys
conf_path, snippet_path, domain = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(conf_path, encoding='utf-8').read()
snippet = open(snippet_path, encoding='utf-8').read().rstrip('\n') + '\n'

# 扫描顶层 server { ... } 块（大括号配对）
blocks = []
i = 0
while True:
    idx = src.find('server', i)
    if idx == -1:
        break
    brace = src.find('{', idx)
    if brace == -1:
        break
    depth = 0
    j = brace
    while j < len(src):
        if src[j] == '{':
            depth += 1
        elif src[j] == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    blocks.append((idx, brace, j))  # start, open-brace, close-brace
    i = j + 1

target = None
for (start, brace, close) in blocks:
    body = src[brace:close]
    if domain in body and 'listen 443' in body:
        target = (start, brace, close)
        break

if target is None:
    sys.stderr.write('FATAL: 未找到 %s 的 443 server 块，未做任何修改\n' % domain)
    sys.exit(2)

start, brace, close = target
# 在该块闭合大括号 } 之前插入片段
new = src[:close] + '\n' + snippet + src[close:]
open(conf_path, 'w', encoding='utf-8').write(new)
print('   已插入 location 到偏移 %d 的 server 块' % start)
PY
fi

echo ">> nginx -t 校验"
if sudo nginx -t; then
  echo ">> reload nginx（零停机，不影响 junshi）"
  sudo systemctl reload nginx
  echo ">> reload 完成"
else
  echo "!! nginx -t 失败，回滚到最近备份"
  LATEST_BAK=\$(ls -t \${NGINX_CONF}.bak.mino.* 2>/dev/null | head -1 || true)
  if [ -n "\$LATEST_BAK" ]; then sudo cp "\$LATEST_BAK" "\$NGINX_CONF"; echo "已回滚 \$LATEST_BAK"; fi
  exit 1
fi
REMOTE

log "03-nginx 完成。端到端验证： curl -fsS https://$DOMAIN/$API_PREFIX/health"
