/**
 * OxTorrent Provider
 * 对应原 Kotlin providers/OxTorrent.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TopTorrentsProvider + TorrentDetailsProvider
 * 搜索/Latest/Top 阶段对每个结果项二次请求详情页拿所有字段。
 * 详情页用 jsoup :containsOwn 选择器定位 label td（这里用 findOwnTextContainsNode 替代）。
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
const D_TORRENT_NAME = 'div.title > a';
const D_MAGNET_URL = 'div.btn-magnet > a';
const D_DESCRIPTION = 'div#torrentsdesc';
const D_POSTER_URL = 'img.img-rounded';

/** jsoup-like ownText: only direct text nodes of the element. */
function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
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

function toUintOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
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

  // Size: td:containsOwn(Poids du fichier:) -> nextElementSibling -> text()
  let size: string | null = null;
  const sizeTd = findOwnTextContainsNode($, 'td', 'Poids du fichier:');
  if (sizeTd) {
    size = $(sizeTd).next().text().trim() || null;
  }

  // Seeders: td:containsOwn(Seeders:) -> nextElementSibling -> text()
  let seeders: number | null = null;
  const seedersTd = findOwnTextContainsNode($, 'td', 'Seeders:');
  if (seedersTd) {
    seeders = toUintOrNull($(seedersTd).next().text());
  }

  // Peers: td:containsOwn(Leechers:) -> nextElementSibling -> text()
  let peers: number | null = null;
  const peersTd = findOwnTextContainsNode($, 'td', 'Leechers:');
  if (peersTd) {
    peers = toUintOrNull($(peersTd).next().text());
  }

  // Upload date: td:containsOwn(Date d'ajout:) -> nextElementSibling -> text() -> parse dd/MM/yyyy
  let uploadDate: string | null = null;
  const dateTd = findOwnTextContainsNode($, 'td', "Date d'ajout:");
  if (dateTd) {
    const raw = $(dateTd).next().text().trim();
    if (raw) uploadDate = parseDate(raw, 'DD/MM/YYYY');
  }

  // Category: td:containsOwn(Catégories:) -> nextElementSibling -> strong > a href -> removePrefix("/torrents/")
  let category: Category | null = null;
  const catTd = findOwnTextContainsNode($, 'td', 'Catégories:');
  if (catTd) {
    const href = $(catTd).next().find('strong > a').first().attr('href') ?? '';
    const cleaned = href.replace(/^\/torrents\//, '');
    if (cleaned) category = getCategoryFromRaw(cleaned);
  }

  const description = $(D_DESCRIPTION).first().html() ?? null;
  const posterUrl = resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) || null;

  return {
    infoHash,
    magnetUri,
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader: null,
    lastChecked: null,
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
        const detailsPageUrl = resolveUrl(
          $row.find(DETAILS_PAGE_URL_SEL).first().attr('href'),
          pageUrl,
        );
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
          providerId: 'oxtorrent',
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

export class OxTorrentProvider
  implements
    SearchProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider,
    TorrentDetailsProvider
{
  readonly id = 'oxtorrent';
  readonly name = 'OxTorrent';
  readonly url = 'https://oxtorrent.co';
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
    const categorySlug = CATEGORY_MAP[ctx.category];
    const q = encodeURIComponent(query);
    const requestUrl = categorySlug
      ? `${this.url}/recherche/${categorySlug}/${q}`
      : `${this.url}/recherche/${q}`;
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
    const requestUrl = `${this.url}/torrents/${categorySlug}`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/top`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }
}
