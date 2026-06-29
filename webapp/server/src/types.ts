/**
 * TorrentSearch 共享类型定义
 * 前后端共享，前端通过 web/src/types.ts re-export。
 */

/** 种子类别（对应原 Kotlin Category 枚举） */
export type Category =
  | 'All'
  | 'Anime'
  | 'Apps'
  | 'Books'
  | 'Games'
  | 'Movies'
  | 'Music'
  | 'Porn'
  | 'Series'
  | 'Other';

/** NSFW 类别集合 */
export const NSFW_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['Porn']);

export function isCategoryNSFW(category: Category | null | undefined): boolean {
  return category != null && NSFW_CATEGORIES.has(category);
}

/** 全部类别列表（用于 UI 展示） */
export const ALL_CATEGORIES: Category[] = [
  'All',
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

/** 非 NSFW 类别（Safe Mode 下使用） */
export const SAFE_CATEGORIES: Category[] = ALL_CATEGORIES.filter((c) => !isCategoryNSFW(c));

/** 种子元信息 */
export interface Torrent {
  /** info hash（小写） */
  infoHash: string;
  name: string;
  /** pretty 格式大小，如 "1.2 GB" */
  size: string;
  seeders: number;
  peers: number;
  providerName: string;
  providerId: string;
  /** ISO 8601 上传时间，未知为 null */
  uploadDate: string | null;
  category: Category | null;
  /** 详情页 URL */
  descriptionPageUrl: string;
  magnetUri: string | null;
  /** .torrent 文件下载 URL */
  fileDownloadLink: string | null;
  /** 是否 NSFW（派生自 category） */
  isNSFW: boolean;
}

/** 种子详情 */
export interface TorrentDetails {
  infoHash: string;
  name: string;
  size: string | null;
  seeders: number | null;
  peers: number | null;
  uploadDate: string | null;
  category: Category | null;
  uploader: string | null;
  lastChecked: string | null;
  magnetUri: string;
  fileDownloadLink: string | null;
  description: string | null;
  posterUrl: string | null;
  screenshotUrls: string[];
  isNSFW: boolean;
}

/** Provider 安全状态 */
export type SafetyStatus = 'Safe' | 'Unsafe';

/** Provider 类型 */
export type ProviderType = 'Builtin' | 'Torznab';

/** Provider 能力集合 */
export type ProviderCapabilities = {
  details?: boolean;
  latest?: boolean;
  top?: boolean;
};

/** Provider 元信息（给 UI 用） */
export interface ProviderInfo {
  id: string;
  name: string;
  url: string;
  cloudflareSolverUrl?: string;
  supportedCategories: Category[];
  safetyStatus: SafetyStatus;
  unsafeReason?: string;
  type: ProviderType;
  cloudflareProtected: boolean;
  enabledByDefault: boolean;
  capabilities: ProviderCapabilities;
  /** 备用详情页域名（Torznab 无） */
  alternateUrlDomains?: string[];
}

/** 搜索 SSE 事件：结果批次 */
export interface SearchBatch {
  type: 'batch';
  providerId: string;
  providerName: string;
  torrents: Torrent[];
}

/** 搜索 SSE 事件：单个 provider 失败 */
export interface SearchFailure {
  type: 'failure';
  providerId: string;
  providerName: string;
  providerUrl: string;
  message: string;
}

/** 搜索 SSE 事件：全部完成 */
export interface SearchDone {
  type: 'done';
  totalProviders: number;
  completedProviders: number;
}

export type SearchEvent = SearchBatch | SearchFailure | SearchDone;

/** Torznab 配置（用户在 UI 添加的索引器） */
export interface TorznabConfig {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  category: Category;
}

/** Torznab 连接检测结果 */
export type TorznabCheckResult =
  | { status: 'established' }
  | { status: 'invalid_api_key' }
  | { status: 'connection_failed'; message: string }
  | { status: 'application_error'; code: number }
  | { status: 'unexpected_response'; code: number }
  | { status: 'unexpected_error'; message: string };

/** 详情接口响应 */
export type GetTorrentDetailsResponse =
  | { status: 'success'; details: TorrentDetails }
  | { status: 'unsupported' }
  | { status: 'unavailable' };

/** 排序字段 */
export type SortCriteria = 'Name' | 'Seeders' | 'Peers' | 'FileSize' | 'Date';

/** 排序方向 */
export type SortOrder = 'Ascending' | 'Descending';

/** 排序选项 */
export interface SortOptions {
  criteria: SortCriteria;
  order: SortOrder;
}

/** 主题模式 */
export type DarkTheme = 'On' | 'Off' | 'FollowSystem';

/** 最大结果数（-1 = 无限） */
export type MaxNumResults = number;

/** 书签 torrent */
export interface BookmarkedTorrent {
  id: string;
  torrent: Torrent;
}

/** 搜索请求体 */
export interface SearchRequest {
  query: string;
  category: Category;
  providerIds: string[];
  torznabConfigs: TorznabConfig[];
  cloudflareUnlocked: string[];
}

/** 浏览请求查询参数 */
export interface BrowseRequest {
  category: Category;
  providerIds: string[];
  torznabConfigs: TorznabConfig[];
  cloudflareUnlocked: string[];
}
