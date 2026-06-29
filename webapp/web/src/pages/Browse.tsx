/**
 * 浏览页 /browse — latest / top 双 tab + 类别 + 排序 + provider 过滤 + 流式列表
 * 对应 spec §S12.3
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUp,
  Filter,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import CategoryChipsRow from '../components/search/CategoryChipsRow';
import SortMenu from '../components/search/SortMenu';
import FilterSheet, {
  type FilterState,
} from '../components/search/FilterSheet';
import ProviderFilterSheet from '../components/search/ProviderFilterSheet';
import TorrentRow from '../components/torrent/TorrentRow';
import VirtualList from '../components/torrent/VirtualList';
import FAB from '../components/ui/FAB';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import SkeletonRow from '../components/ui/SkeletonRow';
import { useToast } from '../components/ui/Toast';
import { useBrowseStream } from '../hooks/useBrowseStream';
import { useProviders } from '../hooks/useProviders';
import { useSettingsStore } from '../stores/settingsStore';
import { useBookmarksStore } from '../stores/bookmarksStore';
import { useViewedStore } from '../stores/viewedStore';
import { filterTorrents, sortTorrents } from '../lib/torrent-utils';
import {
  ALL_CATEGORIES,
  SAFE_CATEGORIES,
  type Category,
  type Torrent,
} from '../types';
import type { BrowseMode } from '../lib/api';

const ROW_HEIGHT = 72;
const SKELETON_COUNT = 8;

const TABS: Array<{ value: BrowseMode; label: string }> = [
  { value: 'latest', label: '最新' },
  { value: 'top', label: '热门' },
];

function isBrowseMode(v: string | null): v is BrowseMode {
  return v === 'latest' || v === 'top';
}

function isCategoryValid(c: string | null): c is Category {
  return c != null && ALL_CATEGORIES.includes(c as Category);
}

export default function Browse() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const initialTab: BrowseMode = isBrowseMode(searchParams.get('tab'))
    ? (searchParams.get('tab') as BrowseMode)
    : 'latest';
  const initialCategory: Category = isCategoryValid(searchParams.get('category'))
    ? (searchParams.get('category') as Category)
    : 'All';

  const [tab, setTab] = useState<BrowseMode>(initialTab);
  const [category, setCategory] = useState<Category>(initialCategory);

  const sortCriteria = useSettingsStore((s) => s.sortCriteria);
  const sortOrder = useSettingsStore((s) => s.sortOrder);
  const setSort = useSettingsStore((s) => s.setSortCriteria);
  const setOrder = useSettingsStore((s) => s.setSortOrder);
  const enableNSFW = useSettingsStore((s) => s.enableNSFW);
  const enabledProviderIds = useSettingsStore((s) => s.enabledProviderIds);
  const toggleProvider = useSettingsStore((s) => s.toggleProvider);
  const openDetailsInApp = useSettingsStore((s) => s.openDetailsInApp);

  const [filters, setFilters] = useState<FilterState>({
    hideDead: false,
    hideViewed: false,
    nameFilter: '',
  });
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [providerSheetOpen, setProviderSheetOpen] = useState(false);
  const [failureSheetOpen, setFailureSheetOpen] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [trigger, setTrigger] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);

  const { results, failures, status, progress, error, abort } = useBrowseStream({
    mode: tab,
    category,
    trigger,
  });

  const { providers } = useProviders();
  const bookmarksItems = useBookmarksStore((s) => s.items);
  const addBookmark = useBookmarksStore((s) => s.add);
  const removeBookmark = useBookmarksStore((s) => s.remove);
  const viewedIds = useViewedStore((s) => s.ids);
  const markViewed = useViewedStore((s) => s.mark);

  const categories = useMemo(
    () => (enableNSFW ? ALL_CATEGORIES : SAFE_CATEGORIES),
    [enableNSFW],
  );

  const viewedSet = useMemo(() => new Set(viewedIds), [viewedIds]);

  const bookmarkMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bookmarksItems) m.set(b.torrent.infoHash, b.id);
    return m;
  }, [bookmarksItems]);

  const providerNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of providers) m.set(p.id, p.name);
    return m;
  }, [providers]);

  const selectedProviderIds = useMemo(
    () => new Set(enabledProviderIds),
    [enabledProviderIds],
  );

  const visibleResults = useMemo(() => {
    const filtered = filterTorrents(results, {
      hideDead: filters.hideDead,
      hideViewed: filters.hideViewed,
      viewedIds: viewedSet,
      nameFilter: filters.nameFilter,
    });
    return sortTorrents(filtered, sortCriteria, sortOrder);
  }, [results, filters, viewedSet, sortCriteria, sortOrder]);

  const sourceCount = useMemo(
    () => new Set(visibleResults.map((t) => t.providerId)).size,
    [visibleResults],
  );

  const updateUrl = (nextTab: BrowseMode, cat: Category) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    next.set('category', cat);
    setSearchParams(next, { replace: true });
  };

  const switchTab = (next: BrowseMode) => {
    setTab(next);
    updateUrl(next, category);
    setTrigger((t) => t + 1);
  };

  const changeCategory = (c: Category) => {
    setCategory(c);
    updateUrl(tab, c);
    setTrigger((t) => t + 1);
  };

  useEffect(() => {
    return () => abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = (scrollTop: number) => {
    setShowFab(scrollTop > 400);
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openDetails = (t: Torrent) => {
    markViewed(t.infoHash);
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
      toast('复制失败，请手动复制', 'error');
    }
  };

  const toggleBookmark = (t: Torrent) => {
    const existingId = bookmarkMap.get(t.infoHash);
    if (existingId) {
      removeBookmark(existingId);
      toast('已取消书签', 'info');
    } else {
      addBookmark(t);
      toast('已添加书签', 'success');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏 */}
      <div className="sticky top-0 z-20 bg-bg-base/95 backdrop-blur border-b border-border">
        <div className="max-w-content mx-auto px-4 py-3 space-y-3">
          {/* Tab 切换 */}
          <div className="flex items-center gap-1 p-1 bg-bg-subtle rounded-btn w-fit">
            {TABS.map((t) => {
              const active = t.value === tab;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => switchTab(t.value)}
                  className={clsx(
                    'px-4 py-1.5 rounded text-sm font-medium transition-colors',
                    active
                      ? 'bg-accent text-black'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* 类别 + 工具按钮 */}
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryChipsRow
              value={category}
              onChange={changeCategory}
              categories={categories}
              size="sm"
              className="flex-1 min-w-0"
            />
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
              onClick={() => setProviderSheetOpen(true)}
              className="btn-secondary px-3 h-9"
              aria-label="Provider 过滤"
              title="Provider 过滤"
            >
              <SlidersHorizontal className="w-4 h-4 text-accent" />
            </button>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              className={clsx(
                'btn-secondary px-3 h-9',
                (filters.hideDead || filters.hideViewed || filters.nameFilter) &&
                  'ring-1 ring-accent',
              )}
              aria-label="过滤"
              title="过滤"
            >
              <Filter className="w-4 h-4 text-accent" />
            </button>
          </div>

          {/* 进度条 */}
          {status === 'loading' && (
            <div className="flex items-center gap-3 text-xs text-fg-muted">
              <div className="flex-1 h-1 bg-bg-hover rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{
                    width: progress.total
                      ? `${(progress.completed / progress.total) * 100}%`
                      : '0%',
                  }}
                />
              </div>
              <span className="font-mono shrink-0">
                {progress.completed}/{progress.total || '?'} 源
              </span>
              <button
                type="button"
                onClick={abort}
                className="text-danger hover:text-danger/80 transition-colors"
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 结果区域 */}
      <div className="flex-1 min-h-0">
        <div className="max-w-content mx-auto px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="text-sm text-fg-muted">
            {status === 'error' ? (
              <span className="text-danger">加载失败</span>
            ) : status === 'loading' && visibleResults.length === 0 ? (
              <span>加载中...</span>
            ) : (
              <>
                {tab === 'latest' ? '最新' : '热门'} ·{' '}
                <span className="text-fg font-semibold font-mono">
                  {visibleResults.length}
                </span>{' '}
                条
                {sourceCount > 0 && (
                  <>
                    {' '}
                    （<span className="text-fg font-mono">{sourceCount}</span>{' '}
                    个源）
                  </>
                )}
              </>
            )}
          </div>
          {failures.length > 0 && (
            <button
              type="button"
              onClick={() => setFailureSheetOpen(true)}
              className="text-xs text-danger hover:text-danger/80 flex items-center gap-1"
            >
              <XCircle className="w-3.5 h-3.5" />
              {failures.length} 个源失败
            </button>
          )}
        </div>

        <div className="max-w-content mx-auto">
          {status === 'error' ? (
            <ErrorState
              icon={AlertCircle}
              title="加载出错"
              description={error ?? '请稍后重试'}
              onRetry={() => setTrigger((t) => t + 1)}
            />
          ) : status === 'loading' && visibleResults.length === 0 ? (
            <div>
              {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : visibleResults.length === 0 ? (
            <EmptyState
              icon={AlertCircle}
              title={status === 'done' ? '暂无内容' : '等待加载...'}
              description={
                status === 'done'
                  ? '没有 provider 返回内容。可尝试切换类别或 tab。'
                  : undefined
              }
            />
          ) : (
            <VirtualList
              items={visibleResults}
              rowHeight={ROW_HEIGHT}
              scrollRef={scrollRef}
              onScroll={handleScroll}
              height="calc(100vh - 220px)"
              renderRow={(t) => (
                <TorrentRow
                  torrent={t}
                  variant="compact"
                  isBookmarked={bookmarkMap.has(t.infoHash)}
                  isViewed={viewedSet.has(t.infoHash)}
                  onOpenDetails={openDetails}
                  onBookmark={toggleBookmark}
                  onCopyMagnet={copyMagnet}
                  className="animate-fade-in"
                />
              )}
            />
          )}
        </div>
      </div>

      <FilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onReset={() =>
          setFilters({ hideDead: false, hideViewed: false, nameFilter: '' })
        }
      />

      <ProviderFilterSheet
        open={providerSheetOpen}
        onClose={() => setProviderSheetOpen(false)}
        providers={providers}
        selectedIds={selectedProviderIds}
        onToggle={(id) => toggleProvider(id)}
        onSelectAll={() =>
          useSettingsStore
            .getState()
            .setEnabledProviderIds(providers.map((p) => p.id))
        }
        onClearAll={() =>
          useSettingsStore.getState().setEnabledProviderIds([])
        }
      />

      {failureSheetOpen && (
        <FailureSheet
          failures={failures}
          providerNameMap={providerNameMap}
          onClose={() => setFailureSheetOpen(false)}
        />
      )}

      {showFab && <FAB icon={ArrowUp} onClick={scrollToTop} label="回到顶部" />}
    </div>
  );
}

function FailureSheet({
  failures,
  providerNameMap,
  onClose,
}: {
  failures: { providerId: string; providerName: string; message: string }[];
  providerNameMap: Map<string, string>;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="失败源"
        className="fixed bottom-0 left-0 right-0 mx-auto w-full max-w-content bg-bg-card border-t border-border rounded-t-card p-6 max-h-[80vh] overflow-y-auto z-50 animate-fade-in-up"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold">
            失败源 ({failures.length})
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-2">
          {failures.map((f, i) => {
            const name = providerNameMap.get(f.providerId) ?? f.providerName;
            return (
              <div
                key={`${f.providerId}-${i}`}
                className="card p-3 flex items-start gap-3"
              >
                <XCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-fg truncate">
                    {name}
                  </div>
                  <div className="text-xs text-fg-muted mt-0.5 break-words">
                    {f.message}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
