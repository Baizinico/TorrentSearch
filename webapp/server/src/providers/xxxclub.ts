/**
 * XXXClub Provider
 * 对应原 Kotlin providers/XXXClub.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 搜索/Latest/Top 阶段对每个结果项二次请求详情页拿 magnet/infoHash/fileDownloadLink。
 * Porn 专用。
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

const DATE_FORMAT = 'DD MMM YYYY HH:mm:ss';

// Results page selectors
const LIST_ITEM_CONTAINER = 'div.browsetableinside, div.divtableinside';
const LIST_ITEM = 'ul > li';
const NAME_SEL = 'span:nth-child(2) > a[href^="/torrents/details"]';
const SIZE_SEL = 'span.siz';
const SEEDERS_SEL = 'span.see';
const PEERS_SEL = 'span.lee';
const UPLOAD_DATE_SEL = 'span.adde';

// Details page selectors
const D_NAME = 'body > div > div.middle > div.main-content > div > h1';
const D_SIZE = 'div.detailsdescr > ul > li:nth-child(2) > span:nth-child(3)';
const D_SEEDERS = 'div.detailsdescr font.see';
const D_PEERS = 'div.detailsdescr font.lee';
const D_UPLOAD_DATE = 'div.detailsdescr > ul > li:nth-child(3) > span:nth-child(3)';
const D_UPLOADER = 'div.detailsdescr > ul > li:nth-child(6) > span:nth-child(3)';
const D_LAST_CHECKED = 'div.detailsdescr > ul > li:nth-child(5) > span:nth-child(3)';
const D_MAGNET_URI = 'a[href^="magnet:?"]';
const D_FILE_DOWNLOAD_LINK =
  'div.detailsdescr > ul > li.downloadboxlist > span:nth-child(1) > a';
const D_DESCRIPTION = 'div.description';
const D_POSTER_URL = 'img.detailsposter';

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

function toUint(s: string | undefined): number {
  return toUintOrNull(s) ?? 0;
}

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
  const uploader = ownText($(D_UPLOADER).first()) || null;

  // lastChecked: some torrents have "Pending" status; runCatching swallows parse errors.
  let lastChecked: string | null = null;
  const lastCheckedRaw = ownText($(D_LAST_CHECKED).first());
  if (lastCheckedRaw) {
    lastChecked = parseDate(lastCheckedRaw, DATE_FORMAT);
  }

  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;
  const description = $(D_DESCRIPTION).first().html() ?? null;
  // Kotlin uses attr("src") (not abs:src) — return raw value.
  const posterUrl = $(D_POSTER_URL).first().attr('src') ?? null;

  return {
    infoHash,
    name,
    size,
    seeders,
    peers,
    uploadDate,
    category: 'Porn',
    uploader,
    lastChecked,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: true,
  };
}

async function parseResultsHtml(
  html: string,
  pageUrl: string,
  providerName: string,
  httpClient: HttpClient,
): Promise<Torrent[]> {
  const $ = cheerio.load(html);
  const $container = $(LIST_ITEM_CONTAINER).first();
  if ($container.length === 0) return [];
  const items = $container.find(LIST_ITEM).toArray();
  const limit = pLimit(DETAIL_CONCURRENCY);
  const results = await Promise.all(
    items.map((item) =>
      limit(async () => {
        const $row = $(item);
        const detailsPageUrl = resolveUrl(
          $row.find(NAME_SEL).first().attr('href'),
          pageUrl,
        );
        if (!detailsPageUrl) return null;
        const detailsHtml = await httpClient.get(detailsPageUrl);
        const details = parseDetailsHtml(detailsHtml, detailsPageUrl);
        if (!details) return null;

        const name = $row.find(NAME_SEL).first().text().trim();
        if (!name) return null;
        const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
        const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()));
        const peers = toUint(ownText($row.find(PEERS_SEL).first()));
        const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
        const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, DATE_FORMAT) : null;

        return makeTorrent({
          infoHash: details.infoHash,
          name,
          size,
          seeders,
          peers,
          providerName,
          providerId: 'xxxclub',
          uploadDate,
          category: 'Porn',
          descriptionPageUrl: detailsPageUrl,
          magnetUri: details.magnetUri,
          fileDownloadLink: details.fileDownloadLink,
        });
      }),
    ),
  );
  return results.filter((t): t is Torrent => t !== null);
}

export class XXXClubProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'xxxclub';
  readonly name = 'XXXClub';
  readonly url = 'https://xxxclub.to';
  readonly supportedCategories: readonly Category[] = ['Porn'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const q = encodeURIComponent(query);
    const requestUrl = `${this.url}/torrents/search/all/${q}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/torrents/browse/all`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/torrents/top100`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }
}
