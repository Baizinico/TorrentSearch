import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { browseRouter } from './routes/browse.js';
import { detailsRouter } from './routes/details.js';
import { providersRouter } from './routes/providers.js';
import { searchRouter } from './routes/search.js';
import { torznabRouter } from './routes/torznab.js';
import { trackersRouter } from './routes/trackers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

/** 信任反代头（部署在 Nginx 后时获取真实 IP） */
app.set('trust proxy', 1);

/** JSON body 解析（POST /api/search、/api/torznab/check 等） */
app.use(express.json({ limit: '1mb' }));

/** CORS：开发模式放开（Vite dev server 5173 → :3001），生产同源无需 */
if (!config.isProd) {
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    }),
  );
}

/** 健康检查 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/** API 路由 */
app.use('/api', searchRouter);
app.use('/api', browseRouter);
app.use('/api', detailsRouter);
app.use('/api', providersRouter);
app.use('/api', torznabRouter);
app.use('/api', trackersRouter);

/**
 * 生产模式：托管前端构建产物（web/dist）。
 * SPA fallback：所有非 /api 路径返回 index.html，交由 React Router 处理。
 */
if (config.isProd) {
  const webDist = path.resolve(__dirname, config.webDistPath);
  app.use(express.static(webDist, { index: 'index.html' }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

/** 全局错误处理 */
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[server] unhandled error:', message);
    res.status(500).json({ error: 'internal_error', message });
  },
);

app.listen(config.port, () => {
  console.log(
    `[TorrentSearch] server listening on http://localhost:${config.port} ` +
      `(${config.isProd ? 'prod' : 'dev'} mode)`,
  );
});
