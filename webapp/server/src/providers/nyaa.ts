/**
 * Nyaa Provider
 * 对应原 Kotlin providers/Nyaa.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 通过 nyaa.si 抓取 HTML 解析。
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
  epochSecondToISO,
  makeTorrent,
  parseInfoHashFromMagnet,
} from './_shared.js';

/** Returns the Category that matches the nyaa id. */
function categoryFromId(id: string): Category {
  switch (id) {
    case '1_0':
    case '1_1':
    case '1_2':
    case '1_3':
    case '1_4':
      return 'Anime';
    case '2_0':
    case '2_1':
    case '2_2':
      return 'Music';
    case '3_0':
    case '3_1':
    case '3_2':
    case '3_3':
      return 'Books';
    case '4_0':
    case '4_1':
    case '4_2':
    case '4_3':
    case '4_4':
      return 'Series';
    case '5_0':
    case '5_1':
    case '5_2':
      return 'Other';
    case '6_0':
    case '6_1':
      return 'Apps';
    case '6_2':
      return 'Games';
    default:
      return 'Other';
  }
}

const CATEGORY_MAP: Record<Category, string> = {
  All: '0_0',
  Anime: '1_0',
  Apps: '6_1',
  Books: '3_0',
  Games: '6_2',
  Movies: '0_0',
  Music: '2_0',
  Porn: '0_0',
  Series: '4_0',
  Other: '0_0',
};

const LIST_ITEM = 'table.torrent-list > tbody > tr';
const TORRENT_NAME = 'td:nth-child(2) > a:not(.comments)';
const SIZE = 'td:nth-child(4)';
const SEEDERS = 'td:nth-child(6)';
const PEERS = 'td:nth-child(7)';
const UPLOAD_DATE = 'td:nth-child(5)';
const CATEGORY = 'td:nth-child(1) > a';
const MAGNET_URI = 'td:nth-child(3) > a:nth-child(2)';
const FILE_DOWNLOAD_LINK = 'td:nth-child(3) > a:nth-child(1)';

/** jsoup-like ownText: only direct text nodes of the element. */
function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

function parseResultsHtml(html: string, _pageUrl: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  $(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    const torrentName = ownText($row.find(TORRENT_NAME).first());
    if (!torrentName) return;
    const magnetUri = $row.find(MAGNET_URI).first().attr('href');
    if (!magnetUri) return;
    const detailsPageUrl = $row.find(TORRENT_NAME).first().attr('href') ?? '';
    const fileDownloadLink = $row.find(FILE_DOWNLOAD_LINK).first().attr('href') ?? null;
    const infoHash = parseInfoHashFromMagnet(magnetUri);
    const size = ownText($row.find(SIZE).first()) || '0 KB';
    const tsStr = $row.find(UPLOAD_DATE).first().attr('data-timestamp');
    const ts = tsStr ? Number(tsStr) : NaN;
    const uploadDate = Number.isNaN(ts) ? null : epochSecondToISO(ts);
    const catHref = $row.find(CATEGORY).first().attr('href') ?? '';
    const catId = catHref.replace(/^\/\?c=/, '');
    const category = catId ? categoryFromId(catId) : null;
    const seedersStr = ownText($row.find(SEEDERS).first());
    const peersStr = ownText($row.find(PEERS).first());
    const seeders = seedersStr ? Number(seedersStr) : 0;
    const peers = peersStr ? Number(peersStr) : 0;

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders: Number.isNaN(seeders) ? 0 : seeders,
        peers: Number.isNaN(peers) ? 0 : peers,
        providerName,
        providerId: 'nyaasi',
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

async function parseDetailsHtml(html: string, _pageUrl: string): Promise<TorrentDetails | null> {
  const $ = cheerio.load(html);
  const TORRENT_INFO_CARD = '.container > div:nth-child(1)';
  const TORRENT_INFO_CARD_BODY = `${TORRENT_INFO_CARD} > div.panel-body`;
  const TORRENT_NAME_SEL = `${TORRENT_INFO_CARD} > div.panel-heading > h3`;
  const SIZE_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(4) > div:nth-child(2)`;
  const SEEDERS_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(2) > div:nth-child(4)`;
  const PEERS_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(3) > div:nth-child(4)`;
  const UPLOAD_DATE_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(1) > div:nth-child(4)`;
  const CATEGORY_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(1) > div:nth-child(2)`;
  const UPLOADER_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(2) > div:nth-child(2)`;
  const DESCRIPTION_SEL = '#torrent-description';
  const MAGNET_URI_SEL = 'a[href^="magnet:"]';
  const FILE_DOWNLOAD_LINK_SEL = 'a[href^="/download"]';

  const name = ownText($(TORRENT_NAME_SEL).first());
  if (!name) return null;
  const magnetUri = $(MAGNET_URI_SEL).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);
  const size = ownText($(SIZE_SEL).first()) || null;
  const seedersStr = $(SEEDERS_SEL).first().text().trim();
  const peersStr = $(PEERS_SEL).first().text().trim();
  const seeders = seedersStr ? Number(seedersStr) : null;
  const peers = peersStr ? Number(peersStr) : null;
  const tsStr = $(UPLOAD_DATE_SEL).first().attr('data-timestamp');
  const ts = tsStr ? Number(tsStr) : NaN;
  const uploadDate = Number.isNaN(ts) ? null : epochSecondToISO(ts);

  const $cat = $(CATEGORY_SEL).first();
  let category: Category | null = null;
  if ($cat.length > 0) {
    const categoryId = $cat.find('a:nth-child(1)').first().attr('href')?.replace(/^\/\?c=/, '');
    const subCategoryId = $cat
      .find('a:nth-child(2)')
      .first()
      .attr('href')
      ?.replace(/^\/\?c=/, '');
    if (subCategoryId === '6_2') {
      category = 'Games';
    } else if (categoryId) {
      category = categoryFromId(categoryId);
    }
  }
  const uploader = $(UPLOADER_SEL).first().text().trim() || null;
  const description = $(DESCRIPTION_SEL).first().html() ?? null;
  const fileDownloadLink = $(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;

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
    description,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class NyaaProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'nyaasi';
  readonly name = 'Nyaa';
  readonly url = 'https://nyaa.si';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Books',
    'Games',
    'Music',
    'Series',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = true;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = ['https://nyaa.iss.ink'];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[ctx.category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}/?f=0&c=${categoryId}&q=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}?c=${categoryId}`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const categoryId = CATEGORY_MAP[category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}?s=seeders&o=desc&c=${categoryId}`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }
}
