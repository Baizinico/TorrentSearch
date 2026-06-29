/**
 * FileMood Provider
 * 对应原 Kotlin providers/FileMood.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider
 * 通过 filemood.com 抓取 HTML 解析。infoHash 从详情页 URL 中提取。
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Category, Torrent, TorrentDetails } from '../types.js';
import type {
  SearchContext,
  SearchProvider,
  TorrentDetailsProvider,
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import {
  createMagnetUri,
  makeTorrent,
  parseDate,
} from './_shared.js';

const LIST_ITEM = 'table > tbody > tr:has(a.btn-success)';
const NAME_SEL = 'td.dn-title';
const SIZE_SEL = 'td.dn-size';
const SEEDERS_PEERS_SEL = 'td.dn-status';
const DETAILS_PAGE_URL_SEL = 'td.dn-btn > div > a';

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
    const torrentName = $row.find(NAME_SEL).first().text();
    if (!torrentName) return;
    const size = $row.find(SIZE_SEL).first().text() || '0 KB';
    const statsText = $row.find(SEEDERS_PEERS_SEL).first().text();
    const parts = statsText.split('/');
    const seedersStr = parts[0] ?? '';
    const peersStr = parts[1] ?? '';
    const seeders = seedersStr ? Number(seedersStr.trim()) : 0;
    const peers = peersStr ? Number(peersStr.trim()) : 0;
    const descriptionPageUrl = $row.find(DETAILS_PAGE_URL_SEL).first().attr('href') ?? '';
    if (!descriptionPageUrl) return;

    // infoHash is the last '-' delimited segment of the URL (minus .html suffix).
    const withoutHtml = descriptionPageUrl.replace(/\.html$/, '');
    const lastDash = withoutHtml.lastIndexOf('-');
    const infoHash = withoutHtml.slice(lastDash + 1).toLowerCase().trim();
    if (!infoHash) return;

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders: Number.isNaN(seeders) ? 0 : seeders,
        peers: Number.isNaN(peers) ? 0 : peers,
        uploadDate: null,
        category: 'Other',
        providerName,
        providerId: 'filemood',
        descriptionPageUrl,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const TORRENT_NAME_SEL =
    'div.well > table:nth-child(1) > tbody > tr:nth-child(1) > td > h1 > b';
  const SIZE_SEL =
    'div.well > table:nth-child(3) > tbody > tr:nth-child(2) > td:nth-child(2) > p > b';
  const LAST_CHECKED_SEL =
    'div.well > table:nth-child(3) > tbody > tr:nth-child(4) > td:nth-child(2) > p > b';
  const INFO_HASH_SEL =
    'div.well > table:nth-child(3) > tbody > tr:nth-child(5) > td:nth-child(2) > p';

  const torrentName = ownText($(TORRENT_NAME_SEL).first());
  if (!torrentName) return null;
  const infoHashRaw = ownText($(INFO_HASH_SEL).first());
  if (!infoHashRaw) return null;
  const infoHash = infoHashRaw.toLowerCase().trim();
  const magnetUri = createMagnetUri(infoHash);
  const size = ownText($(SIZE_SEL).first()) || null;
  const lastCheckedRaw = ownText($(LAST_CHECKED_SEL).first());
  let lastChecked: string | null = null;
  if (lastCheckedRaw && lastCheckedRaw.trim() !== '') {
    // take until first whitespace
    const firstToken = lastCheckedRaw.split(/\s/)[0] ?? '';
    if (firstToken) lastChecked = parseDate(firstToken, 'YYYY-MM-DD');
  }

  return {
    infoHash,
    name: torrentName,
    size,
    seeders: null,
    peers: null,
    uploadDate: null,
    category: 'Other',
    uploader: null,
    lastChecked,
    magnetUri,
    fileDownloadLink: null,
    description: null,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: false,
  };
}

export class FileMoodProvider implements SearchProvider, TorrentDetailsProvider {
  readonly id = 'filemood';
  readonly name = 'FileMood';
  readonly url = 'https://filemood.com';
  readonly supportedCategories: readonly Category[] = ['Other'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/result?q=${encodeURIComponent(query)}+in%3Atitle`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }
}
