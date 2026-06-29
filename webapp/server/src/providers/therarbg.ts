/**
 * TheRarBg Provider
 * 对应原 Kotlin providers/TheRarBg.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 搜索/Latest/Top 阶段对每个结果项二次请求详情页拿 magnet/infoHash。
 * Unsafe（克隆站，含大量虚假种子）。
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
  epochSecondToISO,
  formatBytes,
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
} from './_shared.js';

const DETAIL_CONCURRENCY = 5;

// Results page selectors
const LIST_ITEM = 'table > tbody > tr.list-entry';
const NAME_SEL = 'td.cellName > div > a';
const SIZE_SEL = 'td.sizeCell';
const SEEDERS_SEL = 'td:nth-child(7)';
const PEERS_SEL = 'td:nth-child(8)';
const UPLOAD_DATE_SEL = 'td:nth-child(4)';
const CATEGORY_SEL = 'td:nth-child(3) > a';

// Details page selectors
const D_NAME = 'div.postContL > h4:has(+ div.table-responsive)';
const D_MAGNET_URI = 'a[href^="magnet:?"]';

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

/** Kotlin split(delimiter, limit) keeps the remainder in the last element. */
function splitLimit(s: string, sep: string, limit: number): string[] {
  const parts = s.split(sep);
  if (parts.length <= limit) return parts;
  return [...parts.slice(0, limit - 1), parts.slice(limit - 1).join(sep)];
}

/** Normalizes TheRarBg detail-page "Added:" date for parsing. */
function normalizeUploadDate(date: string): string {
  const replaced = date.replace(/a\.m\./g, 'AM').replace(/p\.m\./g, 'PM');
  const [month, day, year, time, amPm] = splitLimit(replaced, ' ', 5);
  if (amPm === undefined) return date;
  const fixedTime = time.includes(':') ? time : `${time}:00`;
  return `${month} ${day} ${year} ${fixedTime} ${amPm}`;
}

function categoryFromRawString(raw: string): Category {
  switch (raw) {
    case 'Anime':
      return 'Anime';
    case 'Apps':
      return 'Apps';
    case 'Books':
      return 'Books';
    case 'Games':
      return 'Games';
    case 'Movies':
      return 'Movies';
    case 'Music':
      return 'Music';
    case 'XXX':
      return 'Porn';
    case 'Tv':
      return 'Series';
    case 'Other':
      return 'Other';
    default:
      return 'Other';
  }
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const name = ownText($(D_NAME).first());
  if (!name) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  // Build label → td map from the detail table.
  const detailRows = new Map<string, cheerio.Cheerio<AnyNode>>();
  $('table.detailTable > tbody > tr').each((_, tr) => {
    const $tr = $(tr);
    const label = ownText($tr.find('th').first());
    if (!label) return;
    const $td = $tr.find('td').first();
    if ($td.length === 0) return;
    detailRows.set(label, $td);
  });

  const sizeTd = detailRows.get('Size:');
  const size = sizeTd ? ownText(sizeTd) : null;

  const peersTd = detailRows.get('Peers:');
  let seeders: number | null = null;
  let peers: number | null = null;
  if (peersTd) {
    const parts = ownText(peersTd).trim().split(',');
    const first = parts[0]?.replace(/^Seeders:\s*/, '');
    const last = parts[parts.length - 1]?.trim().replace(/^Leechers:\s*/, '');
    seeders = toUintOrNull(first);
    peers = toUintOrNull(last);
  }

  const addedTd = detailRows.get('Added:');
  let uploadDate: string | null = null;
  if (addedTd) {
    const normalized = normalizeUploadDate(ownText(addedTd));
    uploadDate = parseDate(normalized, 'MMM D, YYYY, h:mm a');
  }

  const categoryTd = detailRows.get('Category:');
  const category = categoryTd ? categoryFromRawString(categoryTd.text().trim()) : null;
  const uploaderTd = detailRows.get('Uploader:');
  const uploader = uploaderTd ? uploaderTd.text().trim() || null : null;
  const descriptionTd = detailRows.get('Description:');
  const description = descriptionTd ? descriptionTd.text() || null : null;

  return {
    infoHash,
    name,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader,
    lastChecked: null,
    magnetUri,
    fileDownloadLink: null,
    description,
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
  const items = $(LIST_ITEM).toArray();
  const limit = pLimit(DETAIL_CONCURRENCY);
  const results = await Promise.all(
    items.map((item) =>
      limit(async () => {
        const $row = $(item);
        const detailsPageUrl = resolveUrl($row.find(NAME_SEL).first().attr('href'), pageUrl);
        if (!detailsPageUrl) return null;
        const detailsHtml = await httpClient.get(detailsPageUrl);
        const details = parseDetailsHtml(detailsHtml);
        if (!details) return null;

        const name = ownText($row.find(NAME_SEL).first());
        if (!name) return null;
        const dataOrder = $row.find(SIZE_SEL).first().attr('data-order');
        const size = dataOrder ? formatBytes(Number(dataOrder)) : '0 KB';
        const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()));
        const peers = toUint(ownText($row.find(PEERS_SEL).first()));
        const tsAttr = $row.find(UPLOAD_DATE_SEL).first().attr('data-order');
        const ts = tsAttr ? Number(tsAttr) : NaN;
        const uploadDate = Number.isNaN(ts) ? null : epochSecondToISO(ts);
        const categoryRaw = ownText($row.find(CATEGORY_SEL).first());
        const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;

        return makeTorrent({
          infoHash: details.infoHash,
          name,
          size,
          seeders,
          peers,
          providerName,
          providerId: 'therarbag',
          uploadDate,
          category,
          descriptionPageUrl: detailsPageUrl,
          magnetUri: details.magnetUri,
          fileDownloadLink: details.fileDownloadLink,
        });
      }),
    ),
  );
  return results.filter((t): t is Torrent => t !== null);
}

export class TheRarBgProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'therarbag';
  readonly name = 'TheRarBg';
  readonly url = 'https://therarbg.com';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Books',
    'Games',
    'Movies',
    'Music',
    'Porn',
    'Series',
    'Other',
  ];
  readonly safetyStatus = 'Unsafe' as const;
  readonly unsafeReason =
    'Clone of original RARBG with many fake torrents. Use extreme caution.';
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  private categoryName(raw: Category): string {
    switch (raw) {
      case 'All':
        return '';
      case 'Anime':
        return 'Anime';
      case 'Apps':
        return 'Apps';
      case 'Books':
        return 'Books';
      case 'Games':
        return 'Games';
      case 'Movies':
        return 'Movies';
      case 'Music':
        return 'Music';
      case 'Porn':
        return 'XXX';
      case 'Series':
        return 'Tv';
      case 'Other':
        return 'Other';
    }
  }

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const q = encodeURIComponent(query);
    let requestUrl = `${this.url}/get-posts/keywords:${q}`;
    if (ctx.category !== 'All') {
      requestUrl += `:category:${this.categoryName(ctx.category)}`;
    }
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    let requestUrl = `${this.url}/get-posts/time:2D`;
    if (category !== 'All') {
      requestUrl += `:category:${this.categoryName(category)}`;
    }
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    let requestUrl = `${this.url}/get-posts/time:2D:order:-se`;
    if (category !== 'All') {
      requestUrl += `:category:${this.categoryName(category)}`;
    }
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }
}
