/**
 * AnimeTosho Provider
 * 对应原 Kotlin providers/AnimeTosho.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider
 * 通过 animetosho.org 抓取 HTML 解析。
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
  getTodayDate,
  getYesterdayDate,
  makeTorrent,
  parseDate,
  parseInfoHashFromMagnet,
} from './_shared.js';

const DATE_PREFIX = 'Date/time submitted: ';
const STATS_REGEX = /\[(\d+)↑\/(\d+)↓]/;

function ownText(el: cheerio.Cheerio<AnyNode>): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += node.data ?? '';
  });
  return text;
}

function parseUploadDate(entryDiv: cheerio.Cheerio<AnyNode>): string | null {
  const titleAttr = entryDiv.find('div.date').first().attr('title');
  if (!titleAttr) return null;
  const raw = titleAttr.startsWith(DATE_PREFIX)
    ? titleAttr.slice(DATE_PREFIX.length).trim()
    : titleAttr.trim();
  if (raw.startsWith('Today')) return getTodayDate();
  if (raw.startsWith('Yesterday')) return getYesterdayDate();
  // Only parse the first whitespace-delimited token (date part) with format d/M/yyyy.
  const firstToken = raw.split(' ', 2)[0];
  if (!firstToken) return null;
  return parseDate(firstToken, 'D/M/YYYY');
}

/** Extracts seeds and peers from the first span (with title attr) in the stats block. */
function parseSeedsAndPeers(entryDiv: cheerio.Cheerio<AnyNode>): {
  seeders: number;
  peers: number;
} {
  const $span = entryDiv.find('div.links').first().find('span[title]').first();
  if ($span.length === 0) return { seeders: 0, peers: 0 };
  const text = ownText($span);
  const m = text.match(STATS_REGEX);
  if (!m) return { seeders: 0, peers: 0 };
  const seeders = m[1] ? Number(m[1]) : 0;
  const peers = m[2] ? Number(m[2]) : 0;
  return {
    seeders: Number.isNaN(seeders) ? 0 : seeders,
    peers: Number.isNaN(peers) ? 0 : peers,
  };
}

function parseResultsHtml(html: string, providerName: string): Torrent[] {
  const $ = cheerio.load(html);
  const out: Torrent[] = [];
  $('div.home_list_entry').each((_, el) => {
    const $entry = $(el);
    const anchor = $entry.find('div.link > a').first();
    const name = anchor.text();
    if (!name) return;
    const descriptionPageUrl = anchor.attr('href') ?? '';
    const size = ownText($entry.find('div.size').first());
    if (!size) return;
    const { seeders, peers } = parseSeedsAndPeers($entry);
    const uploadDate = parseUploadDate($entry);
    if (uploadDate === null) return;

    const $links = $entry.find('div.links').first();
    const fileDownloadLink = $links.find('a.dllink').first().attr('href') ?? null;
    const magnetUri = $links.find('a[href^="magnet:"]').first().attr('href');
    if (!magnetUri) return;
    const infoHash = parseInfoHashFromMagnet(magnetUri);

    out.push(
      makeTorrent({
        infoHash,
        name,
        size,
        seeders,
        peers,
        providerName,
        providerId: 'animetosho',
        uploadDate,
        category: 'Anime',
        descriptionPageUrl,
        magnetUri,
        fileDownloadLink,
      }),
    );
  });
  return out;
}

function parseDetailsHtml(html: string): TorrentDetails | null {
  const $ = cheerio.load(html);
  const TORRENT_NAME_SEL = '#title';
  const SIZE_SEL = 'span[title^="File size:"]';
  const SEEDERS_SEL = 'td[title="Seeders"][align="right"]';
  const PEERS_SEL = 'td[title="Leechers"][align="right"]';
  const UPLOAD_DATE_SEL = '#content > table:nth-of-type(1) > tbody > tr:nth-child(2) > td';
  const SCREENSHOT_SEL = 'a.screenthumb';
  const MAGNET_URI_SEL = 'a[href^="magnet:"]';
  const FILE_DOWNLOAD_LINK_SEL = 'a[href^="https://animetosho.org/storage/torrent"]';

  const name = ownText($(TORRENT_NAME_SEL).first());
  if (!name) return null;
  const $magnet = $(MAGNET_URI_SEL).first();
  if ($magnet.length === 0) return null;
  const magnetUri = $magnet.attr('href');
  if (!magnetUri) return null;
  const infoHash = parseInfoHashFromMagnet(magnetUri);

  // Try SIZE selector first; fallback to magnet element's next sibling text node.
  let size: string | null = null;
  const $size = $(SIZE_SEL).first();
  if ($size.length > 0) {
    size = ownText($size);
  } else {
    const magnetNode = $magnet.get(0);
    const next = magnetNode?.nextSibling;
    if (next && next.type === 'text') {
      size = (next.data ?? '').trim();
    }
  }
  if (size) {
    size = size
      .replace(/[()|]/g, '')
      .trim();
    if (size === '') size = null;
  }

  const seedersStr = ownText($(SEEDERS_SEL).first());
  const peersStr = ownText($(PEERS_SEL).first());
  const seeders = seedersStr ? Number(seedersStr) : null;
  const peers = peersStr ? Number(peersStr) : null;
  const uploadDateRaw = ownText($(UPLOAD_DATE_SEL).first());
  let uploadDate: string | null = null;
  if (uploadDateRaw) {
    if (uploadDateRaw.startsWith('Today')) {
      uploadDate = getTodayDate();
    } else if (uploadDateRaw.startsWith('Yesterday')) {
      uploadDate = getYesterdayDate();
    } else {
      uploadDate = parseDate(uploadDateRaw, 'DD/MM/YYYY HH:mm');
    }
  }
  const screenshotUrls: string[] = [];
  $(SCREENSHOT_SEL).each((_, el) => {
    const href = $(el).attr('href');
    if (href) screenshotUrls.push(href);
  });
  const fileDownloadLink = $(FILE_DOWNLOAD_LINK_SEL).first().attr('href') ?? null;

  return {
    infoHash,
    name,
    size,
    seeders: seeders === undefined || Number.isNaN(seeders) ? null : seeders,
    peers: peers === undefined || Number.isNaN(peers) ? null : peers,
    uploadDate,
    category: 'Anime',
    uploader: null,
    lastChecked: null,
    magnetUri,
    fileDownloadLink,
    description: null,
    posterUrl: null,
    screenshotUrls,
    isNSFW: false,
  };
}

export class AnimeToshoProvider implements SearchProvider, TorrentDetailsProvider {
  readonly id = 'animetosho';
  readonly name = 'AnimeTosho';
  readonly url = 'https://animetosho.org';
  readonly supportedCategories: readonly Category[] = ['Anime'];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = true;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl = `${this.url}/search?q=${encodeURIComponent(query)}`;
    const html = await ctx.httpClient.get(requestUrl);
    return parseResultsHtml(html, this.name);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    const html = await getDefaultHttpClient().get(detailsPageUrl);
    return parseDetailsHtml(html);
  }
}
