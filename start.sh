#!/usr/bin/env bash
# TorrentSearch Web 一键启动脚本（Linux / macOS / Git Bash）
# 用法：./start.sh [dev|prod|build]
#   无参数 = dev 开发模式
#   prod   = 生产模式（先 build 再 start）
#   build  = 仅构建

set -e

cd "$(dirname "$0")/webapp"

# 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请安装 Node.js 20+ 后重试。"
  echo "       下载：https://nodejs.org/"
  exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
  echo "[信息] 首次运行，正在安装依赖..."
  npm install
fi

MODE="${1:-dev}"

case "$MODE" in
  dev)
    echo "[启动] 开发模式（前端 :5173 / 后端 :3001）"
    npm run dev
    ;;
  build)
    echo "[构建] 生产构建..."
    npm run build
    ;;
  prod)
    echo "[构建] 生产构建..."
    npm run build
    echo "[启动] 生产模式（单端口 :3000）"
    npm start
    ;;
  *)
    echo "[错误] 未知参数：$MODE"
    echo "用法：./start.sh [dev|prod|build]"
    exit 1
    ;;
esac
