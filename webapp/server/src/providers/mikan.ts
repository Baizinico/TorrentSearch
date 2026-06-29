/**
 * Mikan Provider
 * 对应原 Kotlin providers/Mikan.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider
 * 通过 mikanani.me 抓取 HTML 解析。
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
  normalizeSize,
  parseDate,
  parseInfoHashFromMagnet,
} from './_shared.js';

const LIST_ITEM = 'tr.js-search-results-row';
const TORRENT_NAME_SEL = 'td:nth-child(2) > a:nth-child(1)';
const SIZE_SEL = 'td:nth-child(3)';
const UPLOAD_DATE_SEL = 'td:nth-child(4)';
const MAGNET_URI_SEL = 'td:nth-child(2) > a[data-clipboard-text]';
const FILE_DOWNLOAD_LINK_SEL = 'td:nth-child(5) > a';

const SIZE_PREFIX = '文件大小：';
const UPLOAD_DATE_PREFIX = '发布日期：';

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
    const torrentName = ownText($row.find(TORRENT_NAME_SEL).first());
    if (!torrentName) return;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('data-clipboard-text');
    if (!magnetUri) return;
    const rawSize = ownText($row.find(SIZE_SEL).first());
    const size = rawSize ? normalizeSize(rawSize) : '0 KB';
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, 'YYYY/MM/DD HH:mm') : null;
    const fileDownloadLink = $row.find(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
    const detailsPageUrl = $row.find(TORRENT_NAME_SEL).first().attr('href') ?? '';

    out.push(
      makeTorrent({
        infoHash: parseInfoHashFromMagnet(magnetUri),
        name: torrentName,
        size,
        seeders: 0,
        peers: 0,
        uploadDate,
        category: 'Anime',
        providerName,
        providerId: 'mikanproject',
        magnetUri,
        fileDownloadLink,
        descriptionPageUrl: detailsPageUrl,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const TORRENT_NAME_SEL = 'p.episode-title';
  const TORRENT_INFO_SEL = 'p.bangumi-info';
  const MAGNET_URI_SEL = 'a[href^="magnet:?"]';
  const FILE_DOWNLOAD_LINK_SEL = 'a[href^="/Download/"]';
  const DESCRIPTION_SEL = 'div.episode-desc';

  const torrentName = ownText($(TORRENT_NAME_SEL).first());
  if (!torrentName) return null;
  const magnetUri = $(MAGNET_URI_SEL).first().attr('href');
  if (!magnetUri) return null;
  const fileDownloadLink = $(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
  const description = $(DESCRIPTION_SEL).first().html() ?? null;

  const infos: string[] = [];
  $(TORRENT_INFO_SEL).each((_, el) => {
    const t = ownText($(el));
    if (t) infos.push(t);
  });
  const sizeRaw = infos.find((it) => it.startsWith(SIZE_PREFIX));
  const size = sizeRaw ? normalizeSize(sizeRaw.slice(SIZE_PREFIX.length).trim()) : null;
  const uploadDateRaw = infos.find((it) => it.startsWith(UPLOAD_DATE_PREFIX));
  const uploadDateStr = uploadDateRaw ? uploadDateRaw.slice(UPLOAD_DATE_PREFIX.length).trim() : '';
  const uploadDate = uploadDateStr ? parseDate(uploadDateStr, 'YYYY/MM/DD HH:mm') : null;

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    size,
    seeders: null,
    peers: null,
    uploadDate,
    category: 'Anime',
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: false,
  };
}

export class MikanProvider implements SearchProvider, TorrentDetailsProvider {
  readonly id = 'mikanproject';
  readonly name = 'Mikan';
  readonly url = 'https://mikanani.me';
  readonly supportedCategories: readonly Category[] = ['Anime'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/Home/Search?searchstr=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }
}
