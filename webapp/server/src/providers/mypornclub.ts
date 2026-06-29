/**
 * MyPornClub Provider
 * 对应原 Kotlin providers/MyPornClub.kt
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
  createMagnetUri,
  makeTorrent,
  resolveUrl,
  tryParseRelative,
} from './_shared.js';

const DETAIL_CONCURRENCY = 5;

// Results page selectors
const LIST_ITEM = 'div.torrents_list > div.torrent_element';
const NAME_SEL =
  'div.torrent_element_text_div > a:nth-child(2) > span.torrent_element_text_span';
const SIZE_SEL = 'div.torrent_element_info > span.teiv:nth-child(4)';
const SEEDERS_SEL = 'div.torrent_element_info > span.teiv.teiv_seeders';
const PEERS_SEL = 'div.torrent_element_info > span.teiv.teiv_leechers';
const UPLOAD_DATE_SEL = 'div.torrent_element_info > span.teiv:nth-child(2)';
const DETAILS_PAGE_URL_SEL = 'div.torrent_element_text_div > a:nth-child(2)';

// Details page selectors
const D_INFO_HASH = 'div.torrent_info_div > div:nth-child(1)';
const D_NAME = 'div.torrent_text';
const D_SIZE = 'div.torrent_info_div span.tsize_span';
const D_SEEDERS = 'div.torrent_info_div span.teiv_seeders';
const D_PEERS = 'div.torrent_info_div span.teiv_leechers';
const D_UPLOAD_DATE = 'div.torrent_info_div > div:nth-child(9)';
const D_UPLOADER = 'div.torrent_info_div span.uploader_nick';
const D_LAST_CHECKED = 'div.torrent_info_div > div:nth-child(8)';
const D_MAGNET_URI = 'a.md_btn';
const D_FILE_DOWNLOAD_LINK = 'a.td_btn';

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

  const infoHashRaw = ownText($(D_INFO_HASH).first());
  if (!infoHashRaw) return null;
  const infoHash = infoHashRaw.replace(/^\[hash_info\]:/, '').trim().toLowerCase();
  if (!infoHash) return null;

  const nameRaw = $(D_NAME).first().text();
  const name = nameRaw.split('#')[0]?.trim();
  if (!name) return null;

  const sizeRaw = ownText($(D_SIZE).first());
  const size = sizeRaw ? sizeRaw.toUpperCase() : null;
  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));

  const uploadDateRaw = ownText($(D_UPLOAD_DATE).first());
  const uploadDate = uploadDateRaw
    ? tryParseRelative(uploadDateRaw.replace(/^\[uploaded\]:/, '').trim())
    : null;

  const uploaderRaw = ownText($(D_UPLOADER).first());
  const uploader = uploaderRaw ? uploaderRaw.replace(/^@/, '') : null;

  const lastCheckedRaw = ownText($(D_LAST_CHECKED).first());
  const lastChecked = lastCheckedRaw
    ? tryParseRelative(lastCheckedRaw.replace(/^\[last checked\]:/, '').trim())
    : null;

  const magnetUri = $(D_MAGNET_URI).first().attr('href') ?? createMagnetUri(infoHash);
  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;

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
    description: null,
    posterUrl: null,
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

        const name = ownText($row.find(NAME_SEL).first());
        if (!name) return null;
        const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
        const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()));
        const peers = toUint(ownText($row.find(PEERS_SEL).first()));
        const uploadDateRaw = $row.find(UPLOAD_DATE_SEL).first().text().trim();
        const uploadDate = uploadDateRaw ? tryParseRelative(uploadDateRaw) : null;

        return makeTorrent({
          infoHash: details.infoHash,
          name,
          size,
          seeders,
          peers,
          providerName,
          providerId: 'mypornclub',
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

export class MyPornClubProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'mypornclub';
  readonly name = 'MyPornClub';
  readonly url = 'https://myporn.club';
  readonly supportedCategories: readonly Category[] = ['Porn'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    // Kotlin: query.trim().replace("%20", "-")，replace 替换所有匹配。
    const formattedQuery = query.trim().replaceAll('%20', '-');
    const requestUrl = `${this.url}/s/${formattedQuery}/seeders`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/ts/latest/alltime`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/ts/hits/alltime`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }
}
