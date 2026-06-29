/**
 * 书签页 /bookmarks — 计数 + 排序 + 导入/导出/全删 + 列表 + 空态
 * 对应 spec §S12.5
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bookmark,
  Download,
  FileUp,
  Search as SearchIcon,
  Trash2,
} from 'lucide-react';
import SortMenu from '../components/search/SortMenu';
import TorrentRow from '../components/torrent/TorrentRow';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { useBookmarksStore } from '../stores/bookmarksStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useViewedStore } from '../stores/viewedStore';
import { sortTorrents } from '../lib/torrent-utils';
import type { Torrent } from '../types';

export default function Bookmarks() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = useBookmarksStore((s) => s.items);
  const removeBookmark = useBookmarksStore((s) => s.remove);
  const clearBookmarks = useBookmarksStore((s) => s.clear);
  const exportJSON = useBookmarksStore((s) => s.exportJSON);
  const importJSON = useBookmarksStore((s) => s.importJSON);

  const sortCriteria = useSettingsStore((s) => s.sortCriteria);
  const sortOrder = useSettingsStore((s) => s.sortOrder);
  const setSort = useSettingsStore((s) => s.setSortCriteria);
  const setOrder = useSettingsStore((s) => s.setSortOrder);
  const openDetailsInApp = useSettingsStore((s) => s.openDetailsInApp);

  const viewedIds = useViewedStore((s) => s.ids);
  const viewedSet = useMemo(() => new Set(viewedIds), [viewedIds]);

  const [confirmOpen, setConfirmOpen] = useState(false);

  // 排序后的书签列表
  const sortedItems = useMemo(() => {
    const torrents = items.map((b) => b.torrent);
    const sortedTorrents = sortTorrents(torrents, sortCriteria, sortOrder);
    // 用排序后的 torrent 顺序反查 bookmark id
    const idMap = new Map<string, string>();
    for (const b of items) idMap.set(b.torrent.infoHash, b.id);
    return sortedTorrents.map((t) => ({
      torrent: t,
      bookmarkId: idMap.get(t.infoHash)!,
    }));
  }, [items, sortCriteria, sortOrder]);

  const handleExport = () => {
    if (items.length === 0) {
      toast('没有可导出的书签', 'info');
      return;
    }
    const json = exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `torrentsearch-bookmarks-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`已导出 ${items.length} 条书签`, 'success');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== 'string') {
        toast('文件读取失败', 'error');
        return;
      }
      const result = importJSON(text);
      if (result.success) {
        toast(`已导入 ${result.count} 条书签`, 'success');
      } else {
        toast('文件格式无效', 'error');
      }
    };
    reader.onerror = () => toast('文件读取失败', 'error');
    reader.readAsText(file);
    // 重置 input 以便重复导入同一文件
    e.target.value = '';
  };

  const handleClearAll = () => {
    clearBookmarks();
    setConfirmOpen(false);
    toast('已清空所有书签', 'info');
  };

  const handleRemove = (bookmarkId: string) => {
    removeBookmark(bookmarkId);
    toast('已删除书签', 'info');
  };

  const openDetails = (t: Torrent) => {
    if (openDetailsInApp) {
      const qs = new URLSearchParams({
        url: t.descriptionPageUrl,
        provider: t.providerName,
      });
      navigate(`/details?${qs.toString()}`);
    } else {
      window.open(t.descriptionPageUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const copyMagnet = async (t: Torrent) => {
    if (!t.magnetUri) {
      toast('该种子无磁力链接', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(t.magnetUri);
      toast('已复制磁力链接', 'success');
    } catch {
      toast('复制失败', 'error');
    }
  };

  return (
    <div className="max-w-content mx-auto px-4 py-6 pb-24">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">书签</h1>
          <p className="text-sm text-fg-muted mt-1">
            共 <span className="font-mono text-fg">{items.length}</span> 条
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <SortMenu
              criteria={sortCriteria}
              order={sortOrder}
              onChange={(c, o) => {
                setSort(c);
                setOrder(o);
              }}
            />
            <button
              type="button"
              onClick={handleImportClick}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <FileUp className="w-4 h-4 text-accent" />
              导入
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4 text-cyan" />
              导出
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="btn-secondary inline-flex items-center gap-2 text-danger"
            >
              <Trash2 className="w-4 h-4" />
              全部删除
            </button>
          </div>
        )}
      </div>

      {/* 隐藏文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 列表 / 空态 */}
      {items.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="还没有书签"
          description="在搜索或浏览时点击种子右侧的书签图标即可收藏。"
          action={
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-primary inline-flex items-center gap-2"
            >
              <SearchIcon className="w-4 h-4" />
              去搜索
            </button>
          }
        />
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {sortedItems.map(({ torrent, bookmarkId }) => (
            <TorrentRow
              key={bookmarkId}
              torrent={torrent}
              variant="detailed"
              isBookmarked
              isViewed={viewedSet.has(torrent.infoHash)}
              onOpenDetails={openDetails}
              onCopyMagnet={copyMagnet}
              onBookmark={() => handleRemove(bookmarkId)}
            />
          ))}
        </div>
      )}

      {/* 全部删除确认 */}
      <ConfirmDialog
        open={confirmOpen}
        title="清空所有书签？"
        description={`将删除全部 ${items.length} 条书签，无法撤销。`}
        confirmLabel="清空"
        variant="danger"
        onConfirm={handleClearAll}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
