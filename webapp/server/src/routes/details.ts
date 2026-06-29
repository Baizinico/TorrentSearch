/**
 * GET /api/details — 抓取种子详情
 *
 * Query 参数：
 *   url              — 详情页 URL（必填）
 *   provider         — provider 显示名（可选，用于 fallback）
 *   torznabConfigs   — JSON 字符串（可选）
 *
 * 响应：GetTorrentDetailsResponse
 *   { status: 'success', details }
 *   { status: 'unsupported' }
 *   { status: 'unavailable' }
 */

import { Router } from 'express';
import { gateway, parseTorznabConfigs } from './_shared.js';

export const detailsRouter = Router();

detailsRouter.get('/details', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  const provider =
    typeof req.query.provider === 'string' ? req.query.provider : '';
  const torznabConfigs = parseTorznabConfigs(req.query.torznabConfigs);

  if (!url) {
    res.status(400).json({ error: 'missing_url', message: 'url query param is required' });
    return;
  }

  try {
    const result = await gateway.getTorrentDetails(url, provider, torznabConfigs);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[details] error:', message);
    res.json({ status: 'unavailable' });
  }
});
