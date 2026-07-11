#!/usr/bin/env bash
# 公共库：加载配置 + 定义 SSH/SCP 助手。被 01/02/03 脚本 source。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/config.env"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

# 在服务器上执行一段命令（通过 stdin 传入，避免转义地狱）
rexec() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" bash -s; }
# 在服务器上执行单行命令
rrun()  { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@"; }

log()  { printf '\033[1;36m[mino-deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[mino-deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[mino-deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
