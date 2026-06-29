/**
 * AudioBookBay Provider
 * 对应原 Kotlin providers/AudioBookBay.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider + LatestTorrentsProvider
 * 搜索阶段对每个结果项二次请求详情页，从 `td:containsOwn("Info Hash:")` 的下一个兄弟节点
 * 提取 Info Hash。用 p-limit(5) 限流并发。
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
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import type { HttpClient } from '../http/HttpClient.js';
import {
  createMagnetUri,
  makeTorrent,
  parseDate,
  parseRFC1123,
  resolveUrl,
} from './_shared.js';

const DETAIL_CONCURRENCY = 5;
const UPLOAD_DATE_FORMAT = 'D MMM YYYY';

/** jsoup-like ownText: only direct text nodes of the element. */
function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

function removeSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
}

function substringAfter(s: string, delim: string): string {
  const i = s.indexOf(delim);
  return i === -1 ? s : s.slice(i + delim.length);
}

/** Finds the first element matching `selector` whose own text contains `needle` (jsoup :containsOwn). */
function findOwnTextContainsNode(
  $root: cheerio.CheerioAPI,
  selector: string,
  needle: string,
): AnyNode | null {
  let foundNode: AnyNode | null = null;
  $root(selector).each((_, el) => {
    if (foundNode) return false;
    if (ownText($root(el)).includes(needle)) {
      foundNode = el;
      return false;
    }
  });
  return foundNode;
}

// ============== Results page ==============

const LIST_ITEM = 'div.post';
const TORRENT_NAME = 'div.postTitle > h2 > a';
const TORRENT_INFO = 'div.postContent > p:nth-child(3)';

/** Fetches the details page and extracts the Info Hash. */
async function getInfoHash(detailsPageUrl: string, httpClient: HttpClient): Promise<string | null> {
  const html = await httpClient.get(detailsPageUrl);
  const $ = cheerio.load(html);
  const td = findOwnTextContainsNode($, 'td', 'Info Hash:');
  if (!td) return null;
  const next = $(td).next();
  const text = ownText(next);
  return text || null;
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
        const detailsPageUrl = resolveUrl($row.find(TORRENT_NAME).first().attr('href'), pageUrl);
        if (!detailsPageUrl) return null;
        const infoHash = await getInfoHash(detailsPageUrl, httpClient);
        if (!infoHash) return null;

        const torrentName = ownText($row.find(TORRENT_NAME).first());
        if (!torrentName) return null;

        const torrentInfoText = $row.find(TORRENT_INFO).first().text() ?? '';
        const lines = torrentInfoText.split(/\r?\n/);

        let size: string | null = null;
        let uploadDate: string | null = null;
        for (const line of lines) {
          if (line.startsWith('File Size: ')) {
            size = substringAfter(line, 'File Size: ').trim();
            size = removeSuffix(size, 's');
          } else if (line.startsWith('Posted: ')) {
            const raw = substringAfter(line, 'Posted: ').trim();
            uploadDate = parseDate(raw, UPLOAD_DATE_FORMAT);
          }
        }

        return makeTorrent({
          infoHash,
          name: torrentName,
          size: size ?? '0 KB',
          seeders: 0,
          peers: 0,
          providerName,
          providerId: 'audiobookbay',
          uploadDate,
          category: 'Books',
          descriptionPageUrl: detailsPageUrl,
        });
      }),
    ),
  );
  return results.filter((t): t is Torrent => t !== null);
}

// ============== Details page ==============

const D_TORRENT_NAME = 'div.postTitle > h1';
const D_UPLOADER = 'div.postContent > div:nth-child(1) > p:nth-child(1) > a';
const D_DESCRIPTION = 'div.desc';
const D_POSTER_URL = 'img[itemprop="image"]';

function parseDetailsHtml(html: string, pageUrl: string): TorrentDetails | null {
  const $ = cheerio.load(html);

  const torrentName = ownText($(D_TORRENT_NAME).first());
  if (!torrentName) return null;

  const infoHashTd = findOwnTextContainsNode($, 'td', 'Info Hash:');
  if (!infoHashTd) return null;
  const infoHash = ownText($(infoHashTd).next());
  if (!infoHash) return null;

  const sizeTd = findOwnTextContainsNode($, 'td', 'File Size:') ?? findOwnTextContainsNode($, 'td', 'Combined File Size:');
  const size = sizeTd ? removeSuffix($(sizeTd).next().text().trim(), 's') : null;

  const uploadDateTd = findOwnTextContainsNode($, 'td', 'Creation Date:');
  let uploadDate: string | null = null;
  if (uploadDateTd) {
    const raw = ownText($(uploadDateTd).next()).trim();
    uploadDate = raw ? parseRFC1123(raw) : null;
  }

  const uploader = ownText($(D_UPLOADER).first()) || null;
  const description = $(D_DESCRIPTION).first().html() ?? null;
  const posterUrl = resolveUrl($(D_POSTER_URL).first().attr('src'), pageUrl) || null;
  const magnetUri = createMagnetUri(infoHash);

  return {
    infoHash,
    name: torrentName,
    size,
    seeders: null,
    peers: null,
    uploadDate,
    category: 'Books',
    uploader,
    lastChecked: null,
    magnetUri,
    fileDownloadLink: null,
    description,
    posterUrl,
    screenshotUrls: [],
    isNSFW: false,
  };
}

// ============== Provider ==============

export class AudioBookBayProvider
  implements SearchProvider, TorrentDetailsProvider, LatestTorrentsProvider
{
  readonly id = 'audiobookbay';
  readonly name = 'AudioBookBay';
  readonly url = 'https://audiobookbay.lu';
  readonly supportedCategories: readonly Category[] = ['Books'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true, latest: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/?s=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, requestUrl, this.name, ctx.httpClient);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html, detailsPageUrl);
  }

  async getLatestTorrents(_category: Category = 'All'): Promise<Torrent[]> {
    const html = await getDefaultHttpClient().get(this.url);
    return parseResultsHtml(html, this.url, this.name, getDefaultHttpClient());
  }
}
