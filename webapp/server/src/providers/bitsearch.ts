/**
 * BitSearch Provider
 * 对应原 Kotlin providers/BitSearch.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 搜索阶段并发抓取 5 页（p-limit(5)）合并结果。
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import pLimit from 'p-limit';
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
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
  tryParseRelative,
} from './_shared.js';

const SEARCH_PAGE_CONCURRENCY = 5;
const DATE_FORMAT = 'M/D/YYYY';

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

function categoryFromRawString(raw: string): Category {
  switch (raw) {
    case 'Other':
    case 'Other/Audio':
    case 'Other/Video':
    case 'Other/Image':
    case 'Other/Document':
    case 'Other/Program':
    case 'Other/Android':
    case 'Other/DiskImage':
    case 'Other/Source Code':
    case 'Other/Database':
    case 'Other/Archive':
      return 'Other';
    case 'Movies':
    case 'Movies/Dub/Dual Audio':
      return 'Movies';
    case 'TV':
      return 'Series';
    case 'Anime':
    case 'Anime/Dub/Dual Audio':
    case 'Anime/Subbed':
    case 'Anime/Raw':
      return 'Anime';
    case 'Softwares':
    case 'Softwares/Windows':
    case 'Softwares/Mac':
    case 'Softwares/Android':
      return 'Apps';
    case 'Games':
    case 'Games/PC':
    case 'Games/Mac':
    case 'Games/Linux':
    case 'Games/Android':
      return 'Games';
    case 'Music':
    case 'Music/mp3':
    case 'Music/Lossless':
    case 'Music/Album':
    case 'Music/Video':
      return 'Music';
    case 'AudioBook':
    case 'Ebook/Course':
      return 'Books';
    case 'XXX':
      return 'Porn';
    default:
      return 'Other';
  }
}

// ============== Results page ==============

const LIST_ITEM = 'div.space-y-4 > div > div:nth-child(1)';

function parseResultsHtml(html: string, pageUrl: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  $(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    // TORRENT_INFO = > div:nth-child(1); DOWNLOAD_LINKS = > div:nth-child(2)
    const $torrentInfo = $row.children('div:nth-child(1)').first();
    const $downloadLinks = $row.children('div:nth-child(2)').first();
    // CATEGORY_AND_METADATA = TORRENT_INFO > div:nth-last-child(2)
    // SWARM_STATS = TORRENT_INFO > div:nth-last-child(1)
    const $catAndMeta = $torrentInfo.children('div:nth-last-child(2)').first();
    const $swarmStats = $torrentInfo.children('div:nth-last-child(1)').first();

    const torrentName = ownText($torrentInfo.find('h3').first());
    if (!torrentName) return;
    const magnetUri = $downloadLinks.children('a:nth-child(2)').first().attr('href');
    if (!magnetUri) return;
    const detailsPageUrl =
      resolveUrl($torrentInfo.find('h3 > a').first().attr('href'), pageUrl) || '';
    const fileDownloadLink =
      resolveUrl($downloadLinks.children('a:nth-child(1)').first().attr('href'), pageUrl) || null;
    const infoHash = parseInfoHashFromMagnet(magnetUri);

    const size =
      ownText($catAndMeta.children('span:nth-child(2)').first().children('span').first()) ||
      '0 KB';
    const seeders =
      toUintOrNull(
        ownText(
          $swarmStats
            .children('span:nth-child(1)')
            .first()
            .children('span:nth-child(2)')
            .first(),
        ),
      ) ?? 0;
    const peers =
      toUintOrNull(
        ownText(
          $swarmStats
            .children('span:nth-child(2)')
            .first()
            .children('span:nth-child(2)')
            .first(),
        ),
      ) ?? 0;
    const uploadDateRaw = ownText(
      $catAndMeta.children('span:nth-child(3)').first().children('span').first(),
    );
    const uploadDate = uploadDateRaw
      ? parseDate(uploadDateRaw, DATE_FORMAT) ?? tryParseRelative(uploadDateRaw)
      : null;
    const categoryRaw = ownText(
      $catAndMeta.children('span:nth-child(1)').first().children('span').first(),
    );
    const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'bitsearch',
        uploadDate,
        category,
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
        fileDownloadLink,
      }),
    );
  });
  return out;
}

// ============== Details page ==============

const D_NAME =
  'body > div > main > div > main > div > div.lg\\:col-span-2.space-y-4.sm\\:space-y-6.lg\\:space-y-8 > div.bg-white.rounded-xl.shadow-lg.border.border-gray-200.overflow-hidden > div.bg-gradient-to-r.from-blue-600.to-purple-600.p-3.sm\\:p-4.text-white > div > div.flex.flex-col.sm\\:flex-row.gap-3.sm\\:gap-4 > div.flex-1.min-w-0.text-center.sm\\:text-left > h1';
const D_SIZE =
  'body > div > main > div > main > div > div.lg\\:col-span-2.space-y-4.sm\\:space-y-6.lg\\:space-y-8 > div.bg-white.rounded-xl.shadow-lg.border.border-gray-200.overflow-hidden > div.bg-gradient-to-r.from-blue-600.to-purple-600.p-3.sm\\:p-4.text-white > div > div.grid.grid-cols-2.sm\\:grid-cols-4.gap-2.sm\\:gap-3 > div:nth-child(3) > div.text-lg.sm\\:text-xl.font-bold.text-white';
const D_SEEDERS =
  'body > div > main > div > main > div > div.lg\\:col-span-2.space-y-4.sm\\:space-y-6.lg\\:space-y-8 > div.bg-white.rounded-xl.shadow-lg.border.border-gray-200.overflow-hidden > div.bg-gradient-to-r.from-blue-600.to-purple-600.p-3.sm\\:p-4.text-white > div > div.grid.grid-cols-2.sm\\:grid-cols-4.gap-2.sm\\:gap-3 > div:nth-child(1) > div.text-lg.sm\\:text-xl.font-bold.text-white';
const D_PEERS =
  'body > div > main > div > main > div > div.lg\\:col-span-2.space-y-4.sm\\:space-y-6.lg\\:space-y-8 > div.bg-white.rounded-xl.shadow-lg.border.border-gray-200.overflow-hidden > div.bg-gradient-to-r.from-blue-600.to-purple-600.p-3.sm\\:p-4.text-white > div > div.grid.grid-cols-2.sm\\:grid-cols-4.gap-2.sm\\:gap-3 > div:nth-child(2) > div.text-lg.sm\\:text-xl.font-bold.text-white';
const D_UPLOAD_DATE =
  'body > div > main > div > main > div > div.lg\\:col-span-2.space-y-4.sm\\:space-y-6.lg\\:space-y-8 > div.flex.flex-col.gap-6 > div:nth-child(1) > div.p-6 > div.grid.grid-cols-1.md\\:grid-cols-2.gap-8 > div.space-y-4 > div > div:nth-child(1) > div.text-sm.font-bold.text-gray-900';
const D_LAST_CHECKED =
  'body > div > main > div > main > div > div.lg\\:col-span-2.space-y-4.sm\\:space-y-6.lg\\:space-y-8 > div.flex.flex-col.gap-6 > div:nth-child(1) > div.p-6 > div.grid.grid-cols-1.md\\:grid-cols-2.gap-8 > div.space-y-4 > div > div:nth-child(2) > div.text-sm.font-bold.text-gray-900';
const D_CATEGORY =
  'body > div > main > div > main > div > div.lg\\:col-span-2.space-y-4.sm\\:space-y-6.lg\\:space-y-8 > div.bg-white.rounded-xl.shadow-lg.border.border-gray-200.overflow-hidden > div.bg-gradient-to-r.from-blue-600.to-purple-600.p-3.sm\\:p-4.text-white > div > div.flex.flex-col.sm\\:flex-row.gap-3.sm\\:gap-4 > div.flex-1.min-w-0.text-center.sm\\:text-left > div.flex.flex-wrap.justify-center.sm\\:justify-start.gap-1\\.5.sm\\:gap-2.mb-2.sm\\:mb-3 > span.inline-flex.items-center.px-2.sm\\:px-3.py-1.rounded-full.text-xs.font-semibold.bg-white.bg-opacity-20.text-white.backdrop-blur-sm';
const D_MAGNET_URI = 'a[href^="magnet:?"]';
const D_FILE_DOWNLOAD_LINK = 'a[href^="/download/torrent/"]';

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
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, DATE_FORMAT) : null;
  const lastCheckedRaw = ownText($(D_LAST_CHECKED).first());
  const lastChecked = lastCheckedRaw ? parseDate(lastCheckedRaw, DATE_FORMAT) : null;
  const categoryRaw = ownText($(D_CATEGORY).first());
  const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;
  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;

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
    fileDownloadLink,
    description: null,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

// ============== Provider ==============

function getCategoryId(category: Category): number | null {
  switch (category) {
    case 'All':
      return null;
    case 'Anime':
      return 4;
    case 'Apps':
      return 5;
    case 'Books':
      return 9;
    case 'Games':
      return 6;
    case 'Movies':
      return 2;
    case 'Music':
      return 7;
    case 'Porn':
      return 10;
    case 'Series':
      return 3;
    case 'Other':
      return 1;
  }
}

export class BitSearchProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'bitsearch';
  readonly name = 'BitSearch';
  readonly url = 'https://bitsearch.to';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Books',
    'Games',
    'Movies',
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
    const categoryId = getCategoryId(ctx.category);
    const limit = pLimit(SEARCH_PAGE_CONCURRENCY);
    const pages = await Promise.all(
      [1, 2, 3, 4, 5].map((page) =>
        limit(() => this.searchPage(query, categoryId, ctx.httpClient, page)),
      ),
    );
    return pages.flat();
  }

  private async searchPage(
    query: string,
    categoryId: number | null,
    httpClient: HttpClient,
    page: number,
  ): Promise<Torrent[]> {
    let requestUrl = `${this.url}/search?q=${encodeURIComponent(query)}&page=${page}&sortBy=seeders`;
    if (categoryId !== null) {
      requestUrl += `&category=${categoryId}`;
    }
    const html = await httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categoryId = getCategoryId(category);
    const requestUrl =
      categoryId !== null
        ? `${this.url}/latest?category=${categoryId}`
        : `${this.url}/latest`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categoryId = getCategoryId(category);
    const requestUrl =
      categoryId !== null
        ? `${this.url}/trending?category=${categoryId}`
        : `${this.url}/trending`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }
}
