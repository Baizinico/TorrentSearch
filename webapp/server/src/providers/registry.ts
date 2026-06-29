/**
 * Provider 注册表
 * - BuiltinProviders: 34 个内置 provider 实例
 * - DEFAULT_ENABLED_PROVIDER_IDS: 9 个 enabledByDefault=true 的 id
 * - 查找方法：按 URL / 按名称匹配详情 provider
 */

import type { ProviderInfo } from '../types.js';
import type { SearchProvider, TorrentDetailsProvider } from './SearchProvider.js';

// 内置 provider 导入（顺序与原 Kotlin BuiltinSearchProviders.kt 一致）
import { AniRenaProvider } from './anirena.js';
import { AnimeToshoProvider } from './animetosho.js';
import { AudioBookBayProvider } from './audiobookbay.js';
import { BitSearchProvider } from './bitsearch.js';
import { DmhyProvider } from './dmhy.js';
import { ExtProvider } from './ext.js';
import { EztvProvider } from './eztv.js';
import { FileMoodProvider } from './filemood.js';
import { InternetArchiveProvider } from './internetarchive.js';
import { KnabenProvider } from './knaben.js';
import { LimeTorrentsProvider } from './limetorrents.js';
import { LinuxTrackerProvider } from './linuxtracker.js';
import { MikanProvider } from './mikan.js';
import { MyPornClubProvider } from './mypornclub.js';
import { NekoBtProvider } from './nekobt.js';
import { NyaaProvider } from './nyaa.js';
import { OxTorrentProvider } from './oxtorrent.js';
import { RutorProvider } from './rutor.js';
import { SubsPleaseProvider } from './subsplease.js';
import { SukebeiProvider } from './sukebei.js';
import { ThePirateBayProvider } from './thepiratebay.js';
import { TheRarBgProvider } from './therarbg.js';
import { ThirteenThirtySevenXProvider } from './thirteenthirtysevenx.js';
import { TokyoToshokanProvider } from './tokyotoshokan.js';
import { Torrent9Provider } from './torrent9.js';
import { TorrentDatabaseProvider } from './torrentdatabase.js';
import { TorrentDownloadProvider } from './torrentdownload.js';
import { TorrentDownloadsProvider } from './torrentdownloads.js';
import { TorrentKittyProvider } from './torrentkitty.js';
import { TorrentsCsvProvider } from './torrentscsv.js';
import { UIndexProvider } from './uindex.js';
import { XXXClubProvider } from './xxxclub.js';
import { XXXTrackerProvider } from './xxxtracker.js';
import { YtsProvider } from './yts.js';

/** 34 个内置 provider 实例 */
export const BuiltinProviders: SearchProvider[] = [
  new AniRenaProvider(),
  new AnimeToshoProvider(),
  new AudioBookBayProvider(),
  new BitSearchProvider(),
  new DmhyProvider(),
  new ExtProvider(),
  new EztvProvider(),
  new FileMoodProvider(),
  new InternetArchiveProvider(),
  new KnabenProvider(),
  new LimeTorrentsProvider(),
  new LinuxTrackerProvider(),
  new MikanProvider(),
  new MyPornClubProvider(),
  new NekoBtProvider(),
  new NyaaProvider(),
  new OxTorrentProvider(),
  new RutorProvider(),
  new SubsPleaseProvider(),
  new SukebeiProvider(),
  new ThePirateBayProvider(),
  new TheRarBgProvider(),
  new ThirteenThirtySevenXProvider(),
  new TokyoToshokanProvider(),
  new Torrent9Provider(),
  new TorrentDatabaseProvider(),
  new TorrentDownloadProvider(),
  new TorrentDownloadsProvider(),
  new TorrentKittyProvider(),
  new TorrentsCsvProvider(),
  new UIndexProvider(),
  new XXXClubProvider(),
  new XXXTrackerProvider(),
  new YtsProvider(),
];

/** 默认启用的 provider ID 集合（enabledByDefault=true 的 9 个） */
export const DEFAULT_ENABLED_PROVIDER_IDS: ReadonlySet<string> = new Set<string>(
  BuiltinProviders.filter((p) => p.enabledByDefault).map((p) => p.id),
);

/** 从 URL 提取主机名（小写，去 www. 前缀） */
function extractHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 聚合所有内置 provider 的元信息（给 GET /api/providers 用） */
export function getProviderInfoList(): ProviderInfo[] {
  return BuiltinProviders.map((p) => ({
    id: p.id,
    name: p.name,
    url: p.url,
    cloudflareSolverUrl: p.cloudflareSolverUrl,
    supportedCategories: [...p.supportedCategories],
    safetyStatus: p.safetyStatus,
    unsafeReason: p.unsafeReason,
    type: p.type,
    cloudflareProtected: p.isCloudflareProtected,
    enabledByDefault: p.enabledByDefault,
    capabilities: { ...p.capabilities },
    alternateUrlDomains:
      'alternateUrlDomains' in p ? [...(p as TorrentDetailsProvider).alternateUrlDomains] : undefined,
  }));
}

/** 按 URL 域名查找详情 provider（含 alternateUrlDomains） */
export function findDetailsProviderByUrl(url: string): TorrentDetailsProvider | null {
  const targetHost = extractHost(url);
  if (!targetHost) return null;
  for (const p of BuiltinProviders) {
    if (!isDetailsProviderImpl(p)) continue;
    if (extractHost(p.url) === targetHost) return p;
    if (p.alternateUrlDomains.some((d) => extractHost(d) === targetHost)) return p;
  }
  return null;
}

/** 按显示名查找详情 provider */
export function findDetailsProviderByName(name: string): TorrentDetailsProvider | null {
  for (const p of BuiltinProviders) {
    if (!isDetailsProviderImpl(p)) continue;
    if (p.name === name) return p;
  }
  return null;
}

/** 按 id 查找内置 provider */
export function findBuiltinProviderById(id: string): SearchProvider | null {
  return BuiltinProviders.find((p) => p.id === id) ?? null;
}

/**
 * 按 ids 过滤启用的内置 provider。
 * - providerIds 为空：返回所有内置 provider（默认全部启用）
 * - providerIds 非空：按指定 id 集合过滤
 */
export function getEnabledBuiltinProviders(providerIds: readonly string[]): SearchProvider[] {
  if (providerIds.length === 0) {
    return [...BuiltinProviders];
  }
  const idSet = new Set(providerIds);
  return BuiltinProviders.filter((p) => idSet.has(p.id));
}

// 内部类型守卫
function isDetailsProviderImpl(p: SearchProvider): p is TorrentDetailsProvider {
  return (
    p.capabilities.details === true &&
    typeof (p as TorrentDetailsProvider).getDetails === 'function'
  );
}
