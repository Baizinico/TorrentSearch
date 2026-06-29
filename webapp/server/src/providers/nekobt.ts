/**
 * NekoBT Provider
 * 对应原 Kotlin providers/NekoBT.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TopTorrentsProvider + TorrentDetailsProvider
 * 通过 nekobt.to 抓取 HTML 解析。
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
} from './_shared.js';

const LIST_ITEM = 'table.table > tbody > tr';
const TORRENT_NAME_SEL = 'td:nth-child(3) > div:nth-child(1) > div > a';
const SIZE_SEL = 'td:nth-child(5) > span';
const SEEDERS_SEL = 'td:nth-child(7) > span';
const PEERS_SEL = 'td:nth-child(8) > span';
const UPLOAD_DATE_SEL = 'td:nth-child(6) > span';
const MAGNET_URI_SEL = 'td:nth-child(4) > div > a:nth-child(1)';
const FILE_DOWNLOAD_LINK_SEL = 'td:nth-child(4) > div > a:nth-child(2)';

function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

function parseResultsHtml(html: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  $(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    // The torrent name anchor contains nested span>span structure; take
    // the first inner span's own text.
    const $nameAnchor = $row.find(TORRENT_NAME_SEL).first();
    const torrentName = ownText($nameAnchor.find('span > span:nth-child(1)').first());
    if (!torrentName) return;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('href');
    if (!magnetUri) return;
    const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
    const seedersStr = ownText($row.find(SEEDERS_SEL).first());
    const peersStr = ownText($row.find(PEERS_SEL).first());
    const seeders = seedersStr ? Number(seedersStr) : 0;
    const peers = peersStr ? Number(peersStr) : 0;
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, 'YYYY-MM-DD HH:mm:ss') : null;
    const fileDownloadLink = $row.find(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
    const detailsPageUrl = $nameAnchor.attr('href') ?? '';

    out.push(
      makeTorrent({
        infoHash: parseInfoHashFromMagnet(magnetUri),
        name: torrentName,
        size,
        seeders: Number.isNaN(seeders) ? 0 : seeders,
        peers: Number.isNaN(peers) ? 0 : peers,
        providerName,
        providerId: 'nekobt',
        uploadDate,
        category: 'Anime',
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
        fileDownloadLink,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const INFO_CARD =
    'div.grid > div:nth-child(1) > div.card:nth-child(1) > div.card-body';
  const TORRENT_NAME_SEL = `${INFO_CARD} > h2.card-title > div > span > span:nth-child(1)`;
  const SIZE_SEL = `${INFO_CARD} > div:nth-child(2) > span[data-tip="Total Size"]`;
  const SEEDERS_SEL = `${INFO_CARD} > div:nth-child(2) > span[data-tip="Seeders"]`;
  const PEERS_SEL = `${INFO_CARD} > div:nth-child(2) > span[data-tip="Leechers"]`;
  const UPLOAD_DATE_SEL = `${INFO_CARD} > div:nth-child(2) span:nth-child(8)`;
  const UPLOADER_SEL = `${INFO_CARD} > div:nth-child(2) > span[data-tip="Uploader"] > a`;
  const MAGNET_URI_SEL = `${INFO_CARD} a[href^="magnet:?"]`;
  const FILE_DOWNLOAD_LINK_SEL = `${INFO_CARD} a[href^="/api/v1/torrents"]`;
  const DESCRIPTION_SEL =
    'div.grid > div:nth-child(1) > div.card:nth-last-child(3) div.markdown';
  const POSTER_URL_SEL = 'img[alt^="Banner for "]';

  const torrentName = ownText($(TORRENT_NAME_SEL).first());
  if (!torrentName) return null;
  const magnetUri = $(MAGNET_URI_SEL).first().attr('href');
  if (!magnetUri) return null;
  const size = ownText($(SIZE_SEL).first()) || null;
  const seedersStr = ownText($(SEEDERS_SEL).first());
  const peersStr = ownText($(PEERS_SEL).first());
  const seeders = seedersStr ? Number(seedersStr) : null;
  const peers = peersStr ? Number(peersStr) : null;
  const uploadDateRaw = ownText($(UPLOAD_DATE_SEL).first());
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, 'YYYY-MM-DD HH:mm:ss') : null;
  const uploader = ownText($(UPLOADER_SEL).first()) || null;
  const fileDownloadLink = $(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
  const description = $(DESCRIPTION_SEL).first().html() ?? null;
  const posterUrl = $(POSTER_URL_SEL).first().attr('src') ?? null;

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    size,
    seeders: seeders === undefined || Number.isNaN(seeders) ? null : seeders,
    peers: peers === undefined || Number.isNaN(peers) ? null : peers,
    uploadDate,
    category: 'Anime',
    uploader,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: false,
  };
}

export class NekoBtProvider
  implements
    SearchProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider,
    TorrentDetailsProvider
{
  readonly id = 'nekobt';
  readonly name = 'NekoBT';
  readonly url = 'https://nekobt.to';
  readonly supportedCategories: readonly Category[] = ['Anime'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/search?query=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/search?sort-by=latest`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/search?sort-by=seeders`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }
}
