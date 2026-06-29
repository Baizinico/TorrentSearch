/**
 * SubsPlease Provider
 * 对应原 Kotlin providers/SubsPlease.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TorrentDetailsProvider
 * 使用 subsplease.org/api JSON API + 详情页 HTML。
 */

import * as cheerio from 'cheerio';
import type { Category, Torrent, TorrentDetails } from '../types.js';
import type {
  SearchContext,
  SearchProvider,
  TorrentDetailsProvider,
  LatestTorrentsProvider,
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import {
  formatBytes,
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  parseRFC1123,
} from './_shared.js';

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function getStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function getArr(obj: Record<string, unknown>, key: string): unknown[] | null {
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}

function getObj(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = obj[key];
  return asRecord(v);
}

/** Parses size from magnet URI's `xl=` query param. */
function parseSizeFromMagnetUri(magnetUri: string): string | null {
  const qIndex = magnetUri.indexOf('?');
  if (qIndex === -1) return null;
  const query = magnetUri.slice(qIndex + 1);
  const xlParam = query.split('&').find((p) => p.startsWith('xl='));
  if (!xlParam) return null;
  const value = xlParam.slice('xl='.length);
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return formatBytes(n);
}

function parseResultsJson(json: unknown, providerName: string, providerUrl: string): Torrent[] {
  const root = asRecord(json);
  if (!root) return [];
  const out: Torrent[] = [];
  for (const [showName, animeRaw] of Object.entries(root)) {
    const animeObject = asRecord(animeRaw);
    if (!animeObject) continue;
    const list = parseAnimeObject(showName, animeObject, providerName, providerUrl);
    out.push(...list);
  }
  return out;
}

function parseAnimeObject(
  showName: string,
  animeObject: Record<string, unknown>,
  providerName: string,
  providerUrl: string,
): Torrent[] {
  const releaseDate = getStr(animeObject, 'release_date');
  const uploadDate = releaseDate !== null ? parseRFC1123(releaseDate) : null;
  const page = getStr(animeObject, 'page');
  const detailsPageUrlBase = page !== null ? `${providerUrl}/${page}` : null;
  const episodeNumber = getStr(animeObject, 'episode');
  if (episodeNumber === null) return [];

  const downloads = getArr(animeObject, 'downloads');
  if (!downloads) return [];

  const out: Torrent[] = [];
  for (const d of downloads) {
    const downloadObject = asRecord(d);
    if (!downloadObject) continue;
    const t = parseDownloadObject(
      downloadObject,
      showName,
      uploadDate,
      detailsPageUrlBase,
      episodeNumber,
      providerName,
    );
    if (t) out.push(t);
  }
  return out;
}

function parseDownloadObject(
  downloadObject: Record<string, unknown>,
  torrentName: string,
  uploadDate: string | null,
  detailsPageUrlBase: string | null,
  episodeNumber: string,
  providerName: string,
): Torrent | null {
  const magnetUri = getStr(downloadObject, 'magnet');
  if (magnetUri === null) return null;
  const size = parseSizeFromMagnetUri(magnetUri) ?? '0 KB';

  const resolution = getStr(downloadObject, 'res');
  if (resolution === null) return null;
  const finalTorrentName = `${torrentName} [${resolution}p]`;

  const detailsPageUrl =
    detailsPageUrlBase !== null
      ? `${detailsPageUrlBase}?ep=${episodeNumber}&res=${resolution}`
      : '';

  return makeTorrent({
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: finalTorrentName,
    size,
    seeders: 0,
    peers: 0,
    providerName,
    providerId: 'subsplease',
    uploadDate,
    category: 'Anime',
    descriptionPageUrl: detailsPageUrl,
    magnetUri,
  });
}

async function getEpisodeAndDownloadObject(
  showId: string,
  episodeNumber: string,
  torrentResolution: string,
): Promise<[Record<string, unknown>, Record<string, unknown>] | null> {
  const requestUrl = `https://subsplease.org/api/?f=show&tz=$&sid=${showId}`;
  const json = await getDefaultHttpClient().getJson(requestUrl);
  if (json === null) return null;
  const root = asRecord(json);
  if (!root) return null;
  const episodeObj = getObj(root, 'episode');
  if (!episodeObj) return null;

  let episodeObject: Record<string, unknown> | null = null;
  for (const v of Object.values(episodeObj)) {
    const obj = asRecord(v);
    if (!obj) continue;
    if (getStr(obj, 'episode') === episodeNumber) {
      episodeObject = obj;
      break;
    }
  }
  if (!episodeObject) return null;

  const downloads = getArr(episodeObject, 'downloads');
  if (!downloads) return null;
  const downloadObject = downloads
    .map((it) => asRecord(it))
    .filter((r): r is Record<string, unknown> => r !== null)
    .find((r) => getStr(r, 'res') === torrentResolution);
  if (!downloadObject) return null;

  return [episodeObject, downloadObject];
}

async function parseDetailsHtml(html: string, pageUrl: string): Promise<TorrentDetails | null> {
  const $ = cheerio.load(html);

  const showIdEl = $('table#show-release-table').first();
  const showId = showIdEl.attr('sid');
  if (!showId) return null;

  const showName = $('h1.entry-title').first().text().trim();
  if (!showName) return null;

  const posterUrl = $('img.img-responsive.img-center').first().attr('src') ?? null;
  const description = $('div.series-syn > p').first().text().trim() || null;

  // pageUrl: ...?ep=<ep>&res=<res>
  const afterQ = pageUrl.slice(pageUrl.lastIndexOf('?') + 1);
  const parts = afterQ.split('&', 2);
  const episodeNumber = (parts[0] ?? '').replace(/^ep=/, '');
  const torrentResolution = (parts[1] ?? '').replace(/^res=/, '');

  const pair = await getEpisodeAndDownloadObject(showId, episodeNumber, torrentResolution);
  if (!pair) return null;
  const [episodeObject, downloadObject] = pair;

  const torrentName = `${showName} - ${episodeNumber} [${torrentResolution}p]`;
  const magnetUri = getStr(downloadObject, 'magnet');
  if (magnetUri === null) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);
  const size = parseSizeFromMagnetUri(magnetUri);
  const timeStr = getStr(episodeObject, 'time');
  const uploadDate = timeStr !== null ? parseDate(timeStr, 'MM/DD/YY') : null;
  const fileDownloadLink = getStr(downloadObject, 'torrent');

  return {
    infoHash,
    name: torrentName,
    size,
    seeders: null,
    peers: null,
    uploadDate,
    category: 'Anime',
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: false,
  };
}

export class SubsPleaseProvider
  implements SearchProvider, LatestTorrentsProvider, TorrentDetailsProvider
{
  readonly id = 'subsplease';
  readonly name = 'SubsPlease';
  readonly url = 'https://subsplease.org';
  readonly supportedCategories: readonly Category[] = ['Anime'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/api?f=search&tz=$&s=${encodeURIComponent(query)}`;
    const json = await ctx.httpClient.getJson(requestUrl);
    if (json === null) return [];
    return parseResultsJson(json, this.name, this.url);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/api/?f=latest&tz=$`;
    const json = await getDefaultHttpClient().getJson(requestUrl);
    if (json === null) return [];
    return parseResultsJson(json, this.name, this.url);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }
}
