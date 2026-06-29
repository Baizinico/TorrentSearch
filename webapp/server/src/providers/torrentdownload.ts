/**
 * TorrentDownload Provider
 * 对应原 Kotlin providers/TorrentDownload.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * infoHash 从详情页 URL 路径段提取（搜索阶段无二次请求）。
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
  resolveUrl,
  tryParseRelative,
} from './_shared.js';

// Results page selectors
const LIST_ITEM = 'div.wrapper > table.table2:last-of-type > tbody > tr';
const TORRENT_NAME_SEL = 'td:nth-child(1) > div.tt-name > a';
const SIZE_SEL = 'td:nth-child(3)';
const SEEDERS_SEL = 'td:nth-child(4)';
const PEERS_SEL = 'td:nth-child(5)';
const UPLOAD_DATE_SEL = 'td:nth-child(2)';
const CATEGORY_SEL = 'td:nth-child(1) > div.tt-name > span';

// Details page selectors
const D_BODY = 'table.torrentinfo > tbody';
const D_TORRENT_NAME = `${D_BODY} > tr:nth-child(1) > td:nth-child(2)`;
const D_SIZE = `${D_BODY} > tr:nth-child(6) > td:nth-child(2)`;
const D_SEEDERS = `${D_BODY} > tr:nth-child(5) > td:nth-child(2) > span:nth-child(1)`;
const D_PEERS = `${D_BODY} > tr:nth-child(5) > td:nth-child(2) > span:nth-child(2)`;
const D_UPLOAD_DATE = `${D_BODY} > tr:nth-child(8) > td:nth-child(2)`;
const D_CATEGORY = `${D_BODY} > tr:nth-child(4) > td:nth-child(2)`;
const D_MAGNET_URI = 'a[href^="magnet:?"]';
const D_FILE_DOWNLOAD_LINK = 'a[href^="https://itorrent.net/"]';

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

/**
 * Faithful port of the Kotlin infoHash extraction:
 *   url.dropLastWhile { it != '/' }.dropLast(1).takeLastWhile { it != '/' }.trim().lowercase()
 * i.e. keep through the last '/', drop that '/', then take the trailing segment.
 */
function extractInfoHashFromUrl(url: string): string {
  const lastSlash = url.lastIndexOf('/');
  const s1 = lastSlash >= 0 ? url.slice(0, lastSlash + 1) : url;
  const s2 = s1.slice(0, -1);
  const lastSlash2 = s2.lastIndexOf('/');
  const s3 = lastSlash2 >= 0 ? s2.slice(lastSlash2 + 1) : s2;
  return s3.trim().toLowerCase();
}

function categoryFromRawString(raw: string): Category {
  const cleaned = raw.replace(/[^A-Za-z]+/g, '');
  switch (cleaned) {
    case 'XXX':
    case 'XXXVideo':
    case 'XXXHDVideo':
    case 'XXXPictures':
    case 'Adult':
    case 'AdultPornHDVideo':
    case 'AdultPornPictures':
    case 'AdultPornVideo':
      return 'Porn';
    case 'Anime':
    case 'AnimeEnglishtranslated':
    case 'AnimeAnimeOther':
      return 'Anime';
    case 'Applications':
    case 'ApplicationsAndroid':
    case 'ApplicationsWindows':
    case 'Software':
      return 'Apps';
    case 'BooksAcademic':
    case 'BooksComics':
    case 'BooksEbooks':
    case 'BooksEducational':
    case 'BooksMagazines':
    case 'BooksFiction':
    case 'BooksNonfiction':
    case 'BooksTextbooks':
    case 'Ebooks':
    case 'OtherEbooks':
    case 'OtherComics':
    case 'AudioBooks':
    case 'AudioAudiobooks':
      return 'Books';
    case 'Games':
    case 'GamesWindows':
      return 'Games';
    case 'Movies':
    case 'MoviesAction':
    case 'MoviesConcerts':
    case 'MoviesCrime':
    case 'MoviesDocumentary':
    case 'MoviesDubbedMovies':
    case 'MoviesHighresMovies':
    case 'MoviesMusicvideos':
    case 'MoviesThriller':
    case 'VideoMovies':
      return 'Movies';
    case 'Music':
    case 'MusicHardrock':
    case 'MusicMp':
    case 'MusicFLAC':
    case 'MusicLossless':
    case 'MusicRB':
    case 'MusicTranceHouseDance':
    case 'VideoMusic':
    case 'AudioMusic':
      return 'Music';
    case 'TV':
    case 'TVBBC':
    case 'TVshows':
    case 'Television':
      return 'Series';
    default:
      return 'Other';
  }
}

function parseResultsHtml(html: string, pageUrl: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);

  if (ownText($('h2').first()) === 'No Results Found') {
    return [];
  }

  const out: Torrent[] = [];
  $(LIST_ITEM).each((_, el) => {
    const $row = $(el);
    const torrentName = $row.find(TORRENT_NAME_SEL).first().text();
    if (!torrentName) return;
    const detailsPageUrl = resolveUrl($row.find(TORRENT_NAME_SEL).first().attr('href'), pageUrl);
    if (!detailsPageUrl) return;

    const infoHash = extractInfoHashFromUrl(detailsPageUrl);
    const size = ownText($row.find(SIZE_SEL).first()) || '0 KB';
    const seeders = toUint(ownText($row.find(SEEDERS_SEL).first()).replace(/,/g, ''));
    const peers = toUint(ownText($row.find(PEERS_SEL).first()).replace(/,/g, ''));
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    const uploadDate = uploadDateRaw ? tryParseRelative(uploadDateRaw) : null;
    const categoryRaw = ownText($row.find(CATEGORY_SEL).first());
    const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;

    out.push(
      makeTorrent({
        infoHash,
        name: torrentName,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'torrentdownloadinfo',
        uploadDate,
        category,
        descriptionPageUrl: detailsPageUrl,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const torrentName = ownText($(D_TORRENT_NAME).first());
  if (!torrentName) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  const size = ownText($(D_SIZE).first()) || null;
  const seedersRaw = ownText($(D_SEEDERS).first()).replace(/^Seeds:\s*/, '').trim();
  const peersRaw = ownText($(D_PEERS).first()).replace(/^Leechers:\s*/, '').trim();
  const seeders = toUintOrNull(seedersRaw);
  const peers = toUintOrNull(peersRaw);
  const uploadDateRaw = ownText($(D_UPLOAD_DATE).first());
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, 'D MMMM YYYY') : null;
  const categoryRaw = ownText($(D_CATEGORY).first());
  const category = categoryRaw ? categoryFromRawString(categoryRaw) : null;
  const fileDownloadLink = $(D_FILE_DOWNLOAD_LINK).first().attr('href') ?? null;

  return {
    infoHash,
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category,
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description: null,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class TorrentDownloadProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'torrentdownloadinfo';
  readonly name = 'TorrentDownload';
  readonly url = 'https://torrentdownload.info';
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
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/search?q=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/latest`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getTopTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/top`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name);
  }
}
