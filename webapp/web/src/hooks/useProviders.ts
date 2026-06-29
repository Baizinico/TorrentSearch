/**
 * useProviders — TanStack Query 包装 GET /api/providers
 *
 * 返回 ProviderInfo[]，与 settingsStore 合并计算 enabled 状态
 */

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProviders } from '../lib/api';
import { useSettingsStore } from '../stores/settingsStore';
import type {
  Category,
  ProviderCapabilities,
  ProviderInfo,
  ProviderType,
  SafetyStatus,
} from '../types';

export interface ProviderWithEnabled extends ProviderInfo {
  /** 派生：当前是否启用 */
  enabled: boolean;
}

export function useProviders() {
  const enabledProviderIds = useSettingsStore((s) => s.enabledProviderIds);
  const setEnabledProviderIds = useSettingsStore(
    (s) => s.setEnabledProviderIds,
  );

  const query = useQuery({
    queryKey: ['providers'],
    queryFn: getProviders,
    staleTime: 10 * 60 * 1000, // 静态数据，10 分钟
  });

  // 首次加载 providers 后，若用户从未配置过 enabledProviderIds（空数组），
  // 自动初始化为所有内置 provider id（默认全部启用）。
  useEffect(() => {
    if (query.data && query.data.length > 0 && enabledProviderIds.length === 0) {
      setEnabledProviderIds(query.data.map((p) => p.id));
    }
  }, [query.data, enabledProviderIds.length, setEnabledProviderIds]);

  const providers: ProviderWithEnabled[] = useMemo(() => {
    const list = query.data ?? [];
    const userSet = new Set(enabledProviderIds);
    return list.map((p) => ({
      ...p,
      enabled: userSet.has(p.id),
    }));
  }, [query.data, enabledProviderIds]);

  return {
    providers,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

// Re-export types for convenience
export type { Category, ProviderCapabilities, ProviderType, SafetyStatus };
