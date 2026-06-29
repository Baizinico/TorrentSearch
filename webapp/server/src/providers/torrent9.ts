/**
 * Torrent9 Provider
 * 对应原 Kotlin providers/Torrent9.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TopTorrentsProvider + TorrentDetailsProvider
 * 搜索/Latest/Top 阶段对每个结果项二次请求详情页拿 magnet/infoHash 及所有字段。
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
  normalizeSize,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
} from './_shared.js';

const DETAIL_CONCURRENCY = 5;

const CATEGORY_MAP: Partial<Record<Category, string>> = {
  Apps: 'logiciels',
  Books: 'ebook',
  Games: 'jeux-pc',
  Movies: 'films',
  Music: 'musique',
  Series: 'series',
};

// Results page selectors
const LIST_ITEM = 'table > tbody > tr';
const DETAILS_PAGE_URL_SEL = 'td:nth-child(1) > a';

// Details page selectors
const D_TORRENT_NAME = 'div.movie-section h1';
const D_MAGNET_URL = 'a[href^="magnet:?"]';
const D_SEEDERS = 'li[style="color:green"]';
const D_PEERS = 'li[style="color:red"]';
const D_DESCRIPTION = 'p.description_torrent';
const D_POSTER_URL = 'div.movie-img > img';

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

/** Finds the first element matching `selector` whose own text contains `needle` (jsoup :containsOwn). */
function findOwnTextContainsNode(
  $root: cheerio.CheerioAPI,
  selector: string,
  needle: string,
): AnyNode | null {
  let foundNode: AnyNode | null = null;
  $root(selector).each((_, el) => {
    if (foundNode) return false;
    if (ownText($root(el)).includes(needle)) {
      foundNode = el;
      return false;
    }
  });
  return foundNode;
}

function getCategoryFromRaw(raw: string): Category {
  switch (raw) {
    case 'ebook':
      return 'Books';
    case 'films':
      return 'Movies';
    case 'jeux-consoles':
      return 'Games';
    case 'jeux-pc':
      return 'Games';
    case 'logiciels':
      return 'Apps';
    case 'musique':
      return 'Music';
    case 'series':
      return 'Series';
    default:
      return 'Other';
  }
}

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const torrentName = ownText($(D_TORRENT_NAME).first());
  if (!torrentName) return null;
  const magnetUri = $(D_MAGNET_URL).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  // Size: strong:containsOwn(Poids du torrent) -> parent -> next -> next ownText, drop last char, + "B", normalize
  let size: string | null = null;
  const sizeStrong = findOwnTextContainsNode($, 'strong', 'Poids du torrent');
  if (sizeStrong) {
    const raw = ownText($(sizeStrong).parent().next().next());
    if (raw) size = normalizeSize(`${raw.slice(0, -1)}B`);
  }

  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));

  // Upload date: strong:containsOwn(Date d'ajout) -> parent -> next -> next ownText, parse dd/MM/yyyy
  let uploadDate: string | null = null;
  const dateStrong = findOwnTextContainsNode($, 'strong', "Date d'ajout");
  if (dateStrong) {
    const raw = ownText($(dateStrong).parent().next().next());
    if (raw) uploadDate = parseDate(raw, 'DD/MM/YYYY');
  }

  // Category: strong:containsOwn(Catégories) -> parent -> next -> next -> a href, strip prefix/suffix
  let category: Category | null = null;
  const catStrong = findOwnTextContainsNode($, 'strong', 'Catégories');
  if (catStrong) {
    const href = $(catStrong).parent().next().next().find('a').first().attr('href') ?? '';
    const cleaned = href.replace(/^\/torrents_/, '').replace(/\.html$/, '');
    if (cleaned) category = getCategoryFromRaw(cleaned);
  }

  const description = $(D_DESCRIPTION).first().html() ?? null;
  const posterUrl = resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) || null;

  return {
    infoHash,
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink: null,
    description,
    posterUrl,
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
  const items = $(LIST_ITEM).toArray();
  const limit = pLimit(DETAIL_CONCURRENCY);
  const results = await Promise.all(
    items.map((item) =>
      limit(async () => {
        const $row = $(item);
        const detailsPageUrl = resolveUrl($row.find(DETAILS_PAGE_URL_SEL).first().attr('href'), pageUrl);
        if (!detailsPageUrl) return null;
        const detailsHtml = await httpClient.get(detailsPageUrl);
        const details = parseDetailsHtml(detailsHtml, detailsPageUrl);
        if (!details) return null;

        return makeTorrent({
          infoHash: details.infoHash,
          name: details.name,
          size: details.size ?? '0 KB',
          seeders: details.seeders ?? 0,
          peers: details.peers ?? 0,
          providerName,
          providerId: 'torrent9',
          uploadDate: details.uploadDate,
          category: details.category,
          descriptionPageUrl: detailsPageUrl,
          magnetUri: details.magnetUri,
        });
      }),
    ),
  );
  return results.filter((t): t is Torrent => t !== null);
}

export class Torrent9Provider
  implements
    SearchProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider,
    TorrentDetailsProvider
{
  readonly id = 'torrent9';
  readonly name = 'Torrent9';
  readonly url = 'https://www6.torrent9.to';
  readonly supportedCategories: readonly Category[] = [
    'Apps',
    'Books',
    'Games',
    'Movies',
    'Music',
    'Series',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const q = encodeURIComponent(query);
    const categorySlug = CATEGORY_MAP[ctx.category];
    const requestUrl = categorySlug
      ? `${this.url}/search_torrent/${categorySlug}/${q}.html`
      : `${this.url}/search_torrent/${q}.html`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categorySlug = CATEGORY_MAP[category];
    if (!categorySlug) return [];
    const requestUrl = `${this.url}/torrents_${categorySlug}.html`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/top_torrent.html`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }
}
