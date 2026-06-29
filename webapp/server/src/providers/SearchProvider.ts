/**
 * Search Provider 接口定义
 * 对应原 Kotlin providers/SearchProvider.kt
 */

import type { Category, ProviderCapabilities, ProviderType, SafetyStatus, Torrent, TorrentDetails } from '../types.js';
import type { HttpClient } from '../http/HttpClient.js';

/** 搜索上下文：类别 + HttpClient 实例 */
export interface SearchContext {
  category: Category;
  httpClient: HttpClient;
}

/** 基础搜索 Provider 接口 */
export interface SearchProvider {
  /** 唯一 ID */
  readonly id: string;
  /** 显示名 */
  readonly name: string;
  /** 主站 URL */
  readonly url: string;
  /** Cloudflare 挑战求解 URL（null 则用 url） */
  readonly cloudflareSolverUrl?: string;
  /** 支持的类别（用于按类别过滤 provider） */
  readonly supportedCategories: readonly Category[];
  /** 安全状态 */
  readonly safetyStatus: SafetyStatus;
  /** Unsafe 原因（safetyStatus='Unsafe' 时必填） */
  readonly unsafeReason?: string;
  /** 是否默认启用 */
  readonly enabledByDefault: boolean;
  /** 类型：内置 / Torznab */
  readonly type: ProviderType;
  /** 是否受 Cloudflare 保护 */
  readonly isCloudflareProtected: boolean;
  /** 能力集合 */
  readonly capabilities: ProviderCapabilities;

  /** 执行搜索 */
  search(query: string, ctx: SearchContext): Promise<Torrent[]>;
}

/** 支持详情抓取的 Provider */
export interface TorrentDetailsProvider extends SearchProvider {
  readonly capabilities: { details: true; latest?: boolean; top?: boolean };
  /** 详情页备用域名 */
  readonly alternateUrlDomains: readonly string[];
  /** 抓取详情页 */
  getDetails(detailsPageUrl: string): Promise<TorrentDetails | null>;
}

/** 支持"最新"浏览的 Provider */
export interface LatestTorrentsProvider extends SearchProvider {
  readonly capabilities: { details?: boolean; latest: true; top?: boolean };
  getLatestTorrents(category?: Category): Promise<Torrent[]>;
}

/** 支持"热门"浏览的 Provider */
export interface TopTorrentsProvider extends SearchProvider {
  readonly capabilities: { details?: boolean; latest?: boolean; top: true };
  getTopTorrents(category?: Category): Promise<Torrent[]>;
}

/** 类型守卫：是否支持详情 */
export function isDetailsProvider(p: SearchProvider): p is TorrentDetailsProvider {
  return p.capabilities.details === true;
}

/** 类型守卫：是否支持最新浏览 */
export function isLatestTorrentsProvider(p: SearchProvider): p is LatestTorrentsProvider {
  return p.capabilities.latest === true;
}

/** 类型守卫：是否支持热门浏览 */
export function isTopTorrentsProvider(p: SearchProvider): p is TopTorrentsProvider {
  return p.capabilities.top === true;
}
