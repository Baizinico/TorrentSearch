/**
 * API 客户端：封装所有与后端 /api 的通信
 *
 * - 简单 JSON 路由用 fetch
 * - SSE 流式路由用 fetch + ReadableStream + AbortController
 * - 类型化：所有返回值有 TS 类型
 */

import type {
  Category,
  GetTorrentDetailsResponse,
  ProviderInfo,
  SearchEvent,
  TorznabCheckResult,
  TorznabConfig,
} from '../types';

/** 后端基础 URL（开发模式走 Vite 代理 /api → :3001，生产同源） */
const API_BASE = '/api';

/** JSON 请求辅助 */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new ApiError(resp.status, text || resp.statusText);
  }
  return resp.json() as Promise<T>;
}

/** 自定义错误类 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ==================== Providers ====================

/** GET /api/providers — 返回所有内置 provider 元信息 */
export async function getProviders(): Promise<ProviderInfo[]> {
  const data = await fetchJson<{ providers: ProviderInfo[] }>(
    `${API_BASE}/providers`,
  );
  return data.providers;
}

// ==================== Trackers ====================

/** GET /api/trackers — 公共 tracker 列表 */
export async function getTrackers(): Promise<string[]> {
  const data = await fetchJson<{ trackers: string[] }>(`${API_BASE}/trackers`);
  return data.trackers;
}

// ==================== Details ====================

/** GET /api/details — 抓取详情 */
export async function getTorrentDetails(
  url: string,
  provider: string,
  torznabConfigs: readonly TorznabConfig[],
): Promise<GetTorrentDetailsResponse> {
  const qs = new URLSearchParams({
    url,
    provider,
    torznabConfigs: JSON.stringify(torznabConfigs),
  });
  return fetchJson<GetTorrentDetailsResponse>(`${API_BASE}/details?${qs}`);
}

// ==================== Torznab ====================

/** POST /api/torznab/check — 检测 Torznab 索引器连接 */
export async function checkTorznab(
  url: string,
  apiKey: string,
): Promise<TorznabCheckResult> {
  return fetchJson<TorznabCheckResult>(`${API_BASE}/torznab/check`, {
    method: 'POST',
    body: JSON.stringify({ url, apiKey }),
  });
}

// ==================== 搜索（SSE 流式） ====================

/** 搜索请求参数 */
export interface SearchStreamParams {
  query: string;
  category: Category;
  providerIds: readonly string[];
  torznabConfigs: readonly TorznabConfig[];
  cloudflareUnlocked: readonly string[];
}

/** SSE 流式搜索：调用方传入 onEvent 回调，返回 abort 函数 */
export function searchStream(
  params: SearchStreamParams,
  onEvent: (event: SearchEvent) => void,
  onError?: (err: Error) => void,
  signal?: AbortSignal,
): AbortController {
  const controller = new AbortController();
  // 联动外部 signal
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  (async () => {
    let resp: Response;
    try {
      resp = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: params.query,
          category: params.category,
          providerIds: params.providerIds,
          torznabConfigs: params.torznabConfigs,
          cloudflareUnlocked: params.cloudflareUnlocked,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      onError?.(new ApiError(resp.status, text || resp.statusText));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const ev = JSON.parse(json) as SearchEvent;
            onEvent(ev);
          } catch (err) {
            // 单条解析失败不中断整体流
            console.warn('[sse] parse error:', err, json);
          }
        }
      }
      // 处理尾部
      if (buffer.startsWith('data: ')) {
        const json = buffer.slice(6).trim();
        if (json) {
          try {
            onEvent(JSON.parse(json) as SearchEvent);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return controller;
}

// ==================== 浏览（SSE 流式） ====================

/** 浏览类型 */
export type BrowseMode = 'latest' | 'top';

/** 浏览请求参数 */
export interface BrowseStreamParams {
  mode: BrowseMode;
  category: Category;
  providerIds: readonly string[];
  torznabConfigs: readonly TorznabConfig[];
  cloudflareUnlocked: readonly string[];
}

/** SSE 流式浏览 */
export function browseStream(
  params: BrowseStreamParams,
  onEvent: (event: SearchEvent) => void,
  onError?: (err: Error) => void,
  signal?: AbortSignal,
): AbortController {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  (async () => {
    let resp: Response;
    try {
      const qs = new URLSearchParams({
        category: params.category,
        providerIds: JSON.stringify(params.providerIds),
        torznabConfigs: JSON.stringify(params.torznabConfigs),
        cloudflareUnlocked: JSON.stringify(params.cloudflareUnlocked),
      });
      resp = await fetch(`${API_BASE}/browse/${params.mode}?${qs}`, {
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      onError?.(new ApiError(resp.status, text || resp.statusText));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            onEvent(JSON.parse(json) as SearchEvent);
          } catch (err) {
            console.warn('[sse] parse error:', err, json);
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return controller;
}
