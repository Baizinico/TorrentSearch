/**
 * 1337x Provider
 * 对应原 Kotlin providers/ThirteenThirtySevenX.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + TopTorrentsProvider
 * 搜索/Top 阶段对每个结果项二次请求详情页拿 magnet/infoHash。
 * Cloudflare 保护。
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import pLimit from 'p-limit';
import type { Category, Torrent, TorrentDetails } from '../types.js';
import type {
  SearchContext,
  SearchProvider,
  TorrentDetailsProvider,
  TopTorrentsProvider,
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import type { HttpClient } from '../http/HttpClient.js';
import {
  getCurrentYear,
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
  tryParseRelative,
  tryParseTime,
} from './_shared.js';

const DETAIL_CONCURRENCY = 5;

const CATEGORY_MAP: Partial<Record<Category, string>> = {
  Anime: 'Anime',
  Apps: 'Apps',
  Games: 'Games',
  Movies: 'Movies',
  Music: 'Music',
  Other: 'Other',
  Porn: 'XXX',
  Series: 'TV',
};

// Results page selectors
const LIST_ITEM = 'table.table-list > tbody > tr';
const TORRENT_NAME_SEL = 'td.name > a:nth-child(2)';
const SIZE_SEL = 'td.size';
const SEEDERS_SEL = 'td.seeds';
const PEERS_SEL = 'td.leeches';
const UPLOAD_DATE_SEL = 'td.coll-date';
const CATEGORY_HREF_SEL = 'td.name > a:nth-child(1)';

// Details page selectors
const D_CONTAINER = 'div.box-info.torrent-detail-page';
const D_INFO_CONTAINER = `${D_CONTAINER} > div:nth-child(2) > div:nth-child(1)`;
const D_INFO_COL_FIRST = `${D_INFO_CONTAINER} > ul:nth-child(2)`;
const D_INFO_COL_SECOND = `${D_INFO_CONTAINER} > ul:nth-child(3)`;
const D_TORRENT_NAME = `${D_CONTAINER} > div.box-info-heading > h1`;
const D_CATEGORY = `${D_INFO_COL_FIRST} > li:nth-child(1) > span`;
const D_SIZE = `${D_INFO_COL_FIRST} > li:nth-child(4) > span`;
const D_UPLOADER = `${D_INFO_COL_FIRST} > li:nth-child(5) > span`;
const D_LAST_CHECKED = `${D_INFO_COL_SECOND} > li:nth-child(2) > span`;
const D_UPLOAD_DATE = `${D_INFO_COL_SECOND} > li:nth-child(3) > span`;
const D_SEEDERS = `${D_INFO_COL_SECOND} > li:nth-child(4) > span`;
const D_PEERS = `${D_INFO_COL_SECOND} > li:nth-child(5) > span`;
const D_MAGNET_URI = 'a[href^="magnet:?"]';
const D_FILE_DOWNLOAD_LINK = 'a[href^="https://itorrents.org"]';
const D_DESCRIPTION = 'div#description';
const D_POSTER_URL = 'div.torrent-image > img';

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

/** 1337x list-item upload date parsing (custom multi-format). */
function parseListItemDate(date: string): string | null {
  const normalizedDate = date
    .replace(/(\d+)(st|nd|rd|th)/g, '$1')
    .replace(/(?<=\d)(am|pm)\b/g, ' $1')
    .replace(/\./g, '')
    .replace(/'/g, '');

  let r = parseDate(normalizedDate, 'MMM D YY');
  if (r) return r;
  const reconstructedDate = `${normalizedDate} ${getCurrentYear()}`;
  r = parseDate(reconstructedDate, 'h a MMM D YYYY');
  if (r) return r;
  return tryParseTime(normalizedDate);
}

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const torrentName = ownText($(D_TORRENT_NAME).first());
  if (!torrentName) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  const size = ownText($(D_SIZE).first()).replace(/,/g, '') || null;
  const seedersRaw = ownText($(D_SEEDERS).first());
  const peersRaw = ownText($(D_PEERS).first());
  const seeders = seedersRaw ? toUint(seedersRaw) : null;
  const peers = peersRaw ? toUint(peersRaw) : null;
  const uploadDateRaw = ownText($(D_UPLOAD_DATE).first());
  const uploadDate = uploadDateRaw ? tryParseRelative(uploadDateRaw) : null;
  const categoryRaw = ownText($(D_CATEGORY).first());
  const category = categoryRaw ? getCategoryFromString(categoryRaw) : null;
  const uploader = $(D_UPLOADER).first().text().trim() || null;
  const lastCheckedRaw = ownText($(D_LAST_CHECKED).first());
  const lastChecked = lastCheckedRaw ? tryParseRelative(lastCheckedRaw) : null;
  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;
  const description = $(D_DESCRIPTION).first().html() ?? null;
  const posterUrl = resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) || null;

  return {
    infoHash,
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader,
    lastChecked,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
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
        const detailsPageUrl = resolveUrl($row.find(TORRENT_NAME_SEL).first().attr('href'), pageUrl);
        if (!detailsPageUrl) return null;
        const detailsHtml = await httpClient.get(detailsPageUrl);
        const details = parseDetailsHtml(detailsHtml, detailsPageUrl);
        if (!details) return null;

        const torrentName = ownText($row.find(TORRENT_NAME_SEL).first());
        if (!torrentName) return null;
        const size = ownText($row.find(SIZE_SEL).first()).replace(/,/g, '') || '0 KB';
        const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()));
        const peers = toUint(ownText($row.find(PEERS_SEL).first()));
        const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
        const uploadDate = uploadDateRaw ? parseListItemDate(uploadDateRaw) : null;
        const catHref = $row.find(CATEGORY_HREF_SEL).first().attr('href') ?? '';
        const catId = catHref.replace(/^\/sub\//, '').split('/')[0] ?? '';
        const category = catId ? getCategoryFromId(catId) : null;

        return makeTorrent({
          infoHash: details.infoHash,
          name: torrentName,
          size,
          seeders,
          peers,
          providerName,
          providerId: '1337x',
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

function getCategoryFromId(id: string): Category {
  switch (id) {
    case '28':
    case '78':
    case '79':
    case '80':
    case '81':
      return 'Anime';
    case '22':
    case '23':
    case '24':
    case '25':
    case '26':
    case '27':
    case '53':
    case '58':
    case '59':
    case '60':
    case '68':
    case '69':
      return 'Music';
    case '1':
    case '2':
    case '3':
    case '4':
    case '42':
    case '54':
    case '55':
    case '66':
    case '70':
    case '73':
    case '76':
      return 'Movies';
    case '5':
    case '6':
    case '7':
    case '41':
    case '71':
    case '74':
    case '75':
    case '9':
      return 'Series';
    case '18':
    case '19':
    case '20':
    case '21':
    case '56':
    case '57':
      return 'Apps';
    case '10':
    case '11':
    case '12':
    case '13':
    case '14':
    case '15':
    case '16':
    case '17':
    case '43':
    case '44':
    case '45':
    case '46':
    case '72':
    case '77':
    case '82':
      return 'Games';
    case '48':
    case '49':
    case '50':
    case '51':
    case '67':
      return 'Porn';
    case '33':
    case '34':
    case '35':
    case '36':
    case '37':
    case '38':
    case '39':
    case '40':
    case '47':
    case '52':
      return 'Other';
    default:
      return 'Other';
  }
}

function getCategoryFromString(raw: string): Category {
  switch (raw) {
    case 'Anime':
      return 'Anime';
    case 'Apps':
      return 'Apps';
    case 'Games':
      return 'Games';
    case 'Movies':
      return 'Movies';
    case 'Music':
      return 'Music';
    case 'Other':
      return 'Other';
    case 'XXX':
      return 'Porn';
    case 'TV':
    case 'Documentaries':
      return 'Series';
    default:
      return 'Other';
  }
}

export class ThirteenThirtySevenXProvider
  implements SearchProvider, TorrentDetailsProvider, TopTorrentsProvider
{
  readonly id = '1337x';
  readonly name = '1337x';
  readonly url = 'https://1337x.to';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Games',
    'Movies',
    'Music',
    'Other',
    'Porn',
    'Series',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = true;
  readonly capabilities = { details: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl =
      ctx.category === 'All'
        ? `${this.url}/search/${encodeURIComponent(query)}/1/`
        : `${this.url}/category-search/${encodeURIComponent(query)}/${CATEGORY_MAP[ctx.category]}/1/`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/top-100`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, getDefaultHttpClient());
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }
}
