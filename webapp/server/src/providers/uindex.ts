/**
 * UIndex Provider
 * 对应原 Kotlin providers/UIndex.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 列表项已含 magnet（a.sr-magnet），无二次请求。
 * Cloudflare 保护（cloudflareSolverUrl 指向 search.php?search=ubuntu）。
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
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
  tryParseRelative,
} from './_shared.js';

const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss';

const CATEGORY_MAP: Record<Category, number> = {
  All: 0,
  Books: 0,
  Anime: 7,
  Apps: 5,
  Games: 3,
  Movies: 1,
  Music: 4,
  Porn: 6,
  Series: 2,
  Other: 8,
};

// Results page selectors
const LIST_ITEM_CONTAINER = 'table.sr-table, table.top-table';
const LIST_ITEM = 'tbody > tr';
const NAME_SEL = 'td.sr-col-name > a.sr-torrent-link';
const SIZE_SEL = 'td.sr-col-size';
const SEEDERS_SEL = 'td.sr-col-seeders > span.sr-seed';
const PEERS_SEL = 'td.sr-col-leechers > span.sr-leech';
const UPLOAD_DATE_SEL = 'td.sr-col-uploaded';
const CATEGORY_SEL = 'td.sr-col-cat > a.sr-cat-badge';
const MAGNET_URI_SEL = 'td.sr-col-name > a.sr-magnet';

// Details page selectors
const D_NAME = '.dt-title';
const D_SIZE =
  '#content > div.dt-info-card > div > div:nth-child(1) > div:nth-child(2) > span.dt-info-value';
const D_SEEDERS = '.dt-seed';
const D_PEERS = '.dt-leech';
const D_UPLOAD_DATE =
  '#content > div.dt-info-card > div > div:nth-child(1) > div:nth-child(3) > span.dt-info-value > span.dt-info-dim';
const D_CATEGORY = '.sr-cat-badge';
const D_PEERS_UPDATED =
  '#content > div.dt-info-card > div > div:nth-child(2) > div:nth-child(3) > span.dt-info-value > span.dt-info-dim';
const D_DESCRIPTION = '.dt-descr-body';
const D_THUMBNAIL = '.tmdb-poster > img';
const D_MAGNET_URI = 'a.dt-download-btn';

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
    case 'Anime':
      return 'Anime';
    case 'Apps':
      return 'Apps';
    case 'Games':
      return 'Games';
    case 'Movies':
      return 'Movies';
    case 'Music':
      return 'Music';
    case 'XXX':
      return 'Porn';
    case 'TV':
      return 'Series';
    case 'Other':
      return 'Other';
    default:
      return 'Other';
  }
}

function toUintOrNull(s: string | undefined): number | null {
  if (!s) return null;
  // Kotlin: filter { it != ',' } then toUIntOrNull
  const cleaned = s.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function toUint(s: string | undefined): number {
  return toUintOrNull(s) ?? 0;
}

/** 详情页日期：去除 ( ) 包裹后按 "yyyy-MM-dd HH:mm:ss" 解析。 */
function parseDetailsDate(date: string): string | null {
  const stripped = date.replace(/^\(/, '').replace(/\)$/, '').trim();
  return parseDate(stripped, DATE_FORMAT);
}

function parseResultsHtml(html: string, pageUrl: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const $container = $(LIST_ITEM_CONTAINER).first();
  if ($container.length === 0) return [];
  const out: Torrent[] = [];
  $container.find(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    const name = $row.find(NAME_SEL).first().text().trim();
    if (!name) return;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('href');
    if (!magnetUri) return;
    const infoHash = parseInfoHashFromMagnet(magnetUri);
    const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
    const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()));
    const peers = toUint(ownText($row.find(PEERS_SEL).first()));
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    const uploadDate = uploadDateRaw ? tryParseRelative(uploadDateRaw) : null;
    const categoryRaw = ownText($row.find(CATEGORY_SEL).first());
    const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;
    const detailsPageUrl = resolveUrl(
      $row.find(NAME_SEL).first().attr('href'),
      pageUrl,
    );

    out.push(
      makeTorrent({
        infoHash,
        name,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'uindex',
        uploadDate,
        category,
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const name = ownText($(D_NAME).first());
  if (!name) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  const size = ownText($(D_SIZE).first()) || null;
  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));
  const uploadDateRaw = ownText($(D_UPLOAD_DATE).first());
  const uploadDate = uploadDateRaw ? parseDetailsDate(uploadDateRaw) : null;
  const categoryRaw = ownText($(D_CATEGORY).first());
  const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;
  const lastCheckedRaw = $(D_PEERS_UPDATED).first().text().trim();
  const lastChecked = lastCheckedRaw ? parseDetailsDate(lastCheckedRaw) : null;
  const description = $(D_DESCRIPTION).first().html() ?? null;
  const posterUrl = resolveUrl($(D_THUMBNAIL).first().attr('src'), pageUrl) || null;

  return {
    infoHash,
    name,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader: null,
    lastChecked,
    magnetUri,
    fileDownloadLink: null,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class UIndexProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'uindex';
  readonly name = 'UIndex';
  readonly url = 'https://uindex.org';
  readonly cloudflareSolverUrl = `${this.url}/search.php?search=ubuntu`;
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Games',
    'Movies',
    'Music',
    'Porn',
    'Series',
    'Other',
  ];
  readonly safetyStatus = 'Safe' as const;
  // CF 保护：默认不启用，需在设置中配置 FlareSolverr 后手动开启
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = true;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[ctx.category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}/search.php?search=${encodeURIComponent(query)}&c=${categoryId}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}/search.php?c=${categoryId}`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}/top.php?t=24h&c=${categoryId}`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }
}
