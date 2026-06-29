/**
 * TokyoToshokan Provider
 * 对应原 Kotlin providers/TokyoToshokan.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 通过 tokyotosho.info 抓取 HTML 解析。结果列表使用相邻行对（zipWithNext 语义）。
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
} from './_shared.js';

const CATEGORY_MAP: Record<Category, number> = {
  All: 0,
  Anime: 1,
  Books: 3,
  Music: 2,
  Porn: 15,
  Other: 5,
  Apps: 0,
  Games: 0,
  Movies: 0,
  Series: 0,
};

function categoryFromId(id: string): Category {
  switch (id) {
    case '1':
    case '7':
    case '8':
    case '10':
    case '11':
      return 'Anime';
    case '3':
      return 'Books';
    case '2':
    case '9':
      return 'Music';
    case '4':
    case '12':
    case '13':
    case '14':
    case '15':
      return 'Porn';
    case '5':
      return 'Other';
    default:
      return 'Other';
  }
}

const LIST_ITEM = 'table.listing > tbody > tr:nth-child(n+2)';
const NAME_SEL = 'td.desc-top > a:nth-child(2)';
const SIZE_AND_UPLOAD_DATE_SEL = 'td.desc-bot';
const SEEDERS_SEL = 'td.stats > span:nth-child(1)';
const PEERS_SEL = 'td.stats > span:nth-child(2)';
const CATEGORY_SEL = 'td:nth-child(1) > a';
const MAGNET_URI_SEL = 'td.desc-top > a:nth-child(1)';
const DETAILS_PAGE_URL_SEL = 'td.web > a:last-child';

function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

/**
 * Strips the leading "Label:" prefix (first whitespace-delimited token) from
 * a `|`-split field, mimicking Kotlin's `trim().dropWhile { !it.isWhitespace() }.trim()`.
 */
function stripLabel(s: string): string {
  const trimmed = s.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) return '';
  return trimmed.slice(firstSpace).trim();
}

/**
 * Parses a date that may include a timezone abbreviation (e.g., "UTC", "EST").
 * dayjs's customParseFormat doesn't understand `z`, so we strip the trailing
 * timezone token and parse the remaining "YYYY-MM-DD HH:mm" / "YYYY-MM-DD hh:mm".
 * This matches the original Kotlin behavior of treating the parsed value as UTC.
 */
function parseTokyoDate(date: string, is12Hour: boolean): string | null {
  const stripped = date.replace(/\s+[A-Za-z]{2,5}$/, '').trim();
  const format = is12Hour ? 'YYYY-MM-DD hh:mm' : 'YYYY-MM-DD HH:mm';
  return parseDate(stripped, format);
}

function parseResultsHtml(html: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  const rows = $(LIST_ITEM).toArray();
  // zipWithNext semantics: pairs (i, i+1). parseListItem returns null for
  // "wrong" pairs where tr1 isn't a desc-top row.
  for (let i = 0; i + 1 < rows.length; i++) {
    const tr1 = $(rows[i]);
    const tr2 = $(rows[i + 1]);
    const t = parseListItem(tr1, tr2, providerName);
    if (t) out.push(t);
  }
  return out;
}

function parseListItem(
  tr1: cheerio.Cheerio<AnyNode>,
  tr2: cheerio.Cheerio<AnyNode>,
  providerName: string,
): Torrent | null {
  const torrentName = ownText(tr1.find(NAME_SEL).first());
  if (!torrentName) return null;
  const magnetUri = tr1.find(MAGNET_URI_SEL).first().attr('href');
  if (!magnetUri) return null;
  const fileDownloadLink = tr1.find(NAME_SEL).first().attr('href') ?? null;
  const detailsPageUrl = tr1.find(DETAILS_PAGE_URL_SEL).first().attr('href') ?? '';
  const categoryHref = tr1.find(CATEGORY_SEL).first().attr('href') ?? '';
  const catId = categoryHref.replace(/^\/\?cat=/, '');
  const category = catId ? categoryFromId(catId) : null;

  const statsText = ownText(tr2.find(SIZE_AND_UPLOAD_DATE_SEL).first());
  const parts = statsText
    .split('|')
    .slice(1)
    .map((s) => stripLabel(s));
  const rawSize = parts[0] ?? null;
  const rawUploadDate = parts[1] ?? null;
  const size = rawSize ? normalizeSize(rawSize) : null;
  const uploadDate = rawUploadDate ? parseTokyoDate(rawUploadDate, false) : null;

  const seedersStr = ownText(tr2.find(SEEDERS_SEL).first());
  const peersStr = ownText(tr2.find(PEERS_SEL).first());
  const seeders = seedersStr ? Number(seedersStr) : 0;
  const peers = peersStr ? Number(peersStr) : 0;

  return makeTorrent({
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    size: size ?? '0 KB',
    seeders: Number.isNaN(seeders) ? 0 : seeders,
    peers: Number.isNaN(peers) ? 0 : peers,
    providerName,
    providerId: 'tokyotoshokan',
    uploadDate,
    category,
    descriptionPageUrl: detailsPageUrl,
    magnetUri,
    fileDownloadLink,
  });
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const INFO_HASH_SEL = '#main > div.details > ul > li:nth-child(18)';
  const NAME_SEL = '#main > div.details > ul > li:nth-child(6) > a';
  const SIZE_SEL = '#main > div.details > ul > li:nth-child(10)';
  const SEEDERS_SEL = '#main > div.details > ul > li:nth-child(20)';
  const PEERS_SEL = '#main > div.details > ul > li:nth-child(22)';
  const UPLOAD_DATE_SEL = '#main > div.details > ul > li:nth-child(8)';
  const CATEGORY_SEL = '#main > div.details > ul > li:nth-child(2) > a';
  const UPLOADER_SEL = '#main > div.details > ul > li:nth-child(28)';
  const MAGNET_URI_SEL = 'a[href^="magnet:?"]';

  const $nameAnchor = $(NAME_SEL).first();
  if ($nameAnchor.length === 0) return null;
  const name = $nameAnchor.text();
  const fileDownloadLink =
    $nameAnchor.attr('type') === 'application/x-bittorrent'
      ? $nameAnchor.attr('href') ?? null
      : null;
  const infoHash = ownText($(INFO_HASH_SEL).first());
  if (!infoHash) return null;
  const magnetUri = $(MAGNET_URI_SEL).first().attr('href') ?? createMagnetUri(infoHash);
  const sizeRaw = ownText($(SIZE_SEL).first());
  const size = sizeRaw ? normalizeSize(sizeRaw) : null;
  const seedersStr = ownText($(SEEDERS_SEL).first());
  const peersStr = ownText($(PEERS_SEL).first());
  const seeders = seedersStr ? Number(seedersStr) : null;
  const peers = peersStr ? Number(peersStr) : null;
  const uploadDateRaw = ownText($(UPLOAD_DATE_SEL).first());
  const uploadDate = uploadDateRaw ? parseTokyoDate(uploadDateRaw, true) : null;
  const categoryHref = $(CATEGORY_SEL).first().attr('href') ?? '';
  const catId = categoryHref.replace(/^index\.php\?cat=/, '');
  const category = catId ? categoryFromId(catId) : null;
  const uploader = ownText($(UPLOADER_SEL).first()) || null;

  return {
    infoHash,
    name,
    size,
    seeders: seeders === undefined || Number.isNaN(seeders) ? null : seeders,
    peers: peers === undefined || Number.isNaN(peers) ? null : peers,
    uploadDate,
    category,
    uploader,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description: null,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class TokyoToshokanProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'tokyotoshokan';
  readonly name = 'TokyoToshokan';
  readonly url = 'https://tokyotosho.info';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Books',
    'Music',
    'Porn',
    'Other',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = true;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[ctx.category] ?? CATEGORY_MAP.All;
    const requestUrl =
      `${this.url}/search.php` +
      `?terms=${encodeURIComponent(query)}` +
      `&type=${categoryId}` +
      `&searchName=true`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    let requestUrl = `${this.url}/index.php`;
    if (category !== 'All') {
      const catId = CATEGORY_MAP[category];
      if (catId !== undefined) requestUrl += `?cat=${catId}`;
    }
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    return this.getLatestTorrents(category);
  }
}
