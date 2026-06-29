/**
 * useSearchStream — 流式搜索 Hook
 *
 * 调用方传入 query/category 等，返回：
 * - results: Torrent[]（已合并）
 * - failures: SearchFailure[]
 * - status: 'idle' | 'searching' | 'done' | 'error'
 * - abort: () => void（取消）
 * - reset: () => void（重置状态）
 *
 * 自动从 settingsStore 与 torznabStore 读取 providerIds/torznabConfigs/unlockedIds
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, SearchFailure, Torrent } from '../types';
import { searchStream } from '../lib/api';
import { useSettingsStore } from '../stores/settingsStore';
import { useTorznabStore } from '../stores/torznabStore';

export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';

export interface UseSearchStreamOptions {
  /** 不传或为空字符串 → idle */
  query: string;
  category: Category;
  /** 强制重新触发（递增数字） */
  trigger?: number;
}

export interface UseSearchStreamResult {
  results: Torrent[];
  failures: SearchFailure[];
  status: SearchStatus;
  /** 已完成的 provider 数 / 总 provider 数 */
  progress: { completed: number; total: number };
  error: string | null;
  abort: () => void;
  reset: () => void;
}

/** 搜索结果去重键：infoHash + providerId（同一 hash 在不同 provider 各算一条） */
function dedupeKey(t: Torrent): string {
  return `${t.infoHash}@${t.providerId}`;
}

export function useSearchStream(opts: UseSearchStreamOptions): UseSearchStreamResult {
  const { query, category, trigger } = opts;
  const [results, setResults] = useState<Torrent[]>([]);
  const [failures, setFailures] = useState<SearchFailure[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  // 从 stores 读取配置（订阅变化）
  const enabledProviderIds = useSettingsStore((s) => s.enabledProviderIds);
  const unlockedProviderIds = useSettingsStore((s) => s.unlockedProviderIds);
  const torznabConfigs = useTorznabStore((s) => s.configs);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((cur) => (cur === 'searching' ? 'done' : cur));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setResults([]);
    setFailures([]);
    setProgress({ completed: 0, total: 0 });
    setError(null);
    setStatus('idle');
  }, []);

  useEffect(() => {
    // 空 query → idle
    const trimmed = query.trim();
    if (!trimmed) {
      reset();
      return;
    }

    // 重置状态
    setResults([]);
    setFailures([]);
    setProgress({ completed: 0, total: 0 });
    setError(null);
    setStatus('searching');

    // 用 Map 去重
    const dedup = new Map<string, Torrent>();

    const controller = searchStream(
      {
        query: trimmed,
        category,
        providerIds: enabledProviderIds,
        torznabConfigs,
        cloudflareUnlocked: unlockedProviderIds,
      },
      (event) => {
        switch (event.type) {
          case 'batch': {
            for (const t of event.torrents) {
              dedup.set(dedupeKey(t), t);
            }
            setResults(Array.from(dedup.values()));
            setProgress((p) => ({
              ...p,
              completed: p.completed + 1,
            }));
            break;
          }
          case 'failure': {
            setFailures((f) => [...f, event]);
            setProgress((p) => ({
              ...p,
              completed: p.completed + 1,
            }));
            break;
          }
          case 'done': {
            setProgress({
              completed: event.completedProviders,
              total: event.totalProviders,
            });
            setStatus('done');
            break;
          }
        }
      },
      (err) => {
        setError(err.message);
        setStatus('error');
      },
    );

    controllerRef.current = controller;

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, trigger, enabledProviderIds, unlockedProviderIds, torznabConfigs]);

  return { results, failures, status, progress, error, abort, reset };
}
