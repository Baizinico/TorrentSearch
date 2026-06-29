/**
 * 前端类型 re-export
 * 通过相对路径从后端 types.ts 复用类型定义。
 */
export type {
  Category,
  Torrent,
  TorrentDetails,
  ProviderInfo,
  SafetyStatus,
  ProviderType,
  ProviderCapabilities,
  SearchBatch,
  SearchFailure,
  SearchDone,
  SearchEvent,
  TorznabConfig,
  TorznabCheckResult,
  GetTorrentDetailsResponse,
  SortCriteria,
  SortOrder,
  SortOptions,
  DarkTheme,
  MaxNumResults,
  BookmarkedTorrent,
  SearchRequest,
  BrowseRequest,
} from '../../server/src/types.js';

export {
  NSFW_CATEGORIES,
  ALL_CATEGORIES,
  SAFE_CATEGORIES,
  isCategoryNSFW,
} from '../../server/src/types.js';
