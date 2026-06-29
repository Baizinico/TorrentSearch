/**
 * POST /api/torznab/check — 检测 Torznab 索引器连接
 *
 * Body: { url, apiKey }
 * 响应: TorznabCheckResult
 *   { status: 'established' }
 *   { status: 'invalid_api_key' }
 *   { status: 'connection_failed', message }
 *   { status: 'application_error', code }
 *   { status: 'unexpected_response', code }
 *   { status: 'unexpected_error', message }
 */

import { Router } from 'express';
import { z } from 'zod';
import { TorznabSearchProvider } from '../providers/TorznabSearchProvider.js';

export const torznabRouter = Router();

const CheckBodySchema = z.object({
  url: z.string().url().max(2048),
  apiKey: z.string().min(1).max(512),
});

torznabRouter.post('/torznab/check', async (req, res) => {
  const parsed = CheckBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_request',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { url, apiKey } = parsed.data;
  try {
    const result = await TorznabSearchProvider.checkConnection(url, apiKey);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ status: 'unexpected_error', message });
  }
});
