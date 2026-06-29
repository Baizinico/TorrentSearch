<div align="center">

# TorrentSearch Web

**自托管种子聚合搜索 · Web 版**

一次查询，全网种子，即搜即得。

</div>

> **Origin**: 本项目是 [`prajwalch/TorrentSearch`](https://github.com/prajwalch/TorrentSearch)（Android / Kotlin / Jetpack Compose 原生应用）的 Web 分支，使用 React + Node.js 完全重写，保留原项目的全部 34 个内置 provider 与 Torznab 兼容能力，并重新设计了流式 UI 与浏览器本地持久化方案。感谢原作者 [@prajwalch](https://github.com/prajwalch) 的工作。

## 特性

- **35 个源**：34 内置 provider + 任意数量的 Torznab 索引器（Jackett / Prowlarr 兼容）
- **SSE 流式搜索**：每个 provider 完成即推送，结果按完成顺序追加，无需等待全部源
- **类别过滤**：All / Anime / Apps / Books / Games / Movies / Music / Porn / Series / Other
- **浏览模式**：latest / top 双 tab，按类别与 provider 过滤
- **详情页**：海报、截图、描述（Markdown）、magnet / .torrent 下载、原页面跳转
- **Cloudflare 解锁**：通过 FlareSolverr 适配 6 个 CF 保护的源
- **本地持久化**：书签、已浏览标记、Torznab 配置、主题、Provider 启用状态全部通过 localStorage 本地保存，无需数据库
- **暗色 / 亮色双主题**：琥珀金 + 青蓝 + 炭灰配色，支持纯黑 OLED 模式
- **响应式**：桌面左侧导航，移动端底部 tab bar
- **单进程一体化**：生产模式 Node 托管前端静态资源，单端口访问
- **Docker 部署**：多阶段构建，开箱即用

## 技术栈

- **Monorepo**：npm workspaces（`server/` + `web/`）
- **后端**：Node.js 20+ / Express 4 / axios / cheerio / fast-xml-parser / tough-cookie / zod / p-limit
- **前端**：React 18 / Vite 5 / TypeScript 5 / Tailwind CSS 3 / React Router 6 / Zustand 4（persist）/ TanStack Query / @tanstack/react-virtual / lucide-react / react-markdown / dayjs

## 快速开始

### 开发模式

```bash
cd webapp
npm install
npm run dev
```

- 前端：http://localhost:5173 （Vite dev server）
- 后端：http://localhost:3001 （Express，自动代理 `/api`）

### 生产模式

```bash
cd webapp
npm install
npm run build    # 编译前后端
npm start        # 单端口 :3000 托管 API + 静态资源
```

访问 http://localhost:3000 即可。

### Docker 部署

```bash
cd webapp
docker compose up --build -d
```

可选：取消 `docker-compose.yml` 中的 `flaresolverr` 服务注释以解锁 Cloudflare 保护的源。

## 项目结构

```
webapp/
├── server/                  # 后端 — Express + Provider 体系
│   ├── src/
│   │   ├── providers/       # 34 个内置 provider + Torznab + 基类与注册表
│   │   ├── gateway/         # 并发调度 + AsyncGenerator 流式聚合
│   │   ├── http/            # HttpClient + FlareSolverr 适配
│   │   ├── routes/          # /api/search /browse /details /providers /torznab /trackers
│   │   ├── config.ts
│   │   ├── index.ts         # Express 入口（生产 SPA fallback）
│   │   └── types.ts
│   └── package.json
├── web/                     # 前端 — React + Vite + Tailwind
│   ├── src/
│   │   ├── components/      # search / torrent / ui 三层组件
│   │   ├── hooks/           # useSearchStream / useBrowseStream / useProviders / useTheme / useTorrentDetails
│   │   ├── layouts/         # RootLayout（左侧导航 + 移动端 tab bar）
│   │   ├── lib/             # api / torrent-utils
│   │   ├── pages/           # Home / Search / Browse / Details / Bookmarks / Settings / Providers / TorznabEdit / NotFound
│   │   ├── stores/          # bookmarks / settings / torznab / viewed（Zustand + persist）
│   │   ├── App.tsx          # 路由树
│   │   ├── index.css        # Tailwind + CSS 变量主题
│   │   └── types.ts
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── package.json
├── Dockerfile               # 多阶段构建
├── docker-compose.yml
└── package.json             # monorepo 根
```

## API 速览

| 路径 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/providers` | GET | 列出全部内置 provider（id / name / url / 类别 / capabilities） |
| `/api/search` | POST | SSE 流式搜索，按 provider 完成顺序推送 `batch` / `failure` / `done` 事件 |
| `/api/browse/latest` | POST | SSE 流式 latest 列表 |
| `/api/browse/top` | POST | SSE 流式 top 列表 |
| `/api/details` | GET | 抓取单个 torrent 详情（需 `url` / `provider`） |
| `/api/torznab/check` | POST | 检测 Torznab 索引器连接 |
| `/api/trackers` | GET | 返回推荐 tracker 列表（用于组装 magnet） |

所有 POST 请求体为 JSON，详见 [`webapp/server/src/types.ts`](webapp/server/src/types.ts) 中的 `SearchRequest` / `BrowseRequest`。

## 隐私

- 不内置任何账号系统、不上报任何遥测
- 书签、已浏览标记、设置、Torznab 配置全部保存在浏览器 localStorage
- 后端仅作为 provider 抓取代理，不持久化任何用户数据

## 与上游的差异

| 维度 | 上游 `prajwalch/TorrentSearch` | 本分支 `web-version` |
|---|---|---|
| 平台 | Android 原生 | Web（自托管） |
| 语言 | Kotlin | TypeScript |
| UI | Jetpack Compose / Material 3 | React + Tailwind CSS |
| 状态 | ViewModel + Room | Zustand persist + TanStack Query |
| 持久化 | Room（SQLite） | localStorage |
| Provider 体系 | 34 内置 + Torznab | 34 内置 + Torznab（移植保留） |
| 流式渲染 | Flow | SSE + AsyncGenerator |
| CF 解锁 | — | FlareSolverr 适配 |
| 部署 | APK / F-Droid | Node 单进程 / Docker |

## License

MIT © Prajwal Chapagain（原作者）— 见 [LICENSE](LICENSE)。

本分支延续 MIT 协议，欢迎继续二次开发与自托管部署。
