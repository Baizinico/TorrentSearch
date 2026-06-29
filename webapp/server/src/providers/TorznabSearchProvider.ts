/**
 * Torznab Search Provider
 * 对应原 Kotlin providers/TorznabSearchProvider.kt
 *
 * 实现：SearchProvider
 * 基于 Torznab 规范的通用搜索 provider，支持用户自定义索引器（Jackett/Prowlarr 等）。
 * 使用 fast-xml-parser 解析 XML 响应；caps 缓存；checkConnection 静态方法用 axios 直连。
 * 仅使用预定义分类 ID 范围（1000-8999）构造请求与推断类别。
 */

import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import type {
  Category,
  ProviderCapabilities,
  Torrent,
  TorznabCheckResult,
  TorznabConfig,
} from '../types.js';
import type { SearchContext, SearchProvider } from './SearchProvider.js';
import type { HttpClient } from '../http/HttpClient.js';
import {
  formatBytes,
  makeTorrent,
  parseInfoHashFromMagnet,
  parseRFC1123,
} from './_shared.js';

/** 自定义分类 ID 起始范围（仅使用预定义范围 1000-8999） */
const CUSTOM_CATEGORY_RANGE_START = 100000;
const TORZNAB_FUNCTION_CAPS = 'caps';
const TORZNAB_FUNCTION_SEARCH = 'search';
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NOT_AUTHORIZED = 401;
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** Category → Torznab 预定义分类 ID 列表 */
const CATEGORY_MAP: Record<Exclude<Category, 'All'>, readonly string[]> = {
  Anime: ['5070'],
  Apps: ['4000', '4010', '4020', '4030', '4040', '4050', '4060', '4070'],
  Books: ['7000', '7010', '7020', '7030', '7040', '7050', '7060'],
  Games: ['4050'],
  Movies: ['2000', '2010', '2020', '2030', '2040', '2045', '2050', '2060', '2070', '2080'],
  Music: ['3000', '3010', '3040', '3050', '3060'],
  Porn: ['6000', '6010', '6020', '6030', '6040', '6045', '6050', '6060', '6070', '6080', '6090'],
  Series: ['5000', '5010', '5020', '5030', '5040', '5045', '5050', '5060', '5080'],
  Other: ['8000', '8010', '8020'],
};

/** 将值规范化为数组（fast-xml-parser 单元素返回对象，多元素返回数组） */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 规范化 API URL：去尾斜杠，不以 api 结尾则追加 /api */
function normalizeUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('api') ? trimmed : `${trimmed}/api`;
}

/** 从 Torznab 分类 ID 推断 Category */
function getCategoryFromId(id: number): Category {
  if (id >= 1000 && id <= 1999) return 'Games';
  if (id >= 2000 && id <= 2999) return 'Movies';
  if (id >= 3000 && id <= 3999) return id === 3030 ? 'Books' : 'Music';
  if (id >= 4000 && id <= 4999) return id === 4050 ? 'Games' : 'Apps';
  if (id >= 5000 && id <= 5999) return id === 5070 ? 'Anime' : 'Series';
  if (id >= 6000 && id <= 6999) return 'Porn';
  if (id >= 7000 && id <= 7999) return 'Books';
  if (id >= 8000 && id <= 8999) return 'Other';
  return 'Other';
}

// ============== XML 解析 ==============

/** 解析搜索响应 RSS XML，提取 item 列表为 Torrent[] */
function parseResponseXml(xml: string, providerName: string, providerId: string): Torrent[] {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  // fast-xml-parser 的 parse() 返回 any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = parser.parse(xml);
  const items = asArray<any>(doc?.rss?.channel?.item);
  const torrents: Torrent[] = [];
  for (const item of items) {
    const t = parseItem(item, providerName, providerId);
    if (t) torrents.push(t);
  }
  return torrents;
}

/** 解析单个 <item>，字段缺失或无效时返回 null */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseItem(item: any, providerName: string, providerId: string): Torrent | null {
  const torrentName = item?.title;
  if (torrentName === undefined || torrentName === null) return null;

  const descriptionPageUrl = item?.comments;
  if (!descriptionPageUrl) return null;

  // <size> 元素
  let size: string | null = null;
  if (item.size !== undefined && item.size !== null) {
    size = formatBytes(Number(item.size));
  }

  // <enclosure> 元素（仅取首个有效 .torrent 链接）
  let fileDownloadLink: string | null = null;
  for (const enc of asArray<any>(item.enclosure)) {
    if (fileDownloadLink !== null) break;
    const url = enc['@_url'];
    const type = enc['@_type'];
    if (type === 'application/x-bittorrent' && url && !String(url).startsWith('magnet:?')) {
      fileDownloadLink = String(url);
    }
  }

  // <torznab:attr> 属性
  let seeders: string | null = null;
  let peers: string | null = null;
  let magnetUri: string | null = null;
  let infoHash: string | null = null;
  const categoryIds: number[] = [];

  for (const attr of asArray<any>(item.attr)) {
    const name = attr['@_name'];
    const value = attr['@_value'];
    switch (name) {
      case 'seeders':
        seeders = String(value);
        break;
      case 'peers':
        peers = String(value);
        break;
      case 'magneturl':
        magnetUri = String(value);
        break;
      case 'infohash':
        infoHash = String(value);
        break;
      case 'category': {
        const id = Number(value);
        if (!Number.isNaN(id) && id < CUSTOM_CATEGORY_RANGE_START) {
          categoryIds.push(id);
        }
        break;
      }
      case 'size':
        if (size === null) size = formatBytes(Number(value));
        break;
    }
  }

  // <pubDate>
  let uploadDate: string | null = null;
  if (item.pubDate) {
    uploadDate = parseRFC1123(String(item.pubDate));
  }

  // infoHash: 从 attr 或 magnet 推导
  const resolvedInfoHash = infoHash ?? (magnetUri ? parseInfoHashFromMagnet(magnetUri) : null);
  if (!resolvedInfoHash) return null;
  if (!size) return null;

  const seedersNum = seeders !== null ? Number(seeders) : NaN;
  const peersNum = peers !== null ? Number(peers) : NaN;
  if (Number.isNaN(seedersNum)) return null;
  if (Number.isNaN(peersNum)) return null;

  const category = categoryIds.length > 0
    ? getCategoryFromId(Math.max(...categoryIds))
    : 'Other';

  return makeTorrent({
    infoHash: resolvedInfoHash,
    name: String(torrentName),
    size,
    seeders: seedersNum,
    peers: peersNum,
    providerName,
    providerId,
    uploadDate,
    category,
    descriptionPageUrl: String(descriptionPageUrl),
    magnetUri,
    fileDownloadLink,
  });
}

/** 解析 caps XML，返回支持的分类 ID 集合 */
function parseCapsXml(xml: string): Set<string> {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = parser.parse(xml);
  const supported = new Set<string>();
  const categories = asArray<any>(doc?.caps?.categories?.category);
  for (const cat of categories) {
    const id = cat['@_id'];
    if (id !== undefined) {
      const idNum = Number(id);
      if (!Number.isNaN(idNum) && idNum < CUSTOM_CATEGORY_RANGE_START) {
        supported.add(String(id));
      }
    }
    const subcats = asArray<any>(cat.subcat);
    for (const sub of subcats) {
      const subId = sub['@_id'];
      if (subId !== undefined) {
        const subIdNum = Number(subId);
        if (!Number.isNaN(subIdNum) && subIdNum < CUSTOM_CATEGORY_RANGE_START) {
          supported.add(String(subId));
        }
      }
    }
  }
  return supported;
}

/** 解析错误响应 XML，提取 code 属性 */
function parseErrorCodeXml(xml: string): number {
  const parser = new XMLParser({ ignoreAttributes: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = parser.parse(xml);
  const code = doc?.error?.['@_code'];
  if (code === undefined || code === null) throw new Error('No error code in response');
  return Number(code);
}

// ============== Provider ==============

export class TorznabSearchProvider implements SearchProvider {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly safetyStatus = 'Safe' as const;
  readonly enabledByDefault = false;
  readonly type = 'Torznab' as const;
  readonly isCloudflareProtected = false;
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
  readonly capabilities: ProviderCapabilities = {};

  /** caps 缓存（null 表示尚未获取） */
  private capabilitiesCache: Set<string> | null = null;

  constructor(private readonly config: TorznabConfig) {
    this.id = config.id;
    this.name = config.name;
    this.url = config.url;
  }

  async search(query: string, ctx: SearchContext): Promise<Torrent[]> {
    const apiUrl = normalizeUrl(this.config.url);

    if (this.capabilitiesCache === null) {
      this.capabilitiesCache = await this.fetchCapabilities(apiUrl, ctx.httpClient);
    }

    let requestUrl = `${apiUrl}?apikey=${this.config.apiKey}&extended=1&t=${TORZNAB_FUNCTION_SEARCH}&q=${encodeURIComponent(query)}`;
    if (ctx.category !== 'All') {
      requestUrl += `&cat=${this.getCategoriesId(ctx.category)}`;
    }

    const responseXml = await ctx.httpClient.get(requestUrl);
    return parseResponseXml(responseXml, this.name, this.id);
  }

  private async fetchCapabilities(apiUrl: string, httpClient: HttpClient): Promise<Set<string>> {
    const requestUrl = `${apiUrl}?t=${TORZNAB_FUNCTION_CAPS}&apikey=${this.config.apiKey}`;
    const xml = await httpClient.get(requestUrl);
    try {
      return parseCapsXml(xml);
    } catch {
      return new Set();
    }
  }

  private getCategoriesId(category: Category): string {
    if (category === 'All') return '';
    const cats = CATEGORY_MAP[category];
    if (!cats) return '';
    if (!this.capabilitiesCache) return cats.join(',');
    return cats.filter((id) => this.capabilitiesCache!.has(id)).join(',');
  }

  /**
   * 检查 Torznab 索引器连接是否正常。
   * 用 axios 直连（需要 HTTP 状态码与原始响应体）。
   */
  static async checkConnection(url: string, apiKey: string): Promise<TorznabCheckResult> {
    const apiUrl = normalizeUrl(url);
    const requestUrl = `${apiUrl}?t=${TORZNAB_FUNCTION_CAPS}&apikey=${apiKey}`;

    let resp;
    try {
      resp = await axios.get(requestUrl, {
        validateStatus: () => true,
        timeout: 20000,
        responseType: 'text',
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const code = err.code;
        if (
          code === 'ENOTFOUND' ||
          code === 'ECONNREFUSED' ||
          code === 'ECONNABORTED' ||
          code === 'ETIMEDOUT' ||
          code === 'EAI_AGAIN'
        ) {
          return { status: 'connection_failed', message: err.message };
        }
      }
      return {
        status: 'unexpected_error',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const status = resp.status;
    if (status === HTTP_STATUS_NOT_AUTHORIZED) {
      return { status: 'invalid_api_key' };
    }
    if (status !== HTTP_STATUS_OK) {
      return { status: 'unexpected_error', message: `HTTP status ${status}` };
    }

    const xml = typeof resp.data === 'string' ? resp.data : String(resp.data ?? '');
    const xmlWoDecl = xml.startsWith(XML_DECLARATION)
      ? xml.slice(XML_DECLARATION.length).trimStart()
      : xml.trimStart();

    if (xmlWoDecl.startsWith('<caps>')) {
      return { status: 'established' };
    }

    if (!xmlWoDecl.startsWith('<error code=')) {
      return { status: 'unexpected_error', message: 'Unexpected response format' };
    }

    let errorCode: number;
    try {
      errorCode = parseErrorCodeXml(xml);
    } catch {
      return { status: 'unexpected_error', message: 'Failed to parse error response' };
    }

    if (errorCode >= 100 && errorCode <= 199) return { status: 'invalid_api_key' };
    if (errorCode >= 200 && errorCode <= 299) return { status: 'application_error', code: errorCode };
    return { status: 'unexpected_response', code: errorCode };
  }
}
