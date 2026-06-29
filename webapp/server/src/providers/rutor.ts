/**
 * Rutor Provider
 * 对应原 Kotlin providers/Rutor.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider + TopTorrentsProvider
 * 俄文月份经 convertRussianMonthToEnglish 转换后再 parseDate。
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

const RESULTS_DATE_FORMAT = 'DD MMM YY';
const DETAILS_DATE_FORMAT = 'DD-MM-YYYY H:m:s';

const CATEGORY_MAP: Record<Category, number> = {
  All: 0,
  Anime: 10,
  Apps: 9,
  Books: 11,
  Games: 8,
  Movies: 1,
  Music: 2,
  Other: 3,
  Series: 4,
  Porn: 0,
};

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

/** Kotlin takeWhile { it != '(' } — 取首个 '(' 之前的子串。 */
function takeUntilChar(s: string, ch: string): string {
  const idx = s.indexOf(ch);
  return idx === -1 ? s : s.slice(0, idx);
}

/** Kotlin substringAfter(ch) — 返回首个 ch 之后的子串，未找到则返回原串。 */
function substringAfter(s: string, ch: string): string {
  const idx = s.indexOf(ch);
  return idx === -1 ? s : s.slice(idx + 1);
}

function getCategoryFromRaw(raw: string): Category {
  switch (raw) {
    case 'kino':
    case 'nashe_kino':
    case 'multiki':
      return 'Movies';
    case 'seriali':
    case 'nashi_seriali':
    case 'tv':
      return 'Series';
    case 'anime':
      return 'Anime';
    case 'audio':
      return 'Music';
    case 'games':
      return 'Games';
    case 'soft':
      return 'Apps';
    case 'knigi':
      return 'Books';
    case 'Other':
      return 'Other';
    default:
      return 'Other';
  }
}

// ============== Results page ==============

const LIST_ITEM = 'div#index > table > tbody > tr';
const TORRENT_NAME = 'td:nth-child(2) > a:nth-child(3)';
const SIZE = 'td:nth-child(3)';
const SEEDERS = 'td:nth-child(4) > span:nth-child(1)';
const PEERS = 'td:nth-child(4) > span:nth-child(3)';
const UPLOAD_DATE = 'td:nth-child(1)';
const MAGNET_URI = 'td:nth-child(2) > a:nth-child(2)';
const FILE_DOWNLOAD_LINK = 'td:nth-child(2) > a:nth-child(1)';

function parseResultsHtml(
  html: string,
  pageUrl: string,
  searchCategory: Category,
  providerName: string,
): Torrent[] {
  const $ = cheerio.load(html);
  const rows = $(LIST_ITEM).toArray();
  // Kotlin .drop(1) — 丢弃表头行
  const out: Torrent[] = [];
  for (let i = 1; i < rows.length; i++) {
    const $row = $(rows[i]!);
    const torrentName = ownText($row.find(TORRENT_NAME).first());
    if (!torrentName) continue;
    const magnetUri = $row.find(MAGNET_URI).first().attr('href');
    if (!magnetUri) continue;

    const size = ownText($row.find(SIZE).first()) || '0 KB';
    const seeders = toUintOrNull(ownText($row.find(SEEDERS).first())) ?? 0;
    const peers = toUintOrNull(ownText($row.find(PEERS).first())) ?? 0;
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE).first());
    const uploadDate = uploadDateRaw
      ? parseDate(convertRussianMonthToEnglish(uploadDateRaw), RESULTS_DATE_FORMAT)
      : null;
    const fileDownloadLink =
      resolveUrl($row.find(FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;
    const detailsPageUrl =
      resolveUrl($row.find(TORRENT_NAME).first().attr('href'), pageUrl) || '';
    const category = searchCategory !== 'All' ? searchCategory : null;

    out.push(
      makeTorrent({
        infoHash: parseInfoHashFromMagnet(magnetUri),
        name: torrentName,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'rutorinfo',
        uploadDate,
        category,
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
        fileDownloadLink,
      }),
    );
  }
  return out;
}

// ============== Details page ==============

const D_TORRENT_NAME = 'div#all > h1';
const D_DESCRIPTION = 'table#details > tbody > tr:nth-child(1) > td:nth-child(2)';
const D_POSTER_URL = 'table#details > tbody > tr:nth-child(1) > td:nth-child(2) > img';
const D_MAGNET_URI = 'div#download > a:nth-child(1)';
const D_FILE_DOWNLOAD_LINK = 'div#download > a:nth-child(2)';
const D_DETAILS_ROWS = 'table#details > tbody > tr:nth-child(n+2)';

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const torrentName = $(D_TORRENT_NAME).first().text();
  if (!torrentName) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;

  // 构建 header → value 映射
  const infos = new Map<string, cheerio.Cheerio<AnyNode>>();
  $(D_DETAILS_ROWS).each((_, tr) => {
    const $tr = $(tr);
    const header = ownText($tr.find('td.header').first());
    if (!header) return;
    const $value = $tr.find('td:nth-child(2)').first();
    if ($value.length === 0) return;
    infos.set(header, $value);
  });

  const sizeRaw = infos.get('Размер');
  const size = sizeRaw ? takeUntilChar(ownText(sizeRaw), '(').trim() || null : null;

  const seedersRaw = infos.get('Раздают');
  const seeders = seedersRaw ? toUintOrNull(ownText(seedersRaw)) : null;

  const peersRaw = infos.get('Качают');
  const peers = peersRaw ? toUintOrNull(ownText(peersRaw)) : null;

  const uploadDateRaw = infos.get('Добавлен');
  const uploadDate = uploadDateRaw
    ? parseDate(takeUntilChar(ownText(uploadDateRaw), '(').trim(), DETAILS_DATE_FORMAT)
    : null;

  const categoryRaw = infos.get('Категория');
  let category: Category | null = null;
  if (categoryRaw) {
    const href = categoryRaw.find('a').first().attr('href') ?? '';
    const afterSlash = substringAfter(href, '/');
    if (afterSlash) category = getCategoryFromRaw(afterSlash);
  }

  const uploaderRaw = infos.get('Залил');
  const uploader = uploaderRaw ? uploaderRaw.text().trim() || null : null;

  const lastCheckedRaw = infos.get('Сидер замечен');
  const lastChecked = lastCheckedRaw
    ? parseDate(takeUntilChar(ownText(lastCheckedRaw), '(').trim(), DETAILS_DATE_FORMAT)
    : null;

  const posterUrl = resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) || null;
  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;

  // 描述与截图
  const $description = $(D_DESCRIPTION).first();
  let description: string | null = null;
  const screenshotUrls: string[] = [];

  if ($description.length > 0) {
    // 提取截图：在 div.hidewrap 中找 div.hidehead ownText == "Скриншоты"
    $description.find('div.hidewrap').each((_, wrap) => {
      if (screenshotUrls.length > 0) return;
      const $wrap = $(wrap);
      const headText = ownText($wrap.find('div.hidehead').first());
      if (headText !== 'Скриншоты') return;
      const textareaText = ownText($wrap.find('textarea.hidearea').first());
      if (!textareaText) return;
      // 将文本作为 HTML 解析，提取 a > img 的 src
      const $parsed = cheerio.load(textareaText);
      $parsed('a > img').each((_, img) => {
        const src = $parsed(img).attr('src');
        if (src) screenshotUrls.push(src);
      });
    });

    // 清理描述：移除首个 img 和所有 div.hidewrap
    $description.find('img').first().remove();
    $description.find('div.hidewrap').remove();
    description = $description.html() ?? null;
  }

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
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
    screenshotUrls,
    isNSFW: category === 'Porn',
  };
}

// ============== Provider ==============

export class RutorProvider
  implements
    SearchProvider,
    TorrentDetailsProvider,
    LatestTorrentsProvider,
    TopTorrentsProvider
{
  readonly id = 'rutorinfo';
  readonly name = 'Rutor';
  readonly url = 'https://rutor.info';
  readonly supportedCategories: readonly Category[] = [
    'Anime',
    'Apps',
    'Books',
    'Games',
    'Movies',
    'Music',
    'Other',
    'Series',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true, top: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    // https://rutor.info/search/<page>/<category>/<match type>/<sort>/query
    // match type = 010 (full phrase), sort = 2 (by seeders)
    const categoryId = CATEGORY_MAP[ctx.category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}/search/0/${categoryId}/010/2/${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, ctx.category, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(category: Category = 'All'): Promise<Torrent[]> {
    // https://rutor.info/browse/<page>/<category>/0/<sort>
    const categoryId = CATEGORY_MAP[category] ?? CATEGORY_MAP.All;
    const requestUrl = `${this.url}/browse/0/${categoryId}/0/0`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, category, this.name);
  }

  async getTopTorrents(category: Category = 'All'): Promise<Torrent[]> {
    const requestUrl = `${this.url}/top`;
    const html = await getDefaultHttpClient().get(requestUrl);
    return parseResultsHtml(html, requestUrl, category, this.name);
  }
}
