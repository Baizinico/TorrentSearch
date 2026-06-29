/**
 * LimeTorrents Provider
 * 对应原 Kotlin providers/LimeTorrents.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 使用 InfoHash（从 itorrents 下载链接解析），不直接提供 magnet。
 * safetyStatus = Unsafe（会忽略分类筛选，需谨慎使用）。
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
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
  makeTorrent,
  resolveUrl,
  tryParseRelative,
} from './_shared.js';

/** jsoup-like ownText: only direct text nodes of the element. */
function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

function toUintOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

function removeSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
}

/** Splits on the first occurrence of delim; the remainder stays in the last part (Kotlin split limit=2). */
function splitFirst(s: string, delim: string): string[] {
  const i = s.indexOf(delim);
  if (i === -1) return [s];
  return [s.slice(0, i), s.slice(i + delim.length)];
}

function categoryFromRawString(raw: string): Category {
  switch (raw) {
    case 'TV':
      return 'Series';
    case 'Movie':
      return 'Movies';
    case 'Music':
      return 'Music';
    case 'App':
      return 'Apps';
    case 'E-book':
      return 'Books';
    case 'Anime':
      return 'Anime';
    case 'Games':
      return 'Games';
    default:
      return 'Other';
  }
}

// ============== Results page ==============

const LIST_ITEM = '.table2 > tbody > tr';
const TORRENT_NAME = 'td:nth-child(1) > div.tt-name > a:nth-child(2)';
const SIZE = 'td:nth-child(3)';
const SEEDERS = 'td.tdseed';
const PEERS = 'td.tdleech';
const UPLOAD_DATE_AND_CATEGORY = 'td:nth-child(2)';
const FILE_DOWNLOAD_LINK = 'td:nth-child(1) > div.tt-name > a:nth-child(1)';

/** Parses `<date> - in <category>.` text into [date, category] (Kotlin parseDateAndCategory). */
function parseDateAndCategory(text: string): [string, string | null] {
  if (!text.includes('- in')) return [text.trim(), null];
  const parts = splitFirst(text, '-').map((p) => p.trim());
  const rawUploadDate = parts[0] ?? '';
  let rawCategory = parts[1] ?? '';
  rawCategory = rawCategory.replace(/^in /, '');
  rawCategory = removeSuffix(rawCategory, '.');
  return [rawUploadDate, rawCategory];
}

function parseResultsHtml(
  html: string,
  pageUrl: string,
  providerName: string,
  searchCategory: Category | null = null,
): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  $(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    const torrentName = ownText($row.find(TORRENT_NAME).first());
    if (!torrentName) return;
    const fileDownloadLink =
      resolveUrl($row.find(FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) ?? null;
    if (!fileDownloadLink) return;
    // http://itorrents.net/torrent/<HASH>.torrent?title=...
    const infoHash = fileDownloadLink
      .replace(/^http:\/\/itorrents\.net\/torrent\//, '')
      .split('.')[0]!
      .toLowerCase();
    const size = ownText($row.find(SIZE).first()) || '0 KB';
    const seeders = toUintOrNull(ownText($row.find(SEEDERS).first())) ?? 0;
    const peers = toUintOrNull(ownText($row.find(PEERS).first())) ?? 0;
    const dateCatText = ownText($row.find(UPLOAD_DATE_AND_CATEGORY).first());
    const [rawUploadDate, rawCategory] = dateCatText
      ? parseDateAndCategory(dateCatText)
      : [null, null];
    const uploadDate = rawUploadDate ? tryParseRelative(rawUploadDate) : null;
    const category = rawCategory ? categoryFromRawString(rawCategory) : searchCategory;
    const detailsPageUrl =
      resolveUrl($row.find(TORRENT_NAME).first().attr('href'), pageUrl) || '';

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'limetorrents',
        uploadDate,
        category,
        descriptionPageUrl: detailsPageUrl,
        fileDownloadLink,
      }),
    );
  });
  return out;
}

// ============== Details page ==============

const D_INFO_HASH =
  '#content > div:nth-child(6) > div:nth-child(1) > div > table > tbody > tr:nth-child(1) > td:nth-child(2)';
const D_NAME = '#content > h1';
const D_SIZE =
  '#content > div:nth-child(6) > div:nth-child(1) > div > table > tbody > tr:nth-child(3) > td:nth-child(2)';
const D_SEEDERS = '#content > span.greenish';
const D_PEERS = '#content > span.reddish';
const D_UPLOAD_DATE_AND_CATEGORY =
  '#content > div:nth-child(6) > div:nth-child(1) > div > table > tbody > tr:nth-child(2) > td:nth-child(2)';
const D_MAGNET_URI = 'a[href^="magnet:?"]';
const D_FILE_DOWNLOAD_LINK =
  '#content > div:nth-child(6) > div:nth-child(1) > div > div:nth-child(7) > div > a';

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const infoHash = ownText($(D_INFO_HASH).first()).toLowerCase();
  if (!infoHash) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const name = ownText($(D_NAME).first());
  if (!name) return null;
  const size = ownText($(D_SIZE).first()) || null;
  const seedersRaw = ownText($(D_SEEDERS).first()).replace(/^Seeders\s*:\s*/, '').trim();
  const peersRaw = ownText($(D_PEERS).first()).replace(/^Leechers\s*:\s*/, '').trim();
  const seeders = toUintOrNull(seedersRaw);
  const peers = toUintOrNull(peersRaw);

  const dateCatText = $(D_UPLOAD_DATE_AND_CATEGORY).first().text();
  const parts = splitFirst(dateCatText, 'in');
  const rawUploadDate = (parts[0] ?? '').trim();
  let rawCategory = (parts[1] ?? '').trim();
  rawCategory = removeSuffix(rawCategory, '.');
  const uploadDate = rawUploadDate ? tryParseRelative(rawUploadDate) : null;
  const category = rawCategory ? categoryFromRawString(rawCategory) : null;
  const fileDownloadLink = $(D_FILE_DOWNLOAD_LINK).first().attr('href') ?? null;

  return {
    infoHash,
    name,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description: null,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

// ============== Provider ==============

function getCategorySearchString(category: Category): string {
  switch (category) {
    case 'All':
    case 'Books':
    case 'Porn':
      return 'all';
    case 'Anime':
      return 'anime';
    case 'Apps':
      return 'applications';
    case 'Games':
      return 'games';
    case 'Movies':
      return 'movies';
    case 'Music':
      return 'music';
    case 'Series':
      return 'tv';
    case 'Other':
      return 'other';
  }
}

function getCategoryBrowseString(category: Category): string {
  switch (category) {
    case 'All':
      throw new Error('Category.All is not supported for browsing');
    case 'Anime':
      return 'Anime';
    case 'Apps':
      return 'Applications';
    case 'Books':
      return 'Other-E-books';
    case 'Games':
      return 'Games';
    case 'Movies':
      return 'Movies';
    case 'Music':
      return 'Music';
    case 'Porn':
      throw new Error('Category.Porn is not supported for browsing');
    case 'Series':
      return 'TV-shows';
    case 'Other':
      return 'Other';
  }
}

export class LimeTorrentsProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'limetorrents';
  readonly name = 'LimeTorrents';
  readonly url = 'https://limetorrents.fun';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Games',
    'Movies',
    'Music',
    'Series',
    'Other',
  ];
  readonly safetyStatus = 'Unsafe' as const;
  readonly unsafeReason =
    'Not technically unsafe, but it ignores category selection. Choose carefully.';
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const categoryString = getCategorySearchString(ctx.category);
    const requestUrl = `${this.url}/search/${categoryString}/${encodeURIComponent(query)}/date/1/`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    if (!this.supportedCategories.includes(category)) return [];
    const categoryString = getCategoryBrowseString(category);
    const requestUrl = `${this.url}/browse-torrents/${categoryString}/`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, category);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    if (!this.supportedCategories.includes(category)) return [];
    const categoryString = getCategoryBrowseString(category);
    const requestUrl = `${this.url}/cat_top/16/${categoryString}/`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, category);
  }
}
