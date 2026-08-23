#!/bin/zsh
set -e

cd "$(dirname "$0")"
echo "正在启动 Chat Arena 离线 Demo…"
echo "浏览器地址：http://127.0.0.1:4173"
(sleep 1; open "http://127.0.0.1:4173") &
exec npm run demo
