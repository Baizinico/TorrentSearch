# TorrentSearch Web

自托管种子聚合搜索 Web 版 —— 一次查询，全网种子，即搜即得。

后端 Node.js + Express 聚合 34 个内置源与任意 Torznab 索引器，前端 React + Vite 流式渲染（SSE），书签/历史/设置全部通过 localStorage 本地持久化，无需数据库。

## 特性

- **35 个源**：34 内置 provider + 任意数量的 Torznab 索引器（Jackett / Prowlarr 兼容）
- **SSE 流式搜索**：每个 provider 完成即推送，结果按完成顺序追加
- **类别过滤**：All / Anime / Apps / Books / Games / Movies / Music / Porn / Series / Other
- **详情页**：海报、截图、描述（Markdown）、magnet / .torrent 下载、书签
- **Cloudflare 解锁**：通过 FlareSolverr 适配 6 个 CF 保护的源
- **本地持久化**：书签、搜索历史、已浏览标记、Torznab 配置、主题等
- **暗色优先 UI**：琥珀金 + 青蓝 + 炭灰配色，支持纯黑 OLED 模式
- **响应式**：桌面左侧导航，移动端底部 tab bar
- **单进程一体化**：生产模式 Node 托管前端静态资源，单端口访问

## 技术栈

- **Monorepo**：npm workspaces（`server/` + `web/`）
- **后端**：Node.js 20+ / Express 4 / axios / cheerio / fast-xml-parser / tough-cookie / zod / p-limit
- **前端**：React 18 / Vite 5 / TypeScript 5 / Tailwind CSS 3 / React Router 6 / Zustand 4 / TanStack Query / @tanstack/react-virtual / lucide-react / react-markdown / dayjs

## 开发

```bash
# 安装依赖
npm install

# 并行启动后端（:3001）与前端（:5173）
npm run dev
```

打开 http://localhost:5173 即可。前端通过 Vite proxy 转发 `/api` 到后端。

## 生产构建

```bash
# 构建前端（web/dist）+ 后端（server/dist）
npm run build

# 启动单进程服务（端口 3000）
npm start
```

打开 http://localhost:3000 即可，前端与 API 同源。

## Docker 部署

```bash
# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f torrentsearch
```

服务暴露在 http://localhost:3000 。

如需解锁 Cloudflare 保护的源，取消 `docker-compose.yml` 中 `flaresolverr` 服务的注释，启动后在 Web UI 的「设置 → 高级 → FlareSolverr URL」填入 `http://flaresolverr:8191`，再到「Provider 管理」对应源点击「解锁」。

## 项目结构

```
webapp/
├── package.json              # monorepo 根
├── tsconfig.base.json
├── Dockerfile
├── docker-compose.yml
├── server/                   # 后端
│   ├── src/
│   │   ├── index.ts          # Express 入口
│   │   ├── config.ts
│   │   ├── types.ts          # 共享类型（前后端复用）
│   │   ├── http/             # HttpClient + FlareSolverr
│   │   ├── gateway/          # SearchProvidersGateway
│   │   ├── providers/        # 34 个 provider + Torznab
│   │   └── routes/           # API 路由
│   └── package.json
└── web/                      # 前端
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx           # 路由
    │   ├── layouts/          # RootLayout
    │   ├── pages/            # Home / Search / Browse / Details / ...
    │   ├── components/       # 通用组件
    │   ├── hooks/            # useSearchStream / useProviders / ...
    │   ├── stores/           # Zustand stores
    │   ├── lib/              # api / torrent-utils
    │   └── types.ts          # re-export 后端类型
    └── package.json
```

## API 速览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/search` | SSE 流式搜索，body: `{ query, category, providerIds, torznabConfigs, cloudflareUnlocked }` |
| GET | `/api/browse/latest` | SSE 流式浏览最新，query: `category, providerIds, torznabConfigs, cloudflareUnlocked` |
| GET | `/api/browse/top` | SSE 流式浏览热门 |
| GET | `/api/details` | 获取种子详情，query: `url, provider, torznabConfigs` |
| GET | `/api/providers` | 返回所有内置 provider 元信息 |
| POST | `/api/torznab/check` | 检测 Torznab 索引器连接 |
| GET | `/api/trackers` | 返回公共 tracker 列表 |
| GET | `/api/health` | 健康检查 |

## 隐私

所有用户数据（书签、历史、设置、Torznab 配置）保存在浏览器 localStorage，**不会**上传到服务器。后端仅代理抓取源站内容。

## License

MIT
