/**
 * LinuxTracker Provider
 * 对应原 Kotlin providers/LinuxTracker.kt
 *
 * 实现：SearchProvider + LatestTorrentsProvider + TopTorrentsProvider + TorrentDetailsProvider
 * 通过 linuxtracker.org 抓取 HTML 解析。
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

const LIST_ITEM =
  'table.lista[width="100%"] > tbody > tr:has(a[href^="index.php?page=torrent-details&id="][title])';
const TORRENT_NAME_SEL = 'a[href^="index.php?page=torrent-details&id="][title]';
const SIZE_SEL = 'td:nth-child(2) > table > tbody > tr:nth-child(2) > td';
const SEEDERS_SEL = 'td:nth-child(2) > table > tbody > tr:nth-child(3) > td';
const PEERS_SEL = 'td:nth-child(2) > table > tbody > tr:nth-child(4) > td';
const UPLOAD_DATE_SEL = 'td:nth-child(2) > table > tbody > tr > td';
const MAGNET_URI_SEL = 'a[href^="magnet:?"]';
const FILE_DOWNLOAD_LINK_SEL = 'a[href^="index.php?page=downloadcheck&id="]';

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
    const torrentName = ownText($row.find(TORRENT_NAME_SEL).first());
    if (!torrentName) return;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('href');
    if (!magnetUri) return;
    const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
    const seedersStr = ownText($row.find(SEEDERS_SEL).first());
    const peersStr = ownText($row.find(PEERS_SEL).first());
    const seeders = seedersStr ? Number(seedersStr) : 0;
    const peers = peersStr ? Number(peersStr) : 0;
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first()).trim();
    const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, 'DD/MM/YYYY') : null;
    const fileDownloadLink = $row.find(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
    const detailsPageUrl = $row.find(TORRENT_NAME_SEL).first().attr('href') ?? '';

    out.push(
      makeTorrent({
        infoHash: parseInfoHashFromMagnet(magnetUri),
        name: torrentName,
        size,
        seeders: Number.isNaN(seeders) ? 0 : seeders,
        peers: Number.isNaN(peers) ? 0 : peers,
        uploadDate,
        category: 'Apps',
        providerName,
        providerId: 'linuxtracker',
        magnetUri,
        fileDownloadLink,
        descriptionPageUrl: detailsPageUrl,
      }),
    );
  });
  return out;
}

/**
 * Find the first TD whose own text contains the given substring (jsoup's
 * `:containsOwn(text)` equivalent).
 */
function findTdContainsOwn($: cheerio.CheerioAPI, text: string): cheerio.Cheerio<AnyNode> {
  return $('td')
    .filter((_, el) => ownText($(el)).includes(text))
    .first();
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const TORRENT_NAME_SEL = 'span[itemprop="name"]';
  const DESCRIPTION_SEL = 'span[itemprop="blogPost"]';
  const MAGNET_URI_SEL = 'a[href^="magnet:?"]';

  const torrentName = ownText($(TORRENT_NAME_SEL).first());
  if (!torrentName) return null;
  const magnetUri = $(MAGNET_URI_SEL).first().attr('href');
  if (!magnetUri) return null;

  const $sizeTd = findTdContainsOwn($, 'Size');
  const size = $sizeTd.next().length > 0 ? ownText($sizeTd.next()) : null;

  const $uploadDateTd = findTdContainsOwn($, 'AddDate');
  const uploadDateRaw = $uploadDateTd.next().length > 0 ? ownText($uploadDateTd.next()) : '';
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, 'DD/MM/YYYY') : null;

  const $uploaderTd = findTdContainsOwn($, 'Uploader');
  const uploader = $uploaderTd.next().length > 0 ? $uploaderTd.next().text().trim() : null;

  const description = $(DESCRIPTION_SEL).first().html() ?? null;

  const $peersStatsTd = findTdContainsOwn($, 'peers');
  const peersStats = $peersStatsTd.next().length > 0 ? ownText($peersStatsTd.next()) : '';
  let seeders: number | null = null;
  let peers: number | null = null;
  if (peersStats) {
    // Format: "seeds: <n>, leechers: <n>"
    const seedsMatch = peersStats.match(/^seeds:\s*(\d+)/);
    if (seedsMatch) seeders = Number(seedsMatch[1]);
    const leechMatch = peersStats.match(/leechers:\s*(\d+)/);
    if (leechMatch) peers = Number(leechMatch[1]);
  }

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    magnetUri,
    size,
    seeders,
    peers,
    uploadDate,
    category: 'Apps',
    uploader,
    description,
    lastChecked: null,
    fileDownloadLink: null,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: false,
  };
}

export class LinuxTrackerProvider
  implements
    SearchProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider,
    TorrentDetailsProvider
{
  readonly id = 'linuxtracker';
  readonly name = 'LinuxTracker';
  readonly url = 'https://linuxtracker.org';
  readonly supportedCategories: readonly Category[] = ['Apps'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/index.php?page=torrents&search=${encodeURIComponent(
      query,
    )}&category=0&active=0`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/index.php?page=torrents&search=&category=0&active=0`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    return this.getLatestTorrents(category);
  }
}
