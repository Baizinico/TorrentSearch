/**
 * Eztv Provider
 * 对应原 Kotlin providers/Eztv.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider
 * Cloudflare 保护。搜索时必须带 Cookie: layout=def_wlinks，否则结果无 magnet 链接。
 * 默认启用。仅支持 Series 类别。
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
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
  resolveUrl,
} from './_shared.js';

const UPLOAD_DATE_FORMAT = 'D MMM YYYY';
const LAYOUT_COOKIE = 'layout=def_wlinks';

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

/**
 * 在容器的子元素中找 ownText === needle 的元素，返回其下一个文本兄弟节点的内容。
 * 对应 Kotlin: container.find { it.ownText() == needle }?.nextSibling()?.takeIf { it is TextNode }?.nodeValue()?.trim()
 */
function findLabelNextText(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<AnyNode>,
  needle: string,
): string | null {
  const contents = $container.contents().toArray();
  for (let i = 0; i < contents.length; i++) {
    const node = contents[i]!;
    if (node.type !== 'tag') continue;
    if (ownText($(node)) === needle) {
      const next = contents[i + 1];
      if (next && next.type === 'text') {
        return (next.data ?? '').trim() || null;
      }
      return null;
    }
  }
  return null;
}

// ============== Results page ==============

const LIST_ITEM = 'table:last-of-type > tbody > tr';
const TORRENT_NAME = 'td:nth-child(2) > a.epinfo';
const SIZE = 'td:nth-child(4)';
const SEEDERS = 'td:nth-child(6)';
const MAGNET_URI = 'td:nth-child(3) > a.magnet';
const FILE_DOWNLOAD_LINK = 'td:nth-child(3) > a:nth-child(2)';

function parseResultsHtml(html: string, pageUrl: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const rows = $(LIST_ITEM).toArray();
  // Kotlin .drop(2) — 丢弃前两行表头
  const out: Torrent[] = [];
  for (let i = 2; i < rows.length; i++) {
    const $row = $(rows[i]!);
    const torrentName = ownText($row.find(TORRENT_NAME).first());
    if (!torrentName) continue;
    const magnetUri = $row.find(MAGNET_URI).first().attr('href');
    if (!magnetUri) continue;

    const size = ownText($row.find(SIZE).first()) || '0 KB';
    const seeders = toUintOrNull(ownText($row.find(SEEDERS).first())) ?? 0;
    const fileDownloadLink =
      resolveUrl($row.find(FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;
    const detailsPageUrl =
      resolveUrl($row.find(TORRENT_NAME).first().attr('href'), pageUrl) || '';

    out.push(
      makeTorrent({
        infoHash: parseInfoHashFromMagnet(magnetUri),
        name: torrentName,
        size,
        seeders,
        peers: 0,
        providerName,
        providerId: 'eztvx',
        uploadDate: null,
        category: 'Series',
        descriptionPageUrl: detailsPageUrl,
        magnetUri,
        fileDownloadLink,
      }),
    );
  }
  return out;
}

// ============== Details page ==============

const D_TORRENT_NAME =
  '#header_holder > table > tbody > tr:nth-child(1) > td > h1 > span';
const D_TORRENT_INFO_CONTAINER =
  '#header_holder > table > tbody > tr:nth-child(2) > td > table.episode_columns_holder > tbody > tr:nth-child(1) > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(1) > td';
const D_SEEDERS =
  '#header_holder > table > tbody > tr:nth-child(2) > td > table.episode_columns_holder > tbody > tr:nth-child(1) > td.episode_middle_column > table:nth-child(2) > tbody > tr:nth-child(2) > td > div > table > tbody > tr > td:nth-child(2) > span.stat_red';
const D_PEERS =
  '#header_holder > table > tbody > tr:nth-child(2) > td > table.episode_columns_holder > tbody > tr:nth-child(1) > td.episode_middle_column > table:nth-child(2) > tbody > tr:nth-child(2) > td > div > table > tbody > tr > td:nth-child(2) > span.stat_green';
const D_MAGNET_URI = 'a[title="Magnet Link"]';
const D_FILE_DOWNLOAD_LINK = 'a[title="Download Torrent"]';
const D_DESCRIPTION = 'div.desc_big';
const D_POSTER_URL =
  '#header_holder > table > tbody > tr:nth-child(2) > td > table.episode_columns_holder > tbody > tr:nth-child(1) > td.episode_left_column > table > tbody > tr:nth-child(2) > td > a:nth-child(1) > img';

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const torrentName = ownText($(D_TORRENT_NAME).first());
  if (!torrentName) return null;
  const magnetUri = $(D_MAGNET_URI).first().attr('href');
  if (!magnetUri) return null;

  const seeders = toUintOrNull(ownText($(D_SEEDERS).first()));
  const peers = toUintOrNull(ownText($(D_PEERS).first()));

  const $infoContainer = $(D_TORRENT_INFO_CONTAINER).first();
  // size: find child with ownText "Filesize:" → next text sibling
  const sizeRaw = $infoContainer.length > 0
    ? findLabelNextText($, $infoContainer, 'Filesize:')
    : null;
  const size = sizeRaw || null;

  // uploadDate: find child with ownText "Released:" → next text sibling → strip ordinal suffix → parse
  let uploadDate: string | null = null;
  const releasedRaw = $infoContainer.length > 0
    ? findLabelNextText($, $infoContainer, 'Released:')
    : null;
  if (releasedRaw) {
    // Kotlin: replace(Regex("(\\d+)(st|nd|rd|th)"), "$1") — 去除序数后缀
    const cleaned = releasedRaw.replace(/(\d+)(st|nd|rd|th)/, '$1');
    uploadDate = parseDate(cleaned, UPLOAD_DATE_FORMAT);
  }

  const fileDownloadLink =
    resolveUrl($(D_FILE_DOWNLOAD_LINK).first().attr('href'), pageUrl) || null;
  const description = $(D_DESCRIPTION).first().html() ?? null;
  const posterUrl =
    resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) || null;

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    size,
    seeders,
    peers,
    uploadDate,
    category: 'Series',
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: false,
  };
}

// ============== Provider ==============

export class EztvProvider implements SearchProvider, TorrentDetailsProvider {
  readonly id = 'eztvx';
  readonly name = 'Eztv';
  readonly url = 'https://eztvx.to';
  readonly supportedCategories: readonly Category[] = ['Series'];
  readonly safetyStatus = 'Safe' as const;
  // CF 保护：默认不启用，需在设置中配置 FlareSolverr 后手动开启
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = true;
  readonly capabilities = { details: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  get cloudflareSolverUrl(): string {
    return `${this.url}/home`;
  }

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/search/${encodeURIComponent(query)}`;
    // Without setting that cookie, it returns results without magnet links.
    const html = await ctx.httpClient.get(requestUrl, { Cookie: LAYOUT_COOKIE });
    return parseResultsHtml(html, requestUrl, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }
}
