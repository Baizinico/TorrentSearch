/**
 * SearchProvidersGateway — Provider 调度核心
 * 对应原 Kotlin domain/SearchProvidersGateway.kt
 *
 * 职责：
 * - searchTorrents：AsyncGenerator 流式产出 SearchEvent（batch / failure / done）
 * - getLatestTorrents / getTopTorrents：浏览类流式接口
 * - getTorrentDetails：详情页抓取
 *
 * 关键设计：
 * - 按 providerIds 过滤内置 + 实例化 Torznab provider
 * - 按 category + supportedCategories 二次过滤
 * - 并发执行所有 provider，每完成一个立即 yield 事件
 * - 支持 AbortSignal 取消（每个 provider 都接收 signal）
 * - CF provider 未在 unlockedIds 中：跳过并 yield failure
 */

import type {
  Category,
  GetTorrentDetailsResponse,
  SearchBatch,
  SearchDone,
  SearchEvent,
  SearchFailure,
  Torrent,
  TorrentDetails,
  TorznabConfig,
} from '../types.js';
import { CloudflareChallengeError, HttpClient } from '../http/HttpClient.js';
import { config } from '../config.js';
// HttpClient 用于在 search() 时为每个 provider 隔离 cookie jar
import {
  type LatestTorrentsProvider,
  type SearchContext,
  type SearchProvider,
  type TopTorrentsProvider,
  type TorrentDetailsProvider,
  isLatestTorrentsProvider,
  isTopTorrentsProvider,
} from '../providers/SearchProvider.js';
import { TorznabSearchProvider } from '../providers/TorznabSearchProvider.js';
import {
  findDetailsProviderByName,
  findDetailsProviderByUrl,
  getEnabledBuiltinProviders,
} from '../providers/registry.js';

/** 网关构造选项 */
export interface SearchProvidersGatewayOptions {
  /** FlareSolverr 地址（覆盖全局 config） */
  flareSolverrUrl?: string;
}

export class SearchProvidersGateway {
  private readonly flareSolverrUrl: string;

  constructor(opts: SearchProvidersGatewayOptions = {}) {
    this.flareSolverrUrl = opts.flareSolverrUrl ?? config.flareSolverrUrl;
  }

  /**
   * 流式搜索：每完成一个 provider 立即 yield batch/failure，结束 yield done。
   * 支持 AbortSignal 取消。
   */
  async *searchTorrents(
    query: string,
    category: Category,
    providerIds: readonly string[],
    torznabConfigs: readonly TorznabConfig[],
    unlockedIds: readonly string[],
    signal?: AbortSignal,
  ): AsyncGenerator<SearchEvent, void, void> {
    const providers = this.resolveProviders(providerIds, torznabConfigs);
    // 按类别过滤：'All' 时所有 provider 都参与；否则 supportedCategories 须包含目标类别
    const eligible =
      category === 'All'
        ? providers
        : providers.filter((p) => p.supportedCategories.includes(category));

    const totalProviders = eligible.length;
    if (totalProviders === 0) {
      yield { type: 'done', totalProviders: 0, completedProviders: 0 };
      return;
    }

    const unlockedSet = new Set(unlockedIds);
    let completed = 0;

    // 为每个 provider 启动一个 Promise，按完成顺序 yield 事件。
    // 用队列保存已完成的事件，主循环消费。
    const eventQueue: SearchEvent[] = [];
    let resolveDrain: (() => void) | null = null;
    let rejected = false;
    let rejectionError: unknown = null;

    const enqueue = (ev: SearchEvent) => {
      eventQueue.push(ev);
      if (resolveDrain) {
        const fn = resolveDrain;
        resolveDrain = null;
        fn();
      }
    };

    const allSettled = Promise.allSettled(
      eligible.map(async (provider) => {
        if (signal?.aborted) return;
        try {
          // CF 保护且未解锁：直接 yield failure
          if (provider.isCloudflareProtected && !unlockedSet.has(provider.id)) {
            enqueue({
              type: 'failure',
              providerId: provider.id,
              providerName: provider.name,
              providerUrl: provider.url,
              message: 'Cloudflare protected — unlock this provider in settings to enable it.',
            } satisfies SearchFailure);
            return;
          }

          const httpClient = new HttpClient({
            flareSolverrUrl: this.flareSolverrUrl || undefined,
          });
          const ctx: SearchContext = { category, httpClient };

          const torrents = await runWithAbort(provider.search(query, ctx), signal);
          enqueue({
            type: 'batch',
            providerId: provider.id,
            providerName: provider.name,
            torrents,
          } satisfies SearchBatch);
        } catch (err) {
          if (signal?.aborted) return;
          const message =
            err instanceof CloudflareChallengeError
              ? 'Cloudflare challenge detected. Configure FlareSolverr or unlock this provider.'
              : err instanceof Error
                ? err.message
                : String(err);
          enqueue({
            type: 'failure',
            providerId: provider.id,
            providerName: provider.name,
            providerUrl: provider.url,
            message,
          } satisfies SearchFailure);
        }
      }),
    );

    // 防止 Promise.allSettled 异常未被捕获
    allSettled.catch((err) => {
      rejected = true;
      rejectionError = err;
      if (resolveDrain) {
        const fn = resolveDrain;
        resolveDrain = null;
        fn();
      }
    });

    // 主循环：等所有 provider 完成
    while (true) {
      if (signal?.aborted) return;
      // 排空队列
      while (eventQueue.length > 0) {
        const ev = eventQueue.shift()!;
        if (ev.type === 'batch' || ev.type === 'failure') completed++;
        yield ev;
      }
      // 检查是否全部完成
      const settled = await Promise.race([
        allSettled.then(() => true),
        new Promise<false>((resolve) => {
          resolveDrain = () => resolve(false);
        }),
      ]);
      if (settled) {
        // 最终排空
        while (eventQueue.length > 0) {
          const ev = eventQueue.shift()!;
          if (ev.type === 'batch' || ev.type === 'failure') completed++;
          yield ev;
        }
        if (rejected && rejectionError) {
          throw rejectionError;
        }
        break;
      }
    }

    const done: SearchDone = {
      type: 'done',
      totalProviders,
      completedProviders: completed,
    };
    yield done;
  }

  /** 浏览最新：仅对实现了 LatestTorrentsProvider 的 provider 调用 */
  async *getLatestTorrents(
    category: Category,
    providerIds: readonly string[],
    torznabConfigs: readonly TorznabConfig[],
    unlockedIds: readonly string[],
    signal?: AbortSignal,
  ): AsyncGenerator<SearchEvent, void, void> {
    const providers = this.resolveProviders(providerIds, torznabConfigs).filter(
      (p): p is SearchProvider & LatestTorrentsProvider =>
        isLatestTorrentsProvider(p) &&
        (category === 'All' || p.supportedCategories.includes(category)),
    );
    yield* this.runBrowse(
      providers,
      (p) => p.getLatestTorrents(category),
      unlockedIds,
      signal,
    );
  }

  /** 浏览热门：仅对实现了 TopTorrentsProvider 的 provider 调用 */
  async *getTopTorrents(
    category: Category,
    providerIds: readonly string[],
    torznabConfigs: readonly TorznabConfig[],
    unlockedIds: readonly string[],
    signal?: AbortSignal,
  ): AsyncGenerator<SearchEvent, void, void> {
    const providers = this.resolveProviders(providerIds, torznabConfigs).filter(
      (p): p is SearchProvider & TopTorrentsProvider =>
        isTopTorrentsProvider(p) &&
        (category === 'All' || p.supportedCategories.includes(category)),
    );
    yield* this.runBrowse(
      providers,
      (p) => p.getTopTorrents(category),
      unlockedIds,
      signal,
    );
  }

  /** 抓取详情：先按 URL 找内置 provider，再按名称，最后按 Torznab config 名匹配 */
  async getTorrentDetails(
    detailsPageUrl: string,
    providerName: string,
    torznabConfigs: readonly TorznabConfig[],
  ): Promise<GetTorrentDetailsResponse> {
    // 1. 内置详情 provider（按 URL）
    const builtinByUrl = findDetailsProviderByUrl(detailsPageUrl);
    if (builtinByUrl) {
      return this.callDetailsProvider(builtinByUrl, detailsPageUrl);
    }
    // 2. 内置详情 provider（按名）
    const builtinByName = findDetailsProviderByName(providerName);
    if (builtinByName) {
      return this.callDetailsProvider(builtinByName, detailsPageUrl);
    }
    // 3. Torznab provider（按名匹配 config）
    const matchedConfig = torznabConfigs.find((c) => c.name === providerName);
    if (matchedConfig) {
      // Torznab 通常不支持详情页抓取，但若用户名匹配，返回 unsupported
      return { status: 'unsupported' };
    }
    return { status: 'unsupported' };
  }

  // ============== 内部实现 ==============

  /** 解析 provider 列表：内置（按 id 过滤）+ Torznab（从 config 实例化） */
  private resolveProviders(
    providerIds: readonly string[],
    torznabConfigs: readonly TorznabConfig[],
  ): SearchProvider[] {
    const idSet = new Set(providerIds);
    const builtin = getEnabledBuiltinProviders(providerIds);
    const torznab: TorznabSearchProvider[] = torznabConfigs
      .filter((c) => idSet.has(c.id))
      .map((c) => new TorznabSearchProvider(c));
    return [...builtin, ...torznab];
  }

  /** 调用详情 provider 并包装为 GetTorrentDetailsResponse */
  private async callDetailsProvider(
    provider: TorrentDetailsProvider,
    url: string,
  ): Promise<GetTorrentDetailsResponse> {
    try {
      // 详情 provider 内部使用 getDefaultHttpClient()；FlareSolverr URL 通过全局 config 生效。
      const details: TorrentDetails | null = await provider.getDetails(url);
      if (!details) return { status: 'unavailable' };
      return { status: 'success', details };
    } catch (err) {
      // 异常视为不可用，避免单点失败影响整体
      console.warn(`[Gateway] getDetails failed for ${provider.name} (${url}):`, err);
      return { status: 'unavailable' };
    }
  }

  /** 浏览类（latest/top）通用流式执行器 */
  private async *runBrowse<T extends SearchProvider>(
    providers: readonly T[],
    run: (p: T) => Promise<Torrent[]>,
    unlockedIds: readonly string[],
    signal?: AbortSignal,
  ): AsyncGenerator<SearchEvent, void, void> {
    const totalProviders = providers.length;
    if (totalProviders === 0) {
      yield { type: 'done', totalProviders: 0, completedProviders: 0 };
      return;
    }
    const unlockedSet = new Set(unlockedIds);
    let completed = 0;

    const eventQueue: SearchEvent[] = [];
    let resolveDrain: (() => void) | null = null;

    const enqueue = (ev: SearchEvent) => {
      eventQueue.push(ev);
      if (resolveDrain) {
        const fn = resolveDrain;
        resolveDrain = null;
        fn();
      }
    };

    const allSettled = Promise.allSettled(
      providers.map(async (provider) => {
        if (signal?.aborted) return;
        try {
          if (provider.isCloudflareProtected && !unlockedSet.has(provider.id)) {
            enqueue({
              type: 'failure',
              providerId: provider.id,
              providerName: provider.name,
              providerUrl: provider.url,
              message: 'Cloudflare protected — unlock this provider in settings to enable it.',
            } satisfies SearchFailure);
            return;
          }
          const torrents = await runWithAbort(run(provider), signal);
          enqueue({
            type: 'batch',
            providerId: provider.id,
            providerName: provider.name,
            torrents,
          } satisfies SearchBatch);
        } catch (err) {
          if (signal?.aborted) return;
          enqueue({
            type: 'failure',
            providerId: provider.id,
            providerName: provider.name,
            providerUrl: provider.url,
            message: err instanceof Error ? err.message : String(err),
          } satisfies SearchFailure);
        }
      }),
    );

    while (true) {
      if (signal?.aborted) return;
      while (eventQueue.length > 0) {
        const ev = eventQueue.shift()!;
        if (ev.type === 'batch' || ev.type === 'failure') completed++;
        yield ev;
      }
      const settled = await Promise.race([
        allSettled.then(() => true),
        new Promise<false>((resolve) => {
          resolveDrain = () => resolve(false);
        }),
      ]);
      if (settled) {
        while (eventQueue.length > 0) {
          const ev = eventQueue.shift()!;
          if (ev.type === 'batch' || ev.type === 'failure') completed++;
          yield ev;
        }
        break;
      }
    }

    yield { type: 'done', totalProviders, completedProviders: completed };
  }
}

/**
 * 包装一个 Promise，在 AbortSignal 触发时立即 reject。
 * 注意：原 Promise 不会被真正取消（JS 无真取消），但调用方会忽略后续结果。
 */
function runWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}
