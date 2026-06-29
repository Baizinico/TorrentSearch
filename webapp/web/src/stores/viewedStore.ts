import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ViewedState {
  ids: string[]; // infoHash 数组
}

interface ViewedActions {
  mark: (infoHash: string) => void;
  has: (infoHash: string) => boolean;
  clear: () => void;
}

export const useViewedStore = create<ViewedState & ViewedActions>()(
  persist(
    (set, get) => ({
      ids: [],

      mark: (infoHash) =>
        set((state) => ({
          ids: state.ids.includes(infoHash)
            ? state.ids
            : [infoHash, ...state.ids],
        })),

      has: (infoHash) => get().ids.includes(infoHash),

      clear: () => set({ ids: [] }),
    }),
    {
      name: 'ts:viewed',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
