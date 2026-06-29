/**
 * POST /api/search — SSE 流式搜索
 *
 * Body: SearchRequest
 *   { query, category, providerIds, torznabConfigs, cloudflareUnlocked }
 *
 * 响应：text/event-stream
 *   data: { type: 'batch', ... } | { type: 'failure', ... } | { type: 'done', ... }
 */

import { Router } from 'express';
import { z } from 'zod';
import { gateway, setSseHeaders, writeSseEvent } from './_shared.js';

const CategoryEnum = z.enum([
  'All',
  'Anime',
  'Apps',
  'Books',
  'Games',
  'Movies',
  'Music',
  'Porn',
  'Series',
  'Other',
]);

const TorznabConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  apiKey: z.string(),
  category: CategoryEnum,
});

const SearchBodySchema = z.object({
  query: z.string().min(1).max(500),
  category: CategoryEnum.default('All'),
  providerIds: z.array(z.string()).default([]),
  torznabConfigs: z.array(TorznabConfigSchema).default([]),
  cloudflareUnlocked: z.array(z.string()).default([]),
});

export const searchRouter = Router();

searchRouter.post('/search', async (req, res) => {
  const parsed = SearchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_request',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { query, category, providerIds, torznabConfigs, cloudflareUnlocked } = parsed.data;

  setSseHeaders(res);

  // 客户端断开 → abort 搜索
  // 注意：监听 res 的 'close'（响应连接关闭），不是 req 的 'close'（req 在 body 解析后即触发）
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const gen = gateway.searchTorrents(
      query,
      category,
      providerIds,
      torznabConfigs,
      cloudflareUnlocked,
      abortController.signal,
    );
    for await (const event of gen) {
      if (res.writableEnded) break;
      writeSseEvent(res, event);
    }
  } catch (err) {
    if (!res.writableEnded) {
      writeSseEvent(res, {
        type: 'failure',
        providerId: '__gateway__',
        providerName: 'Gateway',
        providerUrl: '',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});
