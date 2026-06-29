/**
 * Knaben Provider
 * 对应原 Kotlin providers/Knaben.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 使用 official Knaben API (POST https://api.knaben.org/v1)。
 */

import type { Category, Torrent } from '../types.js';
import type {
  SearchContext,
  SearchProvider,
  LatestTorrentsProvider,
  TopTorrentsProvider,
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import {
  formatBytes,
  makeTorrent,
  parseInfoHashFromMagnet,
  parseIso,
} from './_shared.js';

const API_URL = 'https://api.knaben.org';

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function getStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function getNum(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function getArr(obj: Record<string, unknown>, key: string): unknown[] | null {
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}

/** Maps the internal Category enum to a list of Knaben category IDs. */
function getKnabenCategoryIds(category: Category): number[] {
  switch (category) {
    case 'All':
      return [];
    case 'Music':
      return [1000000];
    case 'Series':
      return [2000000];
    case 'Movies':
      return [3000000];
    case 'Apps':
      return [4000000];
    case 'Porn':
      return [5000000];
    case 'Anime':
      return [6000000];
    case 'Games':
      return [7000000];
    case 'Books':
      return [9000000];
    case 'Other':
      return [10000000];
  }
}

/**
 * Infers the Category from Knaben's numeric categoryId list.
 * Uses the smallest (most specific) ID for classification.
 */
function extractCategory(obj: Record<string, unknown>): Category {
  const arr = getArr(obj, 'categoryId');
  if (!arr) return 'All';
  const ids = arr
    .map((it) => {
      const n = Number(it);
      return Number.isNaN(n) ? null : n;
    })
    .filter((n): n is number => n !== null);
  if (ids.length === 0) return 'All';
  const firstId = Math.min(...ids);
  if (firstId >= 1000000 && firstId <= 1999999) return 'Music';
  if (firstId >= 2000000 && firstId <= 2999999) return 'Series';
  if (firstId >= 3000000 && firstId <= 3999999) return 'Movies';
  if (firstId >= 4000000 && firstId <= 4999999) return 'Apps';
  if (firstId >= 5000000 && firstId <= 5999999) return 'Porn';
  if (firstId >= 6000000 && firstId <= 6999999) return 'Anime';
  if (firstId >= 7000000 && firstId <= 7999999) return 'Games';
  if (firstId >= 9000000 && firstId <= 9999999) return 'Books';
  if (firstId >= 10000000 && firstId <= 10999999) return 'Other';
  return 'All';
}

function parseResultsJson(json: unknown, providerName: string): Torrent[] {
  const root = asRecord(json);
  if (!root) return [];
  const hits = getArr(root, 'hits');
  if (!hits) return [];
  const torrents: Torrent[] = [];
  for (const h of hits) {
    const obj = asRecord(h);
    if (!obj) continue;
    const t = parseTorrentObject(obj, providerName);
    if (t) torrents.push(t);
  }
  return torrents;
}

function parseTorrentObject(
  obj: Record<string, unknown>,
  providerName: string,
): Torrent | null {
  const name = getStr(obj, 'title');
  if (name === null) return null;
  const magnetUri = getStr(obj, 'magnetUrl');
  if (magnetUri === null) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  const bytes = getNum(obj, 'bytes');
  const size = bytes !== null ? formatBytes(bytes) : '0 KB';

  const seeders = getNum(obj, 'seeders') ?? 0;
  const peers = getNum(obj, 'peers') ?? 0;
  const dateStr = getStr(obj, 'date');
  const uploadDate = dateStr !== null ? parseIso(dateStr) : null;
  const descriptionPageUrl = getStr(obj, 'details') ?? '';
  const category = extractCategory(obj);

  return makeTorrent({
    infoHash,
    name,
    size,
    seeders,
    peers,
    providerName,
    providerId: 'knaben',
    uploadDate,
    category,
    descriptionPageUrl,
    magnetUri,
  });
}

/** Builds the API request payload. */
function buildRequestBody(
  query: string | null,
  category: Category,
  orderBy: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    size: 300,
    order_by: orderBy,
    order_direction: 'desc',
    hide_unsafe: true,
    hide_xxx: false, // TODO: NSFW can be implemented here
  };
  if (query !== null) body.query = query;
  const categoryIds = getKnabenCategoryIds(category);
  if (categoryIds.length > 0) body.categories = categoryIds;
  return body;
}

export class KnabenProvider
  implements SearchProvider, LatestTorrentsProvider, TopTorrentsProvider
{
  readonly id = 'knaben';
  readonly name = 'Knaben';
  readonly url = 'https://knaben.org';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Books',
    'Games',
    'Movies',
    'Music',
    'Other',
    'Porn',
    'Series',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = true;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { latest: true, top: true } as const;

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestBody = buildRequestBody(query, ctx.category, 'seeders');
    const json = await ctx.httpClient.postJson(`${API_URL}/v1`, requestBody);
    if (json === null) return [];
    return parseResultsJson(json, this.name);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const requestBody = buildRequestBody(null, category, 'date');
    const json = await getDefaultHttpClient().postJson(`${API_URL}/v1`, requestBody);
    if (json === null) return [];
    return parseResultsJson(json, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const requestBody = buildRequestBody(null, category, 'seeders');
    const json = await getDefaultHttpClient().postJson(`${API_URL}/v1`, requestBody);
    if (json === null) return [];
    return parseResultsJson(json, this.name);
  }
}
