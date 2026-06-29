/**
 * Dmhy Provider
 * 对应原 Kotlin providers/Dmhy.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 通过 share.dmhy.org 抓取 HTML 解析。
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
  normalizeSize,
  parseDate,
  parseInfoHashFromMagnet,
} from './_shared.js';

const CATEGORY_MAP: Record<Category, number> = {
  All: 0,
  Anime: 2,
  Books: 3,
  Games: 9,
  Music: 4,
  Series: 6,
  Other: 1,
  Apps: 0,
  Movies: 0,
  Porn: 0,
};

function getCategoryFromId(id: string): Category {
  switch (id) {
    case '2':
    case '7':
    case '31':
      return 'Anime';
    case '3':
      return 'Books';
    case '41':
    case '42':
      return 'Series';
    case '4':
    case '43':
    case '44':
    case '15':
      return 'Music';
    case '6':
      return 'Series';
    case '9':
    case '17':
    case '18':
    case '19':
    case '20':
    case '21':
      return 'Games';
    default:
      return 'Other';
  }
}

function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

const LIST_ITEM = 'table#topic_list > tbody > tr';
const TORRENT_NAME_SEL = 'td.title > a';
const SIZE_SEL = 'td:nth-child(5)';
const SEEDERS_SEL = 'td:nth-child(6)';
const PEERS_SEL = 'td:nth-child(7)';
const UPLOAD_DATE_SEL = 'td:nth-child(1) > span';
const CATEGORY_SEL = 'td:nth-child(2) > a';
const MAGNET_URI_SEL = 'td:nth-child(4) > a:nth-child(1)';

function parseResultsHtml(html: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  $(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    const torrentName = ownText($row.find(TORRENT_NAME_SEL).first());
    if (!torrentName) return;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('href');
    if (!magnetUri) return;
    const rawSize = ownText($row.find(SIZE_SEL).first());
    const size = rawSize ? normalizeSize(rawSize) : '0 KB';
    const seedersStr = $row.find(SEEDERS_SEL).first().text().trim();
    const peersStr = $row.find(PEERS_SEL).first().text().trim();
    const seeders = seedersStr ? Number(seedersStr) : 0;
    const peers = peersStr ? Number(peersStr) : 0;
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, 'YYYY/MM/DD HH:mm') : null;
    const className = $row.find(CATEGORY_SEL).first().attr('class') ?? '';
    const catId = className.startsWith('sort-') ? className.slice('sort-'.length) : '';
    const category = catId ? getCategoryFromId(catId) : null;
    const detailsPageUrl = $row.find(TORRENT_NAME_SEL).first().attr('href') ?? '';

    out.push(
      makeTorrent({
        infoHash: parseInfoHashFromMagnet(magnetUri),
        name: torrentName,
        size,
        seeders: Number.isNaN(seeders) ? 0 : seeders,
        peers: Number.isNaN(peers) ? 0 : peers,
        uploadDate,
        category,
        providerName,
        providerId: 'dmhy',
        magnetUri,
        descriptionPageUrl: detailsPageUrl,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const TORRENT_NAME_SEL = 'div.topic-title > h3';
  const SIZE_SEL = 'div.topic-title > div.info > ul > li:nth-child(6) > span';
  const UPLOAD_DATE_SEL = 'div.topic-title > div.info > ul > li:nth-child(2) > span';
  const CATEGORY_SEL = 'div.topic-title > div.info > ul > li:nth-child(1) > span > a';
  const DESCRIPTION_SEL = 'div.topic-nfo';
  const MAGNET_URI_SEL = 'div#resource-tabs > div#tabs-1 > p:nth-child(2) > a#a_magnet';

  const torrentName = $(TORRENT_NAME_SEL).first().text().trim();
  if (!torrentName) return null;
  const magnetUri = $(MAGNET_URI_SEL).first().attr('href');
  if (!magnetUri) return null;
  const sizeRaw = $(SIZE_SEL).first().text();
  const size = sizeRaw ? normalizeSize(sizeRaw) : null;
  const uploadDateRaw = $(UPLOAD_DATE_SEL).first().text();
  // take while not whitespace (just the date part)
  const uploadDateStr = uploadDateRaw.split(/\s/)[0] ?? '';
  const uploadDate = uploadDateStr ? parseDate(uploadDateStr, 'YYYY/MM/DD') : null;
  const categoryHref = $(CATEGORY_SEL).first().attr('href') ?? '';
  const catId = categoryHref.replace(/^\/topics\/list\/sort_id\//, '');
  const category = catId ? getCategoryFromId(catId) : null;
  // description: remove first 2 children then get html
  const $desc = $(DESCRIPTION_SEL).first();
  $desc.children().slice(0, 2).remove();
  const description = $desc.html() ?? null;

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    size,
    seeders: null,
    peers: null,
    uploadDate,
    category,
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink: null,
    description,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class DmhyProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'dmhy';
  readonly name = 'Dmhy';
  readonly url = 'https://share.dmhy.org';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Books',
    'Games',
    'Music',
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
    const categoryId = CATEGORY_MAP[ctx.category] ?? CATEGORY_MAP.All;
    const requestUrl =
      `${this.url}/topics/list` +
      `?keyword=${encodeURIComponent(query)}` +
      `&sort_id=${categoryId}` +
      `&team_id=0` +
      `&order=date-desc`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}/topics/list/sort_id/${categoryId}`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    return this.getLatestTorrents(category);
  }
}
