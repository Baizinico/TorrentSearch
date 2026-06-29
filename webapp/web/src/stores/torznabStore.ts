import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TorznabConfig } from '../types';

interface TorznabState {
  configs: TorznabConfig[];
}

interface TorznabActions {
  add: (config: Omit<TorznabConfig, 'id'>) => void;
  update: (id: string, config: Partial<TorznabConfig>) => void;
  remove: (id: string) => void;
}

export const useTorznabStore = create<TorznabState & TorznabActions>()(
  persist(
    (set) => ({
      configs: [],

      add: (config) =>
        set((state) => ({
          configs: [
            ...state.configs,
            { ...config, id: crypto.randomUUID() } satisfies TorznabConfig,
          ],
        })),

      update: (id, config) =>
        set((state) => ({
          configs: state.configs.map((c) =>
            c.id === id ? { ...c, ...config } : c,
          ),
        })),

      remove: (id) =>
        set((state) => ({
          configs: state.configs.filter((c) => c.id !== id),
        })),
    }),
    {
      name: 'ts:torznab',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
