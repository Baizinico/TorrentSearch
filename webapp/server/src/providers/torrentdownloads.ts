/**
 * TorrentDownloads Provider
 * 对应原 Kotlin providers/TorrentDownloads.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TopTorrentsProvider + TorrentDetailsProvider
 * 搜索/Latest/Top 阶段对每个结果项二次请求详情页拿 magnet/infoHash。
 * Cloudflare 保护（cloudflareSolverUrl 指向搜索页）。
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
} from './_shared.js';

const DETAIL_CONCURRENCY = 5;

const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss';

// Results page selectors
const LIST_ITEM_CONTAINER = 'div.inner_container';
const LIST_ITEM = 'div.grey_bar3';
const TORRENT_NAME_SEL = 'p:nth-child(1) > a:nth-child(2)';
const SIZE_SEL = 'span:nth-child(5)';
const SEEDERS_SEL = 'span:nth-child(4)';
const PEERS_SEL = 'span:nth-child(3)';
const CATEGORY_SEL = 'p:nth-child(1) > img:nth-child(1)';

// Details page selectors
const D_TORRENT_NAME = 'div.inner_container > h1.titl_1 > span';
const D_SIZE = 'div.inner_container > div:nth-child(13) > p';
const D_SEEDERS = 'div.inner_container > div:nth-child(15) > p';
const D_PEERS = 'div.inner_container > div:nth-child(16) > p';
const D_UPLOAD_DATE = 'div.inner_container > div:nth-child(19) > p';
const D_CATEGORY = 'div.inner_container > h1:nth-child(1) > img';
const D_LAST_CHECKED = 'div.inner_container > div:nth-child(18) > p';
const D_MAGNET_URI = 'a[href^="magnet:?"]';
const D_FILE_DOWNLOAD_LINK = 'u.download > li:nth-child(2) > a';

/** jsoup-like ownText: only direct text nodes of the element. */
function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
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

function getCategoryFromCategoryIconUrl(url: string): Category {
  const name = url.replace(/^\/templates\/new\/images\/icons\//, '');
  switch (name) {
    case 'menu_icon0.png':
      return 'All';
    case 'menu_icon1.png':
      return 'Anime';
    case 'menu_icon2.png':
      return 'Books';
    case 'menu_icon3.png':
      return 'Games';
    case 'menu_icon4.png':
      return 'Movies';
    case 'menu_icon5.png':
      return 'Music';
    case 'menu_icon7.png':
      return 'Apps';
    case 'menu_icon8.png':
      return 'Series';
    case 'menu_icon9.png':
      return 'Other';
    default:
      return 'Other';
  }
}

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const torrentName = ownText($(D_TORRENT_NAME).first());
  if (!torrentName) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  const size = ownText($(D_SIZE).first()) || null;
  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));
  const uploadDateRaw = ownText($(D_UPLOAD_DATE).first()).trim();
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, DATE_FORMAT) : null;
  const categorySrc = $(D_CATEGORY).first().attr('src') ?? '';
  const category = categorySrc ? getCategoryFromCategoryIconUrl(categorySrc) : null;

  const lastCheckedRaw = ownText($(D_LAST_CHECKED).first());
  let lastChecked: string | null = null;
  if (lastCheckedRaw) {
    const cleaned = lastCheckedRaw.replace(/\s\(\)$/, '').trim();
    if (cleaned) lastChecked = parseDate(cleaned, DATE_FORMAT);
  }

  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;

  return {
    infoHash,
    name: torrentName,
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

async function parseResultsHtml(
  html: string,
  pageUrl: string,
  providerName: string,
  httpClient: HttpClient,
): Promise<Torrent[]> {
  const $ = cheerio.load(html);
  const $container = $(LIST_ITEM_CONTAINER).last();
  if ($container.length === 0) return [];
  // Drop the first 2 items (header rows in source).
  const items = $container.find(LIST_ITEM).slice(2).toArray();
  const limit = pLimit(DETAIL_CONCURRENCY);
  const results = await Promise.all(
    items.map((item) =>
      limit(async () => {
        const $row = $(item);
        const detailsPageUrl = resolveUrl($row.find(TORRENT_NAME_SEL).first().attr('href'), pageUrl);
        if (!detailsPageUrl) return null;
        const detailsHtml = await httpClient.get(detailsPageUrl);
        const details = parseDetailsHtml(detailsHtml, detailsPageUrl);
        if (!details) return null;

        const size = details.size ?? ownText($row.find(SIZE_SEL).first()) ?? '0 KB';
        const seeders = details.seeders ?? toUint(ownText($row.find(SEEDERS_SEL).first()));
        const peers = details.peers ?? toUint(ownText($row.find(PEERS_SEL).first()));
        const uploadDate = details.uploadDate;
        let category = details.category;
        if (!category) {
          const catSrc = $row.find(CATEGORY_SEL).first().attr('src') ?? '';
          if (catSrc) category = getCategoryFromCategoryIconUrl(catSrc);
        }

        return makeTorrent({
          infoHash: details.infoHash,
          name: details.name,
          size,
          seeders,
          peers,
          providerName,
          providerId: 'torrentdownloads',
          uploadDate,
          category,
          descriptionPageUrl: detailsPageUrl,
          magnetUri: details.magnetUri,
        });
      }),
    ),
  );
  return results.filter((t): t is Torrent => t !== null);
}

export class TorrentDownloadsProvider
  implements
    SearchProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider,
    TorrentDetailsProvider
{
  readonly id = 'torrentdownloads';
  readonly name = 'TorrentDownloads';
  readonly url = 'https://torrentdownloads.pro';
  readonly cloudflareSolverUrl = `${this.url}/search/?s_cat=0&search=ubuntu`;
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Books',
    'Games',
    'Movies',
    'Music',
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

  private getCategoryId(category: Category): number {
    switch (category) {
      case 'All':
        return 0;
      case 'Anime':
        return 1;
      case 'Apps':
        return 7;
      case 'Books':
        return 2;
      case 'Games':
        return 3;
      case 'Movies':
        return 4;
      case 'Music':
        return 5;
      case 'Series':
        return 8;
      case 'Porn':
      case 'Other':
        return 9;
    }
  }

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const categoryId = this.getCategoryId(ctx.category);
    const requestUrl = `${this.url}/search/?s_cat=${categoryId}&search=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = (() => {
      switch (category) {
        case 'Anime':
          return `${this.url}/view/today/Anime.html`;
        case 'Apps':
          return `${this.url}/view/today/Software.html`;
        case 'Books':
          return `${this.url}/view/today/Books.html`;
        case 'Games':
          return `${this.url}/view/today/Games.html`;
        case 'Movies':
          return `${this.url}/view/today/Movies.html`;
        case 'Music':
          return `${this.url}/view/today/Music.html`;
        case 'Series':
          return `${this.url}/view/today/TV_Shows.html`;
        case 'Other':
          return `${this.url}/view/today/Other.html`;
        default:
          return `${this.url}/most-active`;
      }
    })();
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = (() => {
      switch (category) {
        case 'Anime':
          return `${this.url}/view/popular/Anime.html`;
        case 'Apps':
          return `${this.url}/view/popular/Software.html`;
        case 'Books':
          return `${this.url}/view/popular/Books.html`;
        case 'Games':
          return `${this.url}/view/popular/Games.html`;
        case 'Movies':
          return `${this.url}/view/popular/Movies.html`;
        case 'Music':
          return `${this.url}/view/popular/Music.html`;
        case 'Series':
          return `${this.url}/view/popular/TV_Shows.html`;
        case 'Other':
          return `${this.url}/view/popular/Other.html`;
        default:
          return `${this.url}/most-seeded`;
      }
    })();
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }
}
