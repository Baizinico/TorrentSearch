/**
 * useTorrentDetails — TanStack Query 包装 GET /api/details
 */

import { useQuery } from '@tanstack/react-query';
import { getTorrentDetails } from '../lib/api';
import { useTorznabStore } from '../stores/torznabStore';

export interface UseTorrentDetailsOptions {
  url: string;
  provider: string;
  /** enabled = false 时不请求 */
  enabled?: boolean;
}

export function useTorrentDetails(opts: UseTorrentDetailsOptions) {
  const torznabConfigs = useTorznabStore((s) => s.configs);

  return useQuery({
    queryKey: ['details', opts.url, opts.provider],
    enabled: opts.enabled !== false && !!opts.url,
    queryFn: () => getTorrentDetails(opts.url, opts.provider, torznabConfigs),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
