/**
 * AniRena Provider
 * 对应原 Kotlin providers/AniRena.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * magnet 通过源链接 302 重定向的 Location header 获取（不跟随重定向）。
 * 此处直接用 axios（maxRedirects:0）实现，以读取 Location。
 */

import axios from 'axios';
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
import type { HttpClient } from '../http/HttpClient.js';
import {
  createMagnetUri,
  epochSecondToISO,
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
} from './_shared.js';

const UPLOAD_DATE_FORMAT = 'YYYY-MM-DD HH:mm';

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

function removeSurrounding(s: string, ch: string): string {
  if (s.length >= 2 && s.startsWith(ch) && s.endsWith(ch)) {
    return s.slice(1, -1);
  }
  return s;
}

function getCategoryFromRawString(raw: string): Category {
  switch (raw) {
    case 'Anime':
      return 'Anime';
    case 'Manga':
      return 'Books';
    case 'Audio':
      return 'Music';
    case 'Literature':
      return 'Books';
    case 'Live Action':
      return 'Series';
    case 'Software':
      return 'Apps';
    case 'Hentai':
      return 'Porn';
    case 'Other':
      return 'Other';
    default:
      return 'Other';
  }
}

const CATEGORY_MAP: Partial<Record<Category, string>> = {
  Anime: 'anime',
  Apps: 'software',
  Books: 'manga',
  Music: 'audio',
  Porn: 'hentai',
  Series: 'live',
  Other: 'other',
};

/**
 * Faithful port of Kotlin getMagnetUri: GET sourceUrl without following the
 * redirect and return the Location header. Uses axios directly because the
 * shared HttpClient follows redirects. Cookies/UA are forwarded from the given
 * httpClient so any unlocked session is reused.
 */
async function getMagnetUri(sourceUrl: string, httpClient: HttpClient): Promise<string | null> {
  try {
    let cookieStr = '';
    try {
      cookieStr = await httpClient.getCookieJar().getCookieString(sourceUrl);
    } catch {
      cookieStr = '';
    }
    const resp = await axios.get(sourceUrl, {
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 20000,
      headers: {
        'User-Agent': httpClient.getUserAgent(sourceUrl),
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
    });
    const loc = resp.headers['location'];
    return typeof loc === 'string' && loc ? loc : null;
  } catch {
    return null;
  }
}

// ============== Results page ==============

const LIST_ITEM = 'table.tl-table > tbody > tr';
const TORRENT_NAME = 'td.col-name > div.tl-name-wrap > a.tl-torrent-name';
const SIZE = 'td.col-size';
const SEEDERS = 'td.col-se > span.tl-se';
const PEERS = 'td.col-le > span.tl-le';
const CATEGORY = 'td.col-cat';
const MAGNET_URI = 'td.col-actions > div.tl-actions > a:nth-child(1)';
const FILE_DOWNLOAD_LINK = 'td.col-actions > div.tl-actions > a:nth-child(2)';

async function parseResultsHtml(
  html: string,
  pageUrl: string,
  providerName: string,
  httpClient: HttpClient,
): Promise<Torrent[]> {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  // Faithful to Kotlin: sequential mapNotNull (no concurrency).
  for (const el of $(LIST_ITEM).toArray()) {
    const $row = $(el);
    const magnetSourceLink = resolveUrl($row.find(MAGNET_URI).first().attr('href'), pageUrl);
    if (!magnetSourceLink) continue;
    const magnetUri = await getMagnetUri(magnetSourceLink, httpClient);
    if (!magnetUri) continue;

    const torrentName = ownText($row.find(TORRENT_NAME).first());
    if (!torrentName) continue;
    const size = ownText($row.find(SIZE).first()) || '0 KB';
    const seeders = toUintOrNull(ownText($row.find(SEEDERS).first())) ?? 0;
    const peers = toUintOrNull(ownText($row.find(PEERS).first())) ?? 0;
    const createdTs = $row.attr('data-created-ts');
    const ts = createdTs ? Number(createdTs) : NaN;
    const uploadDate = Number.isNaN(ts) ? null : epochSecondToISO(ts);
    const catTitle = $row.find(CATEGORY).first().attr('title') ?? '';
    const catRaw = catTitle ? catTitle.split('/')[0]!.trim() : '';
    const category = catRaw ? getCategoryFromRawString(catRaw) : null;
    const fileDownloadLink =
      resolveUrl($row.find(FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;
    const detailsPageUrl =
      resolveUrl($row.find(TORRENT_NAME).first().attr('href'), pageUrl) || '';
    const infoHash = parseInfoHashFromMagnet(magnetUri);

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'anirena',
        uploadDate,
        category,
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
        fileDownloadLink,
      }),
    );
  }
  return out;
}

// ============== Details page ==============

const D_INFO_HASH = 'code.td-ov-stat-hash';
const D_TORRENT_NAME = 'h1.td-title';
const D_SIZE = 'div.td-ov-stats > div.td-ov-stat:nth-child(4) > div.td-ov-stat-num';
const D_SEEDERS = 'div.td-ov-stats > div.td-ov-stat--se > div.td-ov-stat-num';
const D_PEERS = 'div.td-ov-stats > div.td-ov-stat--le > div.td-ov-stat-num';
const D_UPLOAD_DATE = 'div.td-ov-meta > div.td-ov-meta-val:nth-child(6) > span';
const D_CATEGORY = 'div.td-ov-meta-val:nth-child(2) a.td-cat-name.td-cat-link';
const D_UPLOADER = 'div.td-ov-meta > div.td-ov-meta-val:nth-child(4)';
const D_MAGNET_URI = 'div.td-actions > a:nth-child(1)';
const D_FILE_DOWNLOAD_LINK = 'div.td-actions > a:nth-child(2)';
const D_DESCRIPTION = 'script#td-description-raw';
const D_POSTER_URL = 'div.td-anime-poster > img';

async function parseDetailsHtml(
  html: string,
  pageUrl: string,
  httpClient: HttpClient,
): Promise<TorrentDetails | null> {
  const $ = cheerio.load(html);

  const infoHash = ownText($(D_INFO_HASH).first()).toLowerCase();
  if (!infoHash) return null;
  const torrentName = $(D_TORRENT_NAME).first().text();
  if (!torrentName) return null;
  const size = ownText($(D_SIZE).first()) || null;
  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));
  const uploadDateRaw = $(D_UPLOAD_DATE).first().attr('data-utc') ?? '';
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, UPLOAD_DATE_FORMAT) : null;
  const categoryRaw = ownText($(D_CATEGORY).first());
  const category = categoryRaw ? getCategoryFromRawString(categoryRaw) : null;
  const uploader = ownText($(D_UPLOADER).first()) || null;

  const magnetSourceLink = resolveUrl($(D_MAGNET_URI).first().attr('href'), pageUrl);
  const magnetUri = magnetSourceLink
    ? (await getMagnetUri(magnetSourceLink, httpClient)) ?? createMagnetUri(infoHash)
    : createMagnetUri(infoHash);
  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;

  const descriptionRaw = $(D_DESCRIPTION).first().html() ?? '';
  const description = descriptionRaw ? removeSurrounding(descriptionRaw, '"') : null;
  const posterUrl = resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) || null;

  return {
    infoHash,
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

// ============== Provider ==============

export class AniRenaProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'anirena';
  readonly name = 'AniRena';
  readonly url = 'https://anirena.com';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Books',
    'Music',
    'Porn',
    'Series',
    'Other',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    let requestUrl = `${this.url}?q=${encodeURIComponent(query)}&page=1`;
    if (ctx.category !== 'All') {
      const cat = CATEGORY_MAP[ctx.category];
      if (cat) requestUrl += `&cat=${cat}`;
    }
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const client = getDefaultHttpClient();
    const html = await client.get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl, client);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const html = await getDefaultHttpClient().get(this.url);
    return parseResultsHtml(html, this.url, this.name, getDefaultHttpClient());
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    return this.getLatestTorrents(category);
  }
}
