/**
 * GET /api/providers — 返回所有内置 provider 元信息
 *
 * 响应：{ providers: ProviderInfo[] }
 */

import { Router } from 'express';
import { getProviderInfoList } from '../providers/registry.js';

export const providersRouter = Router();

providersRouter.get('/providers', (_req, res) => {
  res.json({ providers: getProviderInfoList() });
});
