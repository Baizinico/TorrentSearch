/**
 * Yts Provider
 * 对应原 Kotlin providers/Yts.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TopTorrentsProvider + TorrentDetailsProvider
 * 使用 movies-api.accel.li JSON API。
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

const API_BASE_URL = 'https://movies-api.accel.li/api/v2';

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

function getObj(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = obj[key];
  return asRecord(v);
}

interface YtsTorrentObject {
  hash?: string;
  quality?: string;
  type?: string;
  video_codec?: string;
  seeds?: number;
  peers?: number;
  size?: string;
  size_bytes?: number;
  date_uploaded_unix?: number;
  url?: string;
}

function parseResultsJson(json: unknown, providerName: string): Torrent[] {
  const root = asRecord(json);
  if (!root) return [];
  const data = getObj(root, 'data');
  if (!data) return [];
  const movies = getArr(data, 'movies');
  if (!movies) return [];
  const torrents: Torrent[] = [];
  for (const m of movies) {
    const movie = asRecord(m);
    if (!movie) continue;
    const list = parseMovieObject(movie, providerName);
    torrents.push(...list);
  }
  return torrents;
}

function parseMovieObject(
  movieObject: Record<string, unknown>,
  providerName: string,
): Torrent[] {
  const movieId = getNum(movieObject, 'id');
  if (movieId === null) return [];
  const movieTitle = getStr(movieObject, 'title_long');
  if (movieTitle === null) return [];
  const detailsPageUrlBase = getStr(movieObject, 'url');

  const torrentsArr = getArr(movieObject, 'torrents');
  if (!torrentsArr) return [];

  const out: Torrent[] = [];
  for (const t of torrentsArr) {
    const torrentObj = asRecord(t);
    if (!torrentObj) continue;
    const torrent = parseTorrentObject(
      torrentObj,
      movieId,
      movieTitle,
      detailsPageUrlBase,
      providerName,
    );
    if (torrent) out.push(torrent);
  }
  return out;
}

function parseTorrentObject(
  torrentObject: Record<string, unknown>,
  movieId: number,
  movieTitle: string,
  detailsPageUrlBase: string | null,
  providerName: string,
): Torrent | null {
  const t = torrentObject as YtsTorrentObject;
  const infoHashRaw = typeof t.hash === 'string' ? t.hash : null;
  if (infoHashRaw === null) return null;
  const infoHash = infoHashRaw.toLowerCase();

  const quality = getStr(torrentObject, 'quality') ?? '-';
  const type = getStr(torrentObject, 'type') ?? '-';
  const codec = getStr(torrentObject, 'video_codec') ?? '-';
  const name = `${movieTitle} [${quality}] [${type}] [${codec}]`;

  const size = getStr(torrentObject, 'size');
  if (size === null) return null;

  const seeders = getNum(torrentObject, 'seeds');
  if (seeders === null) return null;
  const peers = getNum(torrentObject, 'peers');
  if (peers === null) return null;

  const dateUnix = getNum(torrentObject, 'date_uploaded_unix');
  const uploadDate = dateUnix !== null ? epochSecondToISO(dateUnix) : null;

  const detailsPageUrl =
    detailsPageUrlBase !== null
      ? `${detailsPageUrlBase}?movieid=${movieId}&infohash=${infoHash}`
      : '';

  return makeTorrent({
    infoHash,
    name,
    size,
    seeders,
    peers,
    providerName,
    providerId: 'ytsmx',
    uploadDate,
    category: 'Movies',
    descriptionPageUrl: detailsPageUrl,
  });
}

function parseDetailsJson(json: unknown, torrentInfoHash: string): TorrentDetails | null {
  const root = asRecord(json);
  if (!root) return null;
  const data = getObj(root, 'data');
  if (!data) return null;
  const movie = getObj(data, 'movie');
  if (!movie) return null;

  const torrentsArr = getArr(movie, 'torrents');
  if (!torrentsArr) return null;
  const torrentObj = torrentsArr
    .map((it) => asRecord(it))
    .filter((r): r is Record<string, unknown> => r !== null)
    .find((r) => {
      const h = getStr(r, 'hash');
      return h !== null && h.toLowerCase() === torrentInfoHash;
    });
  if (!torrentObj) return null;

  const movieTitle = getStr(movie, 'title_long');
  if (movieTitle === null) return null;
  const description = getStr(movie, 'description_full');
  const posterUrl = getStr(movie, 'medium_cover_image');
  const screenshotUrls = [
    'medium_screenshot_image1',
    'medium_screenshot_image2',
    'medium_screenshot_image3',
  ]
    .map((k) => getStr(movie, k))
    .filter((s): s is string => s !== null);

  const sizeBytes = getNum(torrentObj, 'size_bytes');
  const size = sizeBytes !== null ? formatBytes(sizeBytes) : null;
  const seeders = getNum(torrentObj, 'seeds');
  const peers = getNum(torrentObj, 'peers');
  const dateUnix = getNum(torrentObj, 'date_uploaded_unix');
  const uploadDate = dateUnix !== null ? epochSecondToISO(dateUnix) : null;
  const magnetUri = createMagnetUri(torrentInfoHash);
  const fileDownloadLink = getStr(torrentObj, 'url');

  const quality = getStr(torrentObj, 'quality') ?? '-';
  const type = getStr(torrentObj, 'type') ?? '-';
  const codec = getStr(torrentObj, 'video_codec') ?? '-';
  const torrentName = `${movieTitle} [${quality}] [${type}] [${codec}]`;

  return {
    infoHash: torrentInfoHash,
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category: 'Movies',
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls,
    isNSFW: false,
  };
}

export class YtsProvider
  implements
    SearchProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider,
    TorrentDetailsProvider
{
  readonly id = 'ytsmx';
  readonly name = 'Yts';
  readonly url = 'https://yts.bz';
  readonly supportedCategories: readonly Category[] = ['Movies'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = true;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${API_BASE_URL}/list_movies.json?query_term=${encodeURIComponent(
      query,
    )}&limit=50`;
    const json = await ctx.httpClient.getJson(requestUrl);
    if (json === null) return [];
    return parseResultsJson(json, this.name);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${API_BASE_URL}/list_movies.json`;
    const json = await getDefaultHttpClient().getJson(requestUrl);
    if (json === null) return [];
    return parseResultsJson(json, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    // Using sort_by=seeds doesn't work server-side, falls back to latest.
    return this.getLatestTorrents(category);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    // detailsPageUrl format: <base>?movieid=<id>&infohash=<hash>
    const afterQ = detailsPageUrl.slice(detailsPageUrl.lastIndexOf('?') + 1);
    const parts = afterQ.split('&', 2);
    const movieId = (parts[0] ?? '').replace(/^movieid=/, '');
    const infoHash = (parts[1] ?? '').replace(/^infohash=/, '');
    const requestUrl = `${API_BASE_URL}/movie_details.json?movie_id=${movieId}&with_images=true`;
    const json = await getDefaultHttpClient().getJson(requestUrl);
    if (json === null) return null;
    return parseDetailsJson(json, infoHash);
  }
}
