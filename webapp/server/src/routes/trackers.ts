/**
 * GET /api/trackers — 返回公共 tracker 列表（用于拼接 magnet URI）
 *
 * 响应：{ trackers: string[] }
 */

import { Router } from 'express';
import { PUBLIC_TRACKERS } from '../providers/_shared.js';

export const trackersRouter = Router();

trackersRouter.get('/trackers', (_req, res) => {
  res.json({ trackers: [...PUBLIC_TRACKERS] });
});
