/**
 * Sukebei Provider
 * 对应原 Kotlin providers/Sukebei.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 通过 sukebei.nyaa.si 抓取 HTML 解析（结构同 Nyaa）。
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

const LIST_ITEM = 'table.torrent-list > tbody > tr';
const NAME_SEL = 'td:nth-child(2) > a:not(.comments)';
const SIZE_SEL = 'td:nth-child(4)';
const SEEDERS_SEL = 'td:nth-child(6)';
const PEERS_SEL = 'td:nth-child(7)';
const UPLOAD_DATE_SEL = 'td:nth-child(5)';
const MAGNET_URI_SEL = 'td:nth-child(3) > a:nth-child(2)';
const FILE_DOWNLOAD_LINK_SEL = 'td:nth-child(3) > a:nth-child(1)';

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
    const torrentName = ownText($row.find(NAME_SEL).first());
    if (!torrentName) return;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('href');
    if (!magnetUri) return;
    const fileDownloadLink = $row.find(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
    const infoHash = parseInfoHashFromMagnet(magnetUri);
    const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
    const tsStr = $row.find(UPLOAD_DATE_SEL).first().attr('data-timestamp');
    const ts = tsStr ? Number(tsStr) : NaN;
    const uploadDate = Number.isNaN(ts) ? null : epochSecondToISO(ts);
    const seedersStr = ownText($row.find(SEEDERS_SEL).first());
    const peersStr = ownText($row.find(PEERS_SEL).first());
    const seeders = seedersStr ? Number(seedersStr) : 0;
    const peers = peersStr ? Number(peersStr) : 0;
    const detailsPageUrl = $row.find(NAME_SEL).first().attr('href') ?? '';

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders: Number.isNaN(seeders) ? 0 : seeders,
        peers: Number.isNaN(peers) ? 0 : peers,
        providerName,
        providerId: 'sukebeinyaa',
        uploadDate,
        category: 'Porn',
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
        fileDownloadLink,
      }),
    );
  });
  return out;
}

async function parseDetailsHtml(html: string): Promise<TorrentDetails | null> {
  const $ = cheerio.load(html);
  const TORRENT_INFO_CARD = 'div.container > div.panel';
  const TORRENT_INFO_CARD_BODY = `${TORRENT_INFO_CARD} > div.panel-body`;
  const TORRENT_NAME_SEL = `${TORRENT_INFO_CARD} > div.panel-heading > h3`;
  const SIZE_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(4) > div:nth-child(2)`;
  const SEEDERS_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(2) > div:nth-child(4)`;
  const PEERS_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(3) > div:nth-child(4)`;
  const UPLOAD_DATE_SEL = `${TORRENT_INFO_CARD_BODY} > div:nth-child(1) > div:nth-child(4)`;
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
  const uploader = $(UPLOADER_SEL).first().text().trim() || null;
  const fileDownloadLink = $(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
  const description = $(DESCRIPTION_SEL).first().html() ?? null;

  return {
    infoHash,
    name,
    size,
    seeders: seeders === undefined || Number.isNaN(seeders) ? null : seeders,
    peers: peers === undefined || Number.isNaN(peers) ? null : peers,
    uploadDate,
    category: 'Porn',
    uploader,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: true,
  };
}

export class SukebeiProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'sukebeinyaa';
  readonly name = 'Sukebei';
  readonly url = 'https://sukebei.nyaa.si';
  readonly supportedCategories: readonly Category[] = ['Porn'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/?f=0&c=0_0&q=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const html = await getDefaultHttpClient().get(this.url);
    return parseResultsHtml(html, this.name);
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/?s=seeders&o=desc`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, this.name);
  }
}
