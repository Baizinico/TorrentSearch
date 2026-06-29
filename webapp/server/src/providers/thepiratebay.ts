/**
 * ThePirateBay Provider
 * 对应原 Kotlin providers/ThePirateBay.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 使用 apibay.org JSON API。
 */

import type { Category, Torrent, TorrentDetails } from '../types.js';
import type {
  SearchContext,
  SearchProvider,
  TorrentDetailsProvider,
  LatestTorrentsProvider,
  TopTorrentsProvider,
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import {
  epochSecondToISO,
  formatBytes,
  makeTorrent,
  createMagnetUri,
} from './_shared.js';

const API_URL = 'https://apibay.org';

interface TbpTorrentObject {
  id?: string | number;
  name?: string;
  info_hash?: string;
  leechers?: string | number;
  seeders?: string | number;
  size?: string | number;
  added?: string | number;
  category?: string | number;
  username?: string;
  descr?: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
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

/** Returns the [Category] that matches the index. */
function categoryFromId(id: number): Category {
  // Apps
  if ((id >= 300 && id <= 306) || id === 399) return 'Apps';
  // Books
  if (id === 601) return 'Books';
  // Games
  if ((id >= 400 && id <= 408) || id === 499) return 'Games';
  // Movies
  if ([201, 202, 204, 207, 209, 210, 211].includes(id)) return 'Movies';
  // Music
  if ((id >= 100 && id <= 104) || id === 199) return 'Music';
  // Porn
  if ((id >= 500 && id <= 507) || id === 599) return 'Porn';
  // Series
  if ([205, 208, 212].includes(id)) return 'Series';
  // All, Anime — TPB doesn't have dedicated anime category.
  return 'Other';
}

function parseResultsJson(json: unknown, providerName: string, providerUrl: string): Torrent[] {
  if (!Array.isArray(json)) return [];
  const torrents: Torrent[] = [];
  for (const item of json) {
    const obj = asRecord(item);
    if (!obj) continue;
    const t = parseTorrentObject(obj, providerName, providerUrl);
    if (t) torrents.push(t);
  }
  return torrents;
}

function parseTorrentObject(
  obj: Record<string, unknown>,
  providerName: string,
  providerUrl: string,
): Torrent | null {
  const t = obj as TbpTorrentObject;
  const name = typeof t.name === 'string' ? t.name : null;
  if (name === null) return null;
  // Yeah, this is how it returns empty results.
  if (name === 'No results returned') return null;

  const id = typeof t.id === 'string' ? t.id : t.id !== undefined ? String(t.id) : null;
  if (id === null) return null;
  const descriptionPageUrl = `${providerUrl}/description.php?id=${id}`;

  const infoHashRaw = typeof t.info_hash === 'string' ? t.info_hash : null;
  if (infoHashRaw === null) return null;
  const infoHash = infoHashRaw.toLowerCase().trim();

  const sizeBytesRaw = typeof t.size === 'string' ? t.size : null;
  if (sizeBytesRaw === null) return null;
  const size = formatBytes(Number(sizeBytesRaw));

  const seeders = getNum(obj, 'seeders');
  if (seeders === null) return null;
  const peers = getNum(obj, 'leechers');
  if (peers === null) return null;

  const added = getNum(obj, 'added');
  if (added === null) return null;
  const uploadDate = epochSecondToISO(added);

  const categoryRaw = getNum(obj, 'category');
  if (categoryRaw === null) return null;
  const category = categoryFromId(categoryRaw);

  return makeTorrent({
    infoHash,
    name,
    size,
    seeders,
    peers,
    providerName,
    providerId: 'thepiratebay',
    uploadDate,
    category,
    descriptionPageUrl,
  });
}

function parseDetailsJson(json: unknown): TorrentDetails | null {
  const obj = asRecord(json);
  if (!obj) return null;
  const t = obj as TbpTorrentObject;

  const infoHashRaw = typeof t.info_hash === 'string' ? t.info_hash : null;
  if (infoHashRaw === null) return null;
  const infoHash = infoHashRaw.toLowerCase();

  const name = typeof t.name === 'string' ? t.name : null;
  if (name === null) return null;

  const sizeNum = getNum(obj, 'size');
  const size = sizeNum !== null ? formatBytes(sizeNum) : null;

  const seeders = getNum(obj, 'seeders');
  const peers = getNum(obj, 'leechers');
  const added = getNum(obj, 'added');
  const uploadDate = added !== null ? epochSecondToISO(added) : null;

  const categoryNum = getNum(obj, 'category');
  const category = categoryNum !== null ? categoryFromId(categoryNum) : null;

  const uploader = typeof t.username === 'string' ? t.username : null;
  const description = typeof t.descr === 'string' ? t.descr : null;
  const magnetUri = createMagnetUri(infoHash);

  return {
    infoHash,
    name,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader,
    lastChecked: null,
    magnetUri,
    fileDownloadLink: null,
    description,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class ThePirateBayProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'thepiratebay';
  readonly name = 'ThePirateBay';
  readonly url = 'https://thepiratebay.org';
  readonly supportedCategories: readonly Category[] = [
    'Apps',
    'Books',
    'Games',
    'Movies',
    'Music',
    'Porn',
    'Series',
    'Other',
  ];
  readonly safetyStatus = 'Unsafe' as const;
  readonly unsafeReason = 'ThePirateBay may host unsafe content.';
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = ['https://knaben.xyz/thepiratebay/'];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const categoryIndex = this.categoryId(ctx.category);
    const requestUrl = `${API_URL}/q.php?q=${encodeURIComponent(query)}&cat=${categoryIndex}`;
    const responseJson = await ctx.httpClient.getJson(requestUrl);
    if (responseJson === null) return [];
    return parseResultsJson(responseJson, this.name, this.url);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const id = detailsPageUrl.slice(detailsPageUrl.lastIndexOf('=') + 1);
    const requestUrl = `${API_URL}/t.php?id=${id}`;
    const json = await getDefaultHttpClient().getJson(requestUrl);
    if (json === null) return null;
    return parseDetailsJson(json);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl =
      category === 'All'
        ? `${API_URL}/precompiled/data_top100_recent.json`
        : `${API_URL}/q.php?q=category%3A${this.categoryId(category)}`;
    const json = await getDefaultHttpClient().getJson(requestUrl);
    if (json === null) return [];
    return parseResultsJson(json, this.name, this.url);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl =
      category === 'All'
        ? `${API_URL}/precompiled/data_top100_48h.json`
        : `${API_URL}/precompiled/data_top100_48h_${this.categoryId(category)}.json`;
    const json = await getDefaultHttpClient().getJson(requestUrl);
    if (json === null) return [];
    return parseResultsJson(json, this.name, this.url);
  }

  /**
   * Returns the index of a given category.
   * Visit https://thepiratebay.org/browse.php to see all the supported index.
   */
  private categoryId(category: Category): number {
    switch (category) {
      case 'All':
      case 'Anime':
        return 0;
      case 'Apps':
        return 300;
      case 'Books':
        return 601;
      case 'Games':
        return 400;
      case 'Movies':
      case 'Series':
        return 200;
      case 'Music':
        return 101;
      case 'Porn':
        return 500;
      case 'Other':
        return 600;
    }
  }
}
