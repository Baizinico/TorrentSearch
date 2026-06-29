# syntax=docker/dockerfile:1.7

# ==================== 构建阶段 ====================
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 package 元信息利用层缓存
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY tsconfig.base.json ./

# 安装依赖（包含 devDependencies 用于构建）
RUN npm ci --workspaces --include-workspace-root || npm install --workspaces --include-workspace-root

# 复制源码
COPY server ./server
COPY web ./web

# 构建：先后端 tsc，再前端 vite build
RUN npm run build:server
RUN npm run build:web

# 剔除 devDependencies，仅保留 production 依赖
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ==================== 运行阶段 ====================
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="TorrentSearch Web"
LABEL org.opencontainers.image.description="自托管种子聚合搜索（React + Node.js）"
LABEL org.opencontainers.image.source="https://github.com/"

# 安装 tini 处理信号
RUN apk add --no-cache tini

WORKDIR /app

# 复制 package 元信息与 production node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/web/package.json ./web/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/web/node_modules ./web/node_modules

# 复制构建产物
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

# 复制 tsconfig（运行时非必需，但保留以便诊断）
COPY --from=builder /app/tsconfig.base.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
