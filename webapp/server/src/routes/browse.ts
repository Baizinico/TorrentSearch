/**
 * GET /api/browse/latest — SSE 流式：浏览最新种子
 * GET /api/browse/top    — SSE 流式：浏览热门种子
 *
 * Query 参数：
 *   category             — Category（默认 All）
 *   providerIds          — 重复 key（?id=a&id=b）或 JSON 字符串
 *   torznabConfigs       — JSON 字符串
 *   cloudflareUnlocked   — JSON 字符串或逗号分隔
 */

import { Router } from 'express';
import {
  gateway,
  parseCategory,
  parseProviderIds,
  parseTorznabConfigs,
  parseUnlockedIds,
  setSseHeaders,
  writeSseEvent,
} from './_shared.js';

export const browseRouter = Router();

/** 通用 SSE 浏览处理器 */
async function handleBrowse(
  req: import('express').Request,
  res: import('express').Response,
  mode: 'latest' | 'top',
): Promise<void> {
  const category = parseCategory(req.query.category, 'All');
  const providerIds = parseProviderIds(req.query.providerIds ?? req.query.id);
  const torznabConfigs = parseTorznabConfigs(req.query.torznabConfigs);
  const cloudflareUnlocked = parseUnlockedIds(req.query.cloudflareUnlocked);

  setSseHeaders(res);

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const gen =
      mode === 'latest'
        ? gateway.getLatestTorrents(
            category,
            providerIds,
            torznabConfigs,
            cloudflareUnlocked,
            abortController.signal,
          )
        : gateway.getTopTorrents(
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
}

browseRouter.get('/browse/latest', (req, res) => handleBrowse(req, res, 'latest'));
browseRouter.get('/browse/top', (req, res) => handleBrowse(req, res, 'top'));
