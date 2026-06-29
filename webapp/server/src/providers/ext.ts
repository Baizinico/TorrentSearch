/**
 * Ext Provider
 * 对应原 Kotlin providers/Ext.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider
 * magnet 通过 HMAC 表单 ajax/getSearchMagnet.php（详情页用 getTorrentMagnet.php）动态获取，
 * HMAC = SHA-256(torrentId|timestamp|pageToken)（十六进制），依赖页面里提取的 sessionId
 * 与 pageToken。Cloudflare 保护。用 Node 内置 crypto 计算 SHA-256。
 */

import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import pLimit from 'p-limit';
import type { Category, Torrent, TorrentDetails } from '../types.js';
import type {
  SearchContext,
  SearchProvider,
  TorrentDetailsProvider,
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import type { HttpClient } from '../http/HttpClient.js';
import {
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
  tryParseRelative,
} from './_shared.js';

const DETAIL_CONCURRENCY = 5;
const UPLOAD_DATE_FORMAT = 'DD MMMM YYYY';
const MAGNET_AJAX_SEARCH_URL = 'https://ext.to/ajax/getSearchMagnet.php';
const MAGNET_AJAX_DETAILS_URL = 'https://ext.to/ajax/getTorrentMagnet.php';
const DESCRIPTION_AJAX_URL = 'https://ext.to/ajax/torrentDescription.php';

const CATEGORY_MAP: Partial<Record<Category, number>> = {
  Anime: 7,
  Apps: 5,
  Books: 6,
  Games: 4,
  Movies: 1,
  Music: 3,
  Other: 8,
  Porn: 10,
  Series: 2,
};

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

function removeSurrounding(s: string, ch: string): string {
  if (s.length >= 2 && s.startsWith(ch) && s.endsWith(ch)) {
    return s.slice(1, -1);
  }
  return s;
}

/** Kotlin takeLastWhile: longest suffix where every char satisfies pred. */
function takeLastWhile(s: string, pred: (c: string) => boolean): string {
  let i = s.length;
  while (i > 0 && pred(s[i - 1]!)) i--;
  return s.slice(i);
}

function getCategoryFromRaw(raw: string): Category {
  switch (raw) {
    case 'anime':
      return 'Anime';
    case 'applications':
      return 'Apps';
    case 'books':
      return 'Books';
    case 'games':
      return 'Games';
    case 'movies':
      return 'Movies';
    case 'music':
      return 'Music';
    case 'other':
      return 'Other';
    case 'tv':
      return 'Series';
    case 'xxx':
      return 'Porn';
    default:
      return 'Other';
  }
}

/** HMAC token = SHA-256("torrentId|timestamp|pageToken") hex (lowercase). */
function computeHMAC(torrentId: string, timestamp: number, pageToken: string): string {
  const data = `${torrentId}|${timestamp}|${pageToken}`;
  return createHash('sha256').update(data).digest('hex');
}

/** Extract `window.searchPageToken` value from a search results page. */
function extractSearchPageToken($: cheerio.CheerioAPI): string | null {
  let token: string | null = null;
  $('script').each((_, el) => {
    if (token) return;
    const data = ($(el).html() ?? '').trim();
    if (!data || !data.startsWith('window.searchPageToken')) return;
    let s = removeSuffix(data, "';");
    s = takeLastWhile(s, (c) => c !== "'");
    token = s;
  });
  return token;
}

/** Extract `window.pageToken` value from a details page. */
function extractDetailsPageToken($: cheerio.CheerioAPI): string | null {
  let token: string | null = null;
  $('script').each((_, el) => {
    if (token) return;
    const data = ($(el).html() ?? '').trim();
    const firstLine = data.split(/\r?\n/)[0] ?? '';
    if (!firstLine || !firstLine.startsWith('window.pageToken')) return;
    let s = removeSuffix(firstLine, "';");
    s = takeLastWhile(s, (c) => c !== "'");
    token = s;
  });
  return token;
}

/** POST search magnet form → parse JSON → return url field. */
async function fetchSearchMagnetUri(
  torrentId: string,
  sessionId: string,
  pageToken: string,
  httpClient: HttpClient,
): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = computeHMAC(torrentId, timestamp, pageToken);
  const body = await httpClient.postForm(MAGNET_AJAX_SEARCH_URL, {
    torrent_id: torrentId,
    hash: '',
    name: '',
    timestamp: String(timestamp),
    hmac,
    sessid: sessionId,
  });
  if (!body) return null;
  try {
    const json = JSON.parse(body) as { url?: unknown };
    return typeof json.url === 'string' ? json.url : null;
  } catch {
    return null;
  }
}

/** POST details magnet form → parse JSON → return url field. */
async function fetchDetailsMagnetUri(
  torrentId: string,
  sessionId: string,
  pageToken: string,
  httpClient: HttpClient,
): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = computeHMAC(torrentId, timestamp, pageToken);
  const body = await httpClient.postForm(MAGNET_AJAX_DETAILS_URL, {
    torrent_id: torrentId,
    download_type: 'magnet',
    timestamp: String(timestamp),
    hmac,
    sessid: sessionId,
  });
  if (!body) return null;
  try {
    const json = JSON.parse(body) as { url?: unknown };
    return typeof json.url === 'string' ? json.url : null;
  } catch {
    return null;
  }
}

/** GET torrent description AJAX → parse JSON → return data field. */
async function fetchDescription(
  torrentId: string,
  torrentSlug: string,
  httpClient: HttpClient,
): Promise<string | null> {
  const json = await httpClient.getJson<{ data?: unknown }>(
    `${DESCRIPTION_AJAX_URL}?id=${encodeURIComponent(torrentId)}&code=${encodeURIComponent(torrentSlug)}`,
    { 'x-requested-with': 'XMLHttpRequest' },
  );
  if (!json) return null;
  return typeof json.data === 'string' ? json.data : null;
}

// ============== Results page ==============

const SESSION_ID = 'meta[name="csrf-token"]';
const LIST_ITEM = 'table.search-table > tbody > tr';
const TORRENT_NAME = 'td:nth-child(1) > div:nth-child(1) > a.torrent-title-link';
const SIZE = 'td:nth-child(2) > div > span:nth-child(2)';
const SEEDERS = 'td:nth-child(5) > div > span:nth-child(2)';
const PEERS = 'td:nth-child(6) > div > span:nth-child(3)';
const UPLOAD_DATE = 'td:nth-child(4) > div > span:nth-child(2)';
const CATEGORY = 'td:nth-child(1) > div:nth-child(1) > div.related-posted > a:nth-child(2)';
const TORRENT_ID = 'td:nth-child(1) > div:nth-child(2) > a.search-magnet-btn';

async function parseResultsHtml(
  html: string,
  pageUrl: string,
  providerName: string,
  httpClient: HttpClient,
): Promise<Torrent[]> {
  const $ = cheerio.load(html);
  const sessionId = $(SESSION_ID).first().attr('content') ?? null;
  const pageToken = extractSearchPageToken($);

  const items = $(LIST_ITEM).toArray();
  const limit = pLimit(DETAIL_CONCURRENCY);
  const results = await Promise.all(
    items.map((item) =>
      limit(async () => {
        const $row = $(item);
        const torrentId = $row.find(TORRENT_ID).first().attr('data-id');
        if (!torrentId) return null;
        if (!pageToken || !sessionId) return null;
        const magnetUri = await fetchSearchMagnetUri(torrentId, sessionId, pageToken, httpClient);
        if (!magnetUri) return null;

        const torrentName = $row.find(TORRENT_NAME).first().text();
        if (!torrentName) return null;
        const size = ownText($row.find(SIZE).first()) || '0 KB';
        const seeders = toUintOrNull(ownText($row.find(SEEDERS).first())) ?? 0;
        const peers = toUintOrNull(ownText($row.find(PEERS).first())) ?? 0;
        const uploadDateRaw = $row.find(UPLOAD_DATE).first().attr('title') ?? '';
        const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, UPLOAD_DATE_FORMAT) : null;
        const catHref = $row.find(CATEGORY).first().attr('href') ?? '';
        const catRaw = removeSurrounding(catHref, '/');
        const category = catRaw ? getCategoryFromRaw(catRaw) : null;
        const detailsPageUrl =
          resolveUrl($row.find(TORRENT_NAME).first().attr('href'), pageUrl) || '';

        return makeTorrent({
          infoHash: parseInfoHashFromMagnet(magnetUri),
          name: torrentName,
          size,
          seeders,
          peers,
          providerName,
          providerId: 'extdotto',
          uploadDate,
          category,
          descriptionPageUrl: detailsPageUrl,
        });
      }),
    ),
  );
  return results.filter((t): t is Torrent => t !== null);
}

// ============== Details page ==============

const D_TORRENT_ID = 'a.detail-magnet-link.download-btn-magnet';
const D_DETAILS_PAGE_CARD = 'div.detal-page-left-block > div.card > div.card-body';
const D_TORRENT_NAME = `${D_DETAILS_PAGE_CARD} .card-title`;
const D_SIZE = `${D_DETAILS_PAGE_CARD} .content-size`;
const D_SEEDERS = `${D_DETAILS_PAGE_CARD} #seed-counter`;
const D_PEERS = `${D_DETAILS_PAGE_CARD} #leech-counter`;
const D_UPLOAD_DATE = `${D_DETAILS_PAGE_CARD} div.detail-torrent-poster-info > span:nth-child(1)`;
const D_CATEGORY = `${D_DETAILS_PAGE_CARD} div.detail-torrent-poster-info > a:nth-child(3)`;
const D_UPLOADER = `${D_DETAILS_PAGE_CARD} div.detail-torrent-poster-info span.external-user`;
const D_LAST_CHECKED = `${D_DETAILS_PAGE_CARD} span.detail-update-date > strong`;
const D_TORRENT_SLUG = `${D_DETAILS_PAGE_CARD} a.js-dscr`;
const D_MOVIE_PLOT = `${D_DETAILS_PAGE_CARD} div.movie-info > div.plot-block`;
const D_SERIES_PLOT = `${D_DETAILS_PAGE_CARD} div.plot-info > div.block-plot-tv`;
const D_POSTER_URL = `${D_DETAILS_PAGE_CARD} div.poster-block > a > img`;
const D_POSTER_URL_1 = `${D_DETAILS_PAGE_CARD} img.detail-torrent-image`;

async function parseDetailsHtml(
  html: string,
  pageUrl: string,
  httpClient: HttpClient,
): Promise<TorrentDetails | null> {
  const $ = cheerio.load(html);

  const torrentId = $(D_TORRENT_ID).first().attr('data-id');
  if (!torrentId) return null;
  const sessionId = $(SESSION_ID).first().attr('content');
  if (!sessionId) return null;
  const pageToken = extractDetailsPageToken($);
  if (!pageToken) return null;
  const magnetUri = await fetchDetailsMagnetUri(torrentId, sessionId, pageToken, httpClient);
  if (!magnetUri) return null;

  const torrentName = ownText($(D_TORRENT_NAME).first());
  if (!torrentName) return null;
  const sizeRaw = ownText($(D_SIZE).first());
  const size = removeSuffix(sizeRaw, '').replace(/^Size:\s*/, '') || null;
  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));
  const uploadDateRaw = $(D_UPLOAD_DATE).first().attr('title') ?? '';
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, UPLOAD_DATE_FORMAT) : null;
  const catHref = $(D_CATEGORY).first().attr('href') ?? '';
  const catRaw = removeSurrounding(catHref, '/');
  const category = catRaw ? getCategoryFromRaw(catRaw) : null;
  const uploader = ownText($(D_UPLOADER).first()) || null;
  const lastCheckedRaw = ownText($(D_LAST_CHECKED).first());
  const lastChecked = lastCheckedRaw ? tryParseRelative(lastCheckedRaw) : null;

  let description: string | null = null;
  if (category === 'Movies') {
    description = ownText($(D_MOVIE_PLOT).first()) || null;
  } else if (category === 'Series') {
    description = ownText($(D_SERIES_PLOT).first()) || null;
  } else {
    const slug = $(D_TORRENT_SLUG).first().attr('data-code');
    if (slug) description = await fetchDescription(torrentId, slug, httpClient);
  }

  const posterRaw =
    resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) ||
    resolveUrl($(D_POSTER_URL_1).first().attr('src'), pageUrl) ||
    null;
  const posterUrl = posterRaw && !posterRaw.endsWith('no-torrent-image.png') ? posterRaw : null;
  const fileDownloadLink = null;

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader,
    lastChecked,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

// ============== Provider ==============

export class ExtProvider implements SearchProvider, TorrentDetailsProvider {
  readonly id = 'extdotto';
  readonly name = 'Ext';
  readonly url = 'https://ext.to';
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
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = true;
  readonly capabilities = { details: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const cat = CATEGORY_MAP[ctx.category];
    const requestUrl = cat
      ? `${this.url}/browse/?cat=${cat}&q=${encodeURIComponent(query)}`
      : `${this.url}/browse/?q=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const client = getDefaultHttpClient();
    const html = await client.get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl, client);
  }
}
