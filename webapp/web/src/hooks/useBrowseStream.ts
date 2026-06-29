/**
 * useBrowseStream — 流式浏览 Hook（latest / top）
 *
 * 与 useSearchStream 类似，但调用 /api/browse/{mode}
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, SearchFailure, Torrent } from '../types';
import { browseStream, type BrowseMode } from '../lib/api';
import { useSettingsStore } from '../stores/settingsStore';
import { useTorznabStore } from '../stores/torznabStore';

export type BrowseStatus = 'idle' | 'loading' | 'done' | 'error';

export interface UseBrowseStreamOptions {
  mode: BrowseMode;
  category: Category;
  /** 强制重新触发（递增数字） */
  trigger?: number;
}

export interface UseBrowseStreamResult {
  results: Torrent[];
  failures: SearchFailure[];
  status: BrowseStatus;
  progress: { completed: number; total: number };
  error: string | null;
  abort: () => void;
  reset: () => void;
}

function dedupeKey(t: Torrent): string {
  return `${t.infoHash}@${t.providerId}`;
}

export function useBrowseStream(opts: UseBrowseStreamOptions): UseBrowseStreamResult {
  const { mode, category, trigger } = opts;
  const [results, setResults] = useState<Torrent[]>([]);
  const [failures, setFailures] = useState<SearchFailure[]>([]);
  const [status, setStatus] = useState<BrowseStatus>('idle');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  const enabledProviderIds = useSettingsStore((s) => s.enabledProviderIds);
  const unlockedProviderIds = useSettingsStore((s) => s.unlockedProviderIds);
  const torznabConfigs = useTorznabStore((s) => s.configs);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((cur) => (cur === 'loading' ? 'done' : cur));
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
    setResults([]);
    setFailures([]);
    setProgress({ completed: 0, total: 0 });
    setError(null);
    setStatus('loading');

    const dedup = new Map<string, Torrent>();

    const controller = browseStream(
      {
        mode,
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
            setProgress((p) => ({ ...p, completed: p.completed + 1 }));
            break;
          }
          case 'failure': {
            setFailures((f) => [...f, event]);
            setProgress((p) => ({ ...p, completed: p.completed + 1 }));
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
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, category, trigger, enabledProviderIds, unlockedProviderIds, torznabConfigs]);

  return { results, failures, status, progress, error, abort, reset };
}
