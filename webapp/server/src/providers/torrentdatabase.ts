/**
 * TorrentDatabase Provider
 * 对应原 Kotlin providers/TorrentDatabase.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 列表项已含 magnet/infoHash（从 /track/magnet/<hash> href 派生），无二次请求。
 * Cloudflare 保护。magnetUri 附加专属 tracker（URL-encoded）。
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
  createMagnetUri,
  makeTorrent,
  normalizeSize,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
} from './_shared.js';

const TORRENT_DATABASE_TRACKER_URL = 'https%3A%2F%2Fdevelopify.ca%2Fannounce';
const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const DATE_FORMAT_WITH_TZ = 'YYYY-MM-DD HH:mm:ssZ';

const CATEGORY_MAP: Partial<Record<Category, string>> = {
  Apps: 'software',
  Books: 'e-books',
  Games: 'games',
  Movies: 'movies',
  Music: 'music',
  Porn: 'porn',
  Series: 'tv',
};

// Results page selectors
const LIST_ITEM = 'table.torrent-table > tbody > tr';
const TORRENT_NAME_SEL = 'td:nth-child(1) > a:nth-child(2)';
const SIZE_SEL = 'td.size-cell';
const SEEDERS_SEL = 'td:nth-child(5) > div > span:nth-child(1)';
const PEERS_SEL = 'td:nth-child(5) > div > span:nth-child(2)';
const UPLOAD_DATE_SEL = 'td.date-cell';
const CATEGORY_SEL = 'td:nth-child(2) > span.category-bubble';
const DESCRIPTION_PAGE_URL_SEL = 'td:nth-child(1) > a:nth-child(1)';

// Details page selectors
const D_TORRENT_NAME =
  'div.torrent-detail-card > div.card-header.torrent-cat-header > h4';
const D_SIZE =
  'div.torrent-detail-card > div.card-body ul.torrent-info-list > li:nth-child(2) > strong.db-value';
const D_SEEDERS =
  'div.torrent-detail-card > div.card-body ul.torrent-stats-list > li:nth-child(1) > strong.text-success';
const D_PEERS =
  'div.torrent-detail-card > div.card-body ul.torrent-stats-list > li:nth-child(2) > strong.text-danger';
const D_UPLOAD_DATE =
  'div.torrent-detail-card > div.card-body ul.torrent-info-list > li:nth-child(3) > strong.db-value';
const D_CATEGORY = '.cat-badge';
const D_UPLOADER =
  'div.torrent-detail-card > div.card-body ul.torrent-info-list > li:nth-child(4) > a';
const D_LAST_CHECKED =
  'div.torrent-detail-card > div.card-body ul.torrent-info-list li:nth-child(5) > strong.db-value';
const D_DESCRIPTION = 'div.torrent-info-card > div.torrent-info-content';
const D_MAGNET_URI = '#downloadMagnetBtn';

/** jsoup-like ownText: only direct text nodes of the element. */
function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

function categoryFromRawString(raw: string): Category {
  switch (raw) {
    case 'Software':
      return 'Apps';
    case 'E-Books':
    case 'AudioBooks':
      return 'Books';
    case 'Games':
      return 'Games';
    case 'Movies':
      return 'Movies';
    case 'Music':
      return 'Music';
    case 'Porn':
      return 'Porn';
    case 'TV':
      return 'Series';
    default:
      return 'Other';
  }
}

function toUint(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.trim());
  return Number.isNaN(n) ? 0 : n;
}

function toUintOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

/**
 * 详情页 uploadDate 解析：先按带时区格式，失败回退无时区格式。
 * 对应 Kotlin runCatching { parse(xxx) }.recoverCatching { parse(无时区) }.
 */
function parseDetailsUploadDate(raw: string): string | null {
  return parseDate(raw, DATE_FORMAT_WITH_TZ) ?? parseDate(raw, DATE_FORMAT);
}

function parseResultsHtml(html: string, pageUrl: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  $(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    const $nameEl = $row.find(TORRENT_NAME_SEL).first();
    if ($nameEl.length === 0) return;
    const torrentName = ownText($nameEl);
    const href = $nameEl.attr('href') ?? '';
    if (!href.startsWith('/track/magnet/')) return;
    const infoHash = href.replace(/^\/track\/magnet\//, '').split('?')[0];
    const magnetUri = `${createMagnetUri(infoHash)}&tr=${TORRENT_DATABASE_TRACKER_URL}`;

    const descriptionPageUrl = resolveUrl(
      $row.find(DESCRIPTION_PAGE_URL_SEL).first().attr('href'),
      pageUrl,
    );
    const categoryRaw = ownText($row.find(CATEGORY_SEL).first());
    const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;
    const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, DATE_FORMAT) : null;
    const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()));
    const peers = toUint(ownText($row.find(PEERS_SEL).first()));

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'torrentdatabase',
        uploadDate,
        category,
        descriptionPageUrl,
        magnetUri,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const name = ownText($(D_TORRENT_NAME).first());
  if (!name) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  const sizeRaw = ownText($(D_SIZE).first());
  const size = sizeRaw ? normalizeSize(sizeRaw) : null;
  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));
  const uploadDateRaw = ownText($(D_UPLOAD_DATE).first());
  const uploadDate = uploadDateRaw ? parseDetailsUploadDate(uploadDateRaw) : null;
  const categoryRaw = ownText($(D_CATEGORY).first());
  const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;
  const uploader = ownText($(D_UPLOADER).first()) || null;
  const lastCheckedRaw = ownText($(D_LAST_CHECKED).first());
  const lastChecked = lastCheckedRaw ? parseDate(lastCheckedRaw, DATE_FORMAT) : null;
  const description = $(D_DESCRIPTION).first().html() ?? null;

  return {
    infoHash,
    name,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader,
    lastChecked,
    magnetUri,
    fileDownloadLink: null,
    description,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class TorrentDatabaseProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'torrentdatabase';
  readonly name = 'TorrentDatabase';
  readonly url = 'https://developify.ca';
  readonly supportedCategories: readonly Category[] = [
    'Apps',
    'Books',
    'Games',
    'Movies',
    'Music',
    'Porn',
    'Series',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = true;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    let requestUrl = `${this.url}/newest?q=${encodeURIComponent(query)}`;
    const cat = CATEGORY_MAP[ctx.category];
    if (cat) requestUrl += `&category=${cat}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    let requestUrl = `${this.url}/newest`;
    if (category !== 'All') {
      const cat = CATEGORY_MAP[category];
      if (cat) {
        // Books 类别需去掉连字符（"e-books" → "ebooks"）
        const slug = category === 'Books' ? cat.replace('-', '') : cat;
        requestUrl += `_${slug}`;
      }
    }
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    if (category === 'All') return this.getLatestTorrents();
    const cat = CATEGORY_MAP[category];
    if (!cat) return [];
    const slug = category === 'Books' ? cat.replace('-', '') : cat;
    const requestUrl = `${this.url}/top_seeded_${slug}`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }
}
