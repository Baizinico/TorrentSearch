/**
 * InternetArchive Provider
 * 对应原 Kotlin providers/InternetArchive.kt
 *
 * 实现：SearchProvider + TorrentDetailsProvider
 * 使用 archive.org advancedsearch.php JSON API + metadata JSON API。
 */

import type { Category, Torrent, TorrentDetails } from '../types.js';
import type {
  SearchContext,
  SearchProvider,
  TorrentDetailsProvider,
} from './SearchProvider.js';
import { getDefaultHttpClient } from '../http/HttpClient.js';
import {
  createMagnetUri,
  epochSecondToISO,
  formatBytes,
  makeTorrent,
  parseDate,
  parseIso,
} from './_shared.js';

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function getStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function getNum(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function getArr(obj: Record<string, unknown>, key: string): unknown[] | null {
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}

function getObj(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = obj[key];
  return asRecord(v);
}

function categoryFromMediaType(mediaType: string): Category {
  switch (mediaType) {
    case 'software':
      return 'Apps';
    case 'texts':
      return 'Books';
    case 'movies':
      return 'Movies';
    default:
      return 'Other';
  }
}

function parseResultsJson(
  json: unknown,
  providerName: string,
  providerUrl: string,
): Torrent[] {
  const root = asRecord(json);
  if (!root) return [];
  const response = getObj(root, 'response');
  if (!response) return [];
  const docs = getArr(response, 'docs');
  if (!docs) return [];
  const out: Torrent[] = [];
  for (const d of docs) {
    const obj = asRecord(d);
    if (!obj) continue;
    const t = parseDocObject(obj, providerName, providerUrl);
    if (t) out.push(t);
  }
  return out;
}

function parseDocObject(
  obj: Record<string, unknown>,
  providerName: string,
  providerUrl: string,
): Torrent | null {
  const name = getStr(obj, 'title');
  if (name === null) return null;

  const itemSize = getNum(obj, 'item_size');
  if (itemSize === null) return null;
  const size = formatBytes(itemSize);

  const publicdate = getStr(obj, 'publicdate');
  const uploadDate = publicdate !== null ? parseIso(publicdate) : null;

  const mediatype = getStr(obj, 'mediatype');
  if (mediatype === null) return null;
  const category = categoryFromMediaType(mediatype);

  const identifier = getStr(obj, 'identifier');
  if (identifier === null) return null;
  const descriptionPageUrl = `${providerUrl}/details/${identifier}`;

  const btih = getStr(obj, 'btih');
  if (btih === null) return null;
  const infoHash = btih.toLowerCase().trim();

  return makeTorrent({
    infoHash,
    name,
    size,
    seeders: 1,
    peers: 1,
    providerName,
    providerId: 'internetarchive',
    uploadDate,
    category,
    descriptionPageUrl,
  });
}

function parseMetadataJson(json: unknown): TorrentDetails | null {
  const root = asRecord(json);
  if (!root) return null;

  const itemLastUpdated = getNum(root, 'item_last_updated');
  const lastChecked = itemLastUpdated !== null ? epochSecondToISO(itemLastUpdated) : null;
  const itemSize = getNum(root, 'item_size');
  const size = itemSize !== null ? formatBytes(itemSize) : null;

  const metadataObj = getObj(root, 'metadata');
  if (!metadataObj) return null;
  const name = getStr(metadataObj, 'title');
  if (name === null) return null;
  const publicdate = getStr(metadataObj, 'publicdate');
  const uploadDate =
    publicdate !== null ? parseDate(publicdate, 'YYYY-MM-DD HH:mm:ss') : null;
  const uploader = getStr(metadataObj, 'uploader');
  const description = getStr(metadataObj, 'description');
  const mediatype = getStr(metadataObj, 'metadata');
  const category = mediatype !== null ? categoryFromMediaType(mediatype) : null;

  const files = getArr(root, 'files');
  if (!files) return null;
  const torrentObj = files
    .map((it) => asRecord(it))
    .filter((r): r is Record<string, unknown> => r !== null)
    .find((r) => 'btih' in r);
  if (!torrentObj) return null;
  const id = getStr(metadataObj, 'identifier');
  if (id === null) return null;
  const infoHash = getStr(torrentObj, 'btih');
  if (infoHash === null) return null;
  const torrentFileName = getStr(torrentObj, 'name');
  if (torrentFileName === null) return null;
  const fileDownloadLink = `https://archive.org/download/${id}/${torrentFileName}`;

  return {
    infoHash,
    name,
    size,
    seeders: null,
    peers: null,
    uploadDate,
    category,
    uploader,
    lastChecked,
    magnetUri: createMagnetUri(infoHash),
    fileDownloadLink,
    description,
    posterUrl: null,
    screenshotUrls: [],
    isNSFW: category === 'Porn',
  };
}

export class InternetArchiveProvider implements SearchProvider, TorrentDetailsProvider {
  readonly id = 'internetarchive';
  readonly name = 'InternetArchive';
  readonly url = 'https://archive.org';
  readonly supportedCategories: readonly Category[] = [
    'Apps',
    'Books',
    'Movies',
    'Other',
  ];
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Builtin' as const;
  readonly isCloudflareProtected = false;
  readonly capabilities = { details: true } as const;
  readonly alternateUrlDomains: readonly string[] = [];

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const requestUrl =
      `${this.url}/advancedsearch.php` +
      `?q=title:${encodeURIComponent(query)}` +
      this.appendCategory(ctx.category) +
      `&fl[]=title,item_size,publicdate,mediatype,identifier,btih` +
      `&rows=100&page=1&output=json`;

    const json = await ctx.httpClient.getJson(requestUrl);
    if (json === null) return [];
    return parseResultsJson(json, this.name, this.url);
  }

  async getDetails(detailsPageUrl: string): Promise<TorrentDetails | null> {
    // detailsPageUrl: https://archive.org/details/<identifier>
    const identifier = detailsPageUrl.slice(detailsPageUrl.lastIndexOf('/') + 1);
    const jsonMetadataPageUrl = `https://archive.org/metadata/${identifier}`;
    const json = await getDefaultHttpClient().getJson(jsonMetadataPageUrl);
    if (json === null) return null;
    return parseMetadataJson(json);
  }

  /** Appends mediatype filter for non-All categories. */
  private appendCategory(category: Category): string {
    if (category === 'All') return '';
    let media: string;
    switch (category) {
      case 'Apps':
        media = 'software';
        break;
      case 'Books':
        media = 'texts';
        break;
      case 'Movies':
        media = 'movies';
        break;
      case 'Anime':
      case 'Games':
      case 'Music':
      case 'Porn':
      case 'Series':
      case 'Other':
        media = 'other';
        break;
    }
    return `%20AND%20mediatype:%28${media}%29`;
  }
}
