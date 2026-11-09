#!/usr/bin/env bash
# AI 每日自动签到启动器（供 Git Bash / WSL / crontab 调用）
# 用法：run-checkin.sh [trae|workbuddy|all] [--status] [--json] [--check]
DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v node >/dev/null 2>&1; then
  exec node "$DIR/checkin.js" "$@"
fi
for P in /usr/local/bin/node /usr/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do
  if [ -x "$P" ]; then exec "$P" "$DIR/checkin.js" "$@"; fi
done
echo "[错误] 未找到 node，请安装 Node.js >= 16"
exit 2
