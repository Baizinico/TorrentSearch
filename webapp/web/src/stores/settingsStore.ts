import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Category, DarkTheme, SortCriteria, SortOrder } from '../types';

interface SettingsState {
  // 外观
  darkTheme: DarkTheme;
  pureBlack: boolean;
  // 通用
  enableNSFW: boolean;
  blurNSFWImages: boolean;
  // 搜索
  defaultCategory: Category;
  sortCriteria: SortCriteria;
  sortOrder: SortOrder;
  maxNumResults: number; // -1 = 无限
  enabledProviderIds: string[]; // 空数组表示用默认（在 hook 中处理回退）
  unlockedProviderIds: string[]; // CF 已解锁的 provider id
  // 高级
  openDetailsInApp: boolean;
  flareSolverrUrl: string; // 空字符串 = 未配置
}

interface SettingsActions {
  setDarkTheme: (value: DarkTheme) => void;
  setPureBlack: (value: boolean) => void;
  setEnableNSFW: (value: boolean) => void;
  setBlurNSFWImages: (value: boolean) => void;
  setDefaultCategory: (value: Category) => void;
  setSortCriteria: (value: SortCriteria) => void;
  setSortOrder: (value: SortOrder) => void;
  setMaxNumResults: (value: number) => void;
  setEnabledProviderIds: (value: string[]) => void;
  setUnlockedProviderIds: (value: string[]) => void;
  setOpenDetailsInApp: (value: boolean) => void;
  setFlareSolverrUrl: (value: string) => void;

  toggleProvider: (id: string) => void;
  enableAllProviders: (ids: string[]) => void;
  disableAllProviders: () => void;
  unlockProvider: (id: string) => void;
  lockProvider: (id: string) => void;

  /** 派生：safeMode = !enableNSFW */
  safeMode: () => boolean;
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set, get) => ({
      // 外观
      darkTheme: 'FollowSystem',
      pureBlack: false,
      // 通用
      enableNSFW: false,
      blurNSFWImages: true,
      // 搜索
      defaultCategory: 'All',
      sortCriteria: 'Seeders',
      sortOrder: 'Descending',
      maxNumResults: -1,
      enabledProviderIds: [],
      unlockedProviderIds: [],
      // 高级
      openDetailsInApp: false,
      flareSolverrUrl: '',

      setDarkTheme: (value) => set({ darkTheme: value }),
      setPureBlack: (value) => set({ pureBlack: value }),
      setEnableNSFW: (value) => set({ enableNSFW: value }),
      setBlurNSFWImages: (value) => set({ blurNSFWImages: value }),
      setDefaultCategory: (value) => set({ defaultCategory: value }),
      setSortCriteria: (value) => set({ sortCriteria: value }),
      setSortOrder: (value) => set({ sortOrder: value }),
      setMaxNumResults: (value) => set({ maxNumResults: value }),
      setEnabledProviderIds: (value) => set({ enabledProviderIds: value }),
      setUnlockedProviderIds: (value) => set({ unlockedProviderIds: value }),
      setOpenDetailsInApp: (value) => set({ openDetailsInApp: value }),
      setFlareSolverrUrl: (value) => set({ flareSolverrUrl: value }),

      toggleProvider: (id) =>
        set((state) => ({
          enabledProviderIds: state.enabledProviderIds.includes(id)
            ? state.enabledProviderIds.filter((p) => p !== id)
            : [...state.enabledProviderIds, id],
        })),

      enableAllProviders: (ids) => set({ enabledProviderIds: ids }),

      disableAllProviders: () => set({ enabledProviderIds: [] }),

      unlockProvider: (id) =>
        set((state) => ({
          unlockedProviderIds: state.unlockedProviderIds.includes(id)
            ? state.unlockedProviderIds
            : [...state.unlockedProviderIds, id],
        })),

      lockProvider: (id) =>
        set((state) => ({
          unlockedProviderIds: state.unlockedProviderIds.filter(
            (p) => p !== id,
          ),
        })),

      safeMode: () => !get().enableNSFW,
    }),
    {
      name: 'ts:settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
