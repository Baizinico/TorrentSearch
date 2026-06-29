import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { BookmarkedTorrent, Torrent } from '../types';

interface BookmarksState {
  items: BookmarkedTorrent[];
}

interface BookmarksActions {
  add: (torrent: Torrent) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (infoHash: string) => boolean;
  exportJSON: () => string;
  importJSON: (json: string) => { success: boolean; count: number };
}

function isBookmarkedTorrent(value: unknown): value is BookmarkedTorrent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    !!v.torrent &&
    typeof v.torrent === 'object' &&
    typeof (v.torrent as { infoHash?: unknown }).infoHash === 'string'
  );
}

export const useBookmarksStore = create<BookmarksState & BookmarksActions>()(
  persist(
    (set, get) => ({
      items: [],

      add: (torrent) =>
        set((state) => {
          if (
            state.items.some((b) => b.torrent.infoHash === torrent.infoHash)
          ) {
            return state;
          }
          const bookmark: BookmarkedTorrent = {
            id: crypto.randomUUID(),
            torrent,
          };
          return { items: [bookmark, ...state.items] };
        }),

      remove: (id) =>
        set((state) => ({
          items: state.items.filter((b) => b.id !== id),
        })),

      clear: () => set({ items: [] }),

      has: (infoHash) =>
        get().items.some((b) => b.torrent.infoHash === infoHash),

      exportJSON: () => JSON.stringify(get().items),

      importJSON: (json) => {
        try {
          const parsed = JSON.parse(json) as unknown;
          if (!Array.isArray(parsed)) {
            return { success: false, count: 0 };
          }
          const items: BookmarkedTorrent[] = [];
          for (const entry of parsed) {
            if (!isBookmarkedTorrent(entry)) {
              return { success: false, count: 0 };
            }
            items.push(entry);
          }
          set({ items });
          return { success: true, count: items.length };
        } catch {
          return { success: false, count: 0 };
        }
      },
    }),
    {
      name: 'ts:bookmarks',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
