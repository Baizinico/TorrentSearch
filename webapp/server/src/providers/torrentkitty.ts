/**
 * TorrentKitty Provider
 * 对应原 Kotlin providers/TorrentKitty.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider
 * 通过 torrentkitty.tv 抓取 HTML 解析。
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
} from './_shared.js';

const LIST_ITEM = 'table#archiveResult > tbody > tr';
const TORRENT_NAME_SEL = 'td.name';
const SIZE_SEL = 'td.size';
const UPLOAD_DATE_SEL = 'td.date';
const MAGNET_URI_SEL = 'td.action > a:nth-child(2)';
const FILE_DOWNLOAD_LINK_SEL = 'td.action > a:nth-child(3)';
const DETAILS_PAGE_URL_SEL = 'td.action > a:nth-child(1)';
const UPLOAD_DATE_FORMAT = 'YYYY-MM-DD';

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
  const rows = $(LIST_ITEM).toArray();
  // Drop the first row (header), then parse remaining.
  for (let i = 1; i < rows.length; i++) {
    const $row = $(rows[i]);
    const torrentName = ownText($row.find(TORRENT_NAME_SEL).first());
    if (!torrentName) continue;
    const magnetUri = $row.find(MAGNET_URI_SEL).first().attr('href');
    if (!magnetUri) continue;
    const rawSize = ownText($row.find(SIZE_SEL).first());
    const size = rawSize ? rawSize.toUpperCase() : '0 KB';
    const uploadDateRaw = ownText($row.find(UPLOAD_DATE_SEL).first());
    const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, UPLOAD_DATE_FORMAT) : null;
    const fileDownloadLink = $row.find(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;
    const detailsPageUrl = $row.find(DETAILS_PAGE_URL_SEL).first().attr('href') ?? '';

    out.push(
      makeTorrent({
        infoHash: parseInfoHashFromMagnet(magnetUri),
        name: torrentName,
        size,
        seeders: 1,
        peers: 1,
        uploadDate,
        fileDownloadLink,
        descriptionPageUrl: detailsPageUrl,
        providerName,
        providerId: 'torrentkitty',
        category: null,
      }),
    );
  }
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const TORRENT_NAME_SEL = 'h2';
  const SIZE_SEL = 'table.detailSummary > tbody > tr:nth-child(4) > td';
  const UPLOAD_DATE_SEL = 'table.detailSummary > tbody > tr:nth-child(5) > td';
  const MAGNET_URI_SEL = 'p.action > a:nth-child(2)';
  const FILE_DOWNLOAD_LINK_SEL = 'p.action > a:nth-child(1)';

  const torrentName = ownText($(TORRENT_NAME_SEL).first());
  if (!torrentName) return null;
  const magnetUri = $(MAGNET_URI_SEL).first().attr('href');
  if (!magnetUri) return null;
  const rawSize = ownText($(SIZE_SEL).first());
  const size = rawSize ? rawSize.toUpperCase() : null;
  const uploadDateRaw = ownText($(UPLOAD_DATE_SEL).first());
  const uploadDate = uploadDateRaw ? parseDate(uploadDateRaw, UPLOAD_DATE_FORMAT) : null;
  const fileDownloadLink = $(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;

  return {
    infoHash: parseInfoHashFromMagnet(magnetUri),
    name: torrentName,
    size,
    seeders: null,
    peers: null,
    uploadDate,
    category: null,
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description: null,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: false,
  };
}

export class TorrentKittyProvider implements SearchProvider, TorrentDetailsProvider {
  readonly id = 'torrentkitty';
  readonly name = 'TorrentKitty';
  readonly url = 'https://torrentkitty.tv';
  readonly supportedCategories: readonly Category[] = ['Other'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/search/${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }
}
