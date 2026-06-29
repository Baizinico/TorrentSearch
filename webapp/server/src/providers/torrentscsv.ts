/**
 * TorrentsCSV Provider
 * 对应原 Kotlin providers/TorrentsCSV.kt
 *
 * 实现：SearchProvider
 * 使用 torrents-csv.com/service/search JSON API。
 */

import type { Category, Torrent } from '../types.js';
import type { SearchContext, SearchProvider } from './SearchProvider.js';
import { epochSecondToISO, formatBytes, makeTorrent } from './_shared.js';

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

function parseTorrentObject(
  torrentObject: Record<string, unknown>,
  providerName: string,
): Torrent | null {
  const name = getStr(torrentObject, 'name');
  if (name === null) return null;
  const infoHash = getStr(torrentObject, 'infohash');
  if (infoHash === null) return null;

  const sizeBytes = getNum(torrentObject, 'size_bytes');
  if (sizeBytes === null) return null;
  const size = formatBytes(sizeBytes);

  const seeders = getNum(torrentObject, 'seeders');
  if (seeders === null) return null;
  const peers = getNum(torrentObject, 'leechers');
  if (peers === null) return null;

  const createdUnix = getNum(torrentObject, 'created_unix');
  if (createdUnix === null) return null;
  const uploadDate = epochSecondToISO(createdUnix);

  return makeTorrent({
    infoHash,
    name,
    size,
    seeders,
    peers,
    providerName,
    providerId: 'torrentscsv',
    uploadDate,
    category: 'Other',
    descriptionPageUrl: '',
  });
}

export class TorrentsCsvProvider implements SearchProvider {
  readonly id = 'torrentscsv';
  readonly name = 'TorrentsCSV';
  readonly url = 'https://torrents-csv.com';
  readonly supportedCategories: readonly Category[] = ['Other'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = true;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = {} as const;

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/service/search?q=${encodeURIComponent(query)}`;
    const json = await ctx.httpClient.getJson(requestUrl);
    if (json === null) return [];

    const root = asRecord(json);
    if (!root) return [];
    const torrentsArr = getArr(root, 'torrents');
    if (!torrentsArr) return [];

    const out: Torrent[] = [];
    for (const item of torrentsArr) {
      const obj = asRecord(item);
      if (!obj) continue;
      const t = parseTorrentObject(obj, this.name);
      if (t) out.push(t);
    }
    return out;
  }
}
