/**
 * XXXTracker Provider
 * 对应原 Kotlin providers/XXXTracker.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 列表项已含 magnet，无二次请求。
 * 列表项 uploadDate 使用俄文月份缩写（normalizeUploadDate 转英文后再解析）。
 * Porn 专用。
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
  convertRussianMonthToEnglish,
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
} from './_shared.js';

const LIST_DATE_FORMAT = 'DD MMM YY';
const DETAILS_DATE_FORMAT = 'DD-MM-YYYY';

// Results page selectors
const LIST_ITEM = 'table > tbody > tr';
const TORRENT_NAME_SEL = 'td:nth-child(2) > a:nth-child(3)';
const SIZE_SEL = 'td:nth-child(3)';
const SEEDERS_SEL = 'td:nth-child(4) > span:nth-child(1)';
const PEERS_SEL = 'td:nth-child(4) > span:nth-child(2)';
const UPLOAD_DATE_SEL = 'td:nth-child(1)';
const MAGNET_URI_SEL = 'td:nth-child(2) > a:nth-child(1)';
const FILE_DOWNLOAD_LINK_SEL = 'td:nth-child(2) > a:nth-child(2)';

// Details page selectors
const D_NAME = '#content > h1';
const D_SIZE = '#details > tbody > tr:nth-last-child(2) > td:nth-child(2)';
const D_SEEDERS = '#details > tbody > tr:nth-last-child(7) > td:nth-child(2)';
const D_PEERS = '#details > tbody > tr:nth-last-child(6) > td:nth-child(2)';
const D_UPLOAD_DATE = '#details > tbody > tr:nth-last-child(3) > td:nth-child(2)';
const D_MAGNET_URI = 'a[href^="magnet:?"]';
const D_FILE_DOWNLOAD_LINK = '#download > a:nth-child(1)';
const D_POSTER_URL = '#details > tbody > tr:nth-child(1) > td:nth-child(2) > img';
const D_DESCRIPTION = '#details > tbody > tr:nth-child(1) > td:nth-child(2)';

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

function parseResultsHtml(html: string, pageUrl: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  // First item is used as a header — drop(1).
  const rows = $(LIST_ITEM).toArray().slice(1);
  for (const el of rows) {
    const $row = $(el);
    const torrentName = ownText($row.find(TORRENT_NAME_SEL).first());
    if (!torrentName) continue;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('href');
    if (!magnetUri) continue;
    const infoHash = parseInfoHashFromMagnet(magnetUri);
    const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
    const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()));
    const peers = toUint(ownText($row.find(PEERS_SEL).first()));

    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    let uploadDate: string | null = null;
    if (uploadDateRaw) {
      // 俄文月份 → 英文，再按 "dd MMM yy" 解析。
      const normalized = convertRussianMonthToEnglish(uploadDateRaw);
      uploadDate = parseDate(normalized, LIST_DATE_FORMAT);
    }

    const fileDownloadLink = resolveUrl(
      $row.find(FILE_DOWNLOAD_LINK_SEL).first().attr('href'),
      pageUrl,
    );
    const detailsPageUrl = resolveUrl(
      $row.find(TORRENT_NAME_SEL).first().attr('href'),
      pageUrl,
    );

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'xxxtracker',
        uploadDate,
        category: 'Porn',
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
        fileDownloadLink: fileDownloadLink || null,
      }),
    );
  }
  return out;
}

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const name = $(D_NAME).first().text().trim();
  if (!name) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  // size: text() takeWhile { it != '(' } trim
  const sizeRaw = $(D_SIZE).first().text();
  const size = sizeRaw.split('(')[0]?.trim() || null;

  const seeders = toUintOrNull($(D_SEEDERS).first().text());
  const peers = toUintOrNull($(D_PEERS).first().text());

  // uploadDate: ownText takeWhile { !isWhitespace } trim → parse "dd-MM-yyyy"
  const uploadDateRaw = ownText($(D_UPLOAD_DATE).first());
  let uploadDate: string | null = null;
  if (uploadDateRaw) {
    const firstToken = uploadDateRaw.split(/\s/)[0] ?? '';
    if (firstToken) uploadDate = parseDate(firstToken, DETAILS_DATE_FORMAT);
  }

  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;
  // Kotlin uses attr("src") (not abs:src) — return raw value.
  const posterUrl = $(D_POSTER_URL).first().attr('src') ?? null;

  // description: remove first 3 direct element children (poster + wrappers), then html().
  const $desc = $(D_DESCRIPTION).first();
  $desc.children().slice(0, 3).remove();
  const description = $desc.html() ?? null;

  return {
    infoHash,
    name,
    size,
    seeders,
    peers,
    uploadDate,
    category: 'Porn',
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: true,
  };
}

export class XXXTrackerProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'xxxtracker';
  readonly name = 'XXXTracker';
  readonly url = 'https://xxxtor.com';
  readonly supportedCategories: readonly Category[] = ['Porn'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/b.php?search=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/b.php`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/top`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }
}
