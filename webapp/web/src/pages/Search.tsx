/**
 * 搜索页 /search — 流式搜索 + 虚拟列表 + 排序/过滤/失败源/FAB
 * 对应 spec §S12.2
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
import SearchBar from '../components/search/SearchBar';
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
import { useSearchStream } from '../hooks/useSearchStream';
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

const ROW_HEIGHT = 72;
const SKELETON_COUNT = 8;

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  // 从 URL 读取初始值
  const initialQuery = searchParams.get('q') ?? '';
  const initialCategory = (searchParams.get('category') as Category) ?? 'All';

  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<Category>(
    isCategoryValid(initialCategory) ? initialCategory : 'All',
  );

  // 排序与过滤状态
  const sortCriteria = useSettingsStore((s) => s.sortCriteria);
  const sortOrder = useSettingsStore((s) => s.sortOrder);
  const setSort = useSettingsStore((s) => s.setSortCriteria);
  const setOrder = useSettingsStore((s) => s.setSortOrder);
  const enableNSFW = useSettingsStore((s) => s.enableNSFW);
  const maxNumResults = useSettingsStore((s) => s.maxNumResults);
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

  const scrollRef = useRef<HTMLDivElement>(null);

  // 重新搜索触发器（同 query/category 下也能强制刷新）
  const [trigger, setTrigger] = useState(0);

  // 流式搜索 hook
  const { results, failures, status, progress, error, abort } = useSearchStream({
    query: initialQuery,
    category,
    trigger,
  });

  // providers 数据
  const { providers } = useProviders();
  const bookmarksItems = useBookmarksStore((s) => s.items);
  const addBookmark = useBookmarksStore((s) => s.add);
  const removeBookmark = useBookmarksStore((s) => s.remove);
  const viewedIds = useViewedStore((s) => s.ids);
  const markViewed = useViewedStore((s) => s.mark);

  // 安全模式类别列表
  const categories = useMemo(
    () => (enableNSFW ? ALL_CATEGORIES : SAFE_CATEGORIES),
    [enableNSFW],
  );

  // 已浏览集合
  const viewedSet = useMemo(() => new Set(viewedIds), [viewedIds]);

  // 书签 infoHash → id 映射
  const bookmarkMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bookmarksItems) m.set(b.torrent.infoHash, b.id);
    return m;
  }, [bookmarksItems]);

  // provider id → name 映射（用于失败源展示）
  const providerNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of providers) m.set(p.id, p.name);
    return m;
  }, [providers]);

  // 用户选择的 provider id 集合（用于过滤 sheet 选中态）
  const selectedProviderIds = useMemo(
    () => new Set(enabledProviderIds),
    [enabledProviderIds],
  );

  // 应用排序与过滤
  const visibleResults = useMemo(() => {
    const filtered = filterTorrents(results, {
      hideDead: filters.hideDead,
      hideViewed: filters.hideViewed,
      viewedIds: viewedSet,
      nameFilter: filters.nameFilter,
    });
    const sorted = sortTorrents(filtered, sortCriteria, sortOrder);
    if (maxNumResults > 0) return sorted.slice(0, maxNumResults);
    return sorted;
  }, [
    results,
    filters,
    viewedSet,
    sortCriteria,
    sortOrder,
    maxNumResults,
  ]);

  // 唯一结果来源数
  const sourceCount = useMemo(
    () => new Set(visibleResults.map((t) => t.providerId)).size,
    [visibleResults],
  );

  // 同步 URL query 参数（用户在页内修改查询时）
  const updateUrl = (q: string, cat: Category) => {
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q);
    else next.delete('q');
    next.set('category', cat);
    setSearchParams(next, { replace: true });
  };

  // 重新搜索（用户在搜索框回车或类别变化时）
  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    updateUrl(trimmed, category);
    // 通过修改 URL 后 searchParams 会变，从而 initialQuery 变化触发搜索
    setTrigger((t) => t + 1);
  };

  // 监听 URL 变化，同步本地 query
  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  // 取消搜索当组件卸载
  useEffect(() => {
    return () => abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚动监听 FAB 显隐
  const handleScroll = (scrollTop: number) => {
    setShowFab(scrollTop > 400);
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 打开详情
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

  // 复制磁力链接
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

  // 切换书签
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

  // 空查询态
  if (!initialQuery.trim()) {
    return (
      <div className="max-w-content mx-auto px-4 py-6">
        <EmptyState
          icon={AlertCircle}
          title="请输入搜索关键字"
          description="在上方搜索框输入关键字后开始搜索。"
          action={
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-primary"
            >
              返回首页
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏 */}
      <div className="sticky top-0 z-20 bg-bg-base/95 backdrop-blur border-b border-border">
        <div className="max-w-content mx-auto px-4 py-3 space-y-3">
          {/* 搜索框 */}
          <SearchBar
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            placeholder="搜索种子..."
            size="sm"
          />

          {/* 类别 + 工具按钮 */}
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryChipsRow
              value={category}
              onChange={(c) => {
                setCategory(c);
                if (initialQuery.trim()) {
                  updateUrl(initialQuery, c);
                  setTrigger((t) => t + 1);
                }
              }}
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
          {status === 'searching' && (
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
        {/* 结果计数 */}
        <div className="max-w-content mx-auto px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="text-sm text-fg-muted">
            {status === 'error' ? (
              <span className="text-danger">搜索失败</span>
            ) : status === 'searching' && visibleResults.length === 0 ? (
              <span>搜索中...</span>
            ) : (
              <>
                已找到{' '}
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

        {/* 列表 / 骨架 / 空态 / 错误态 */}
        <div className="max-w-content mx-auto">
          {status === 'error' ? (
            <ErrorState
              icon={AlertCircle}
              title="搜索出错"
              description={error ?? '请稍后重试'}
              onRetry={() => setTrigger((t) => t + 1)}
            />
          ) : status === 'searching' && visibleResults.length === 0 ? (
            <div>
              {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : visibleResults.length === 0 ? (
            <EmptyState
              icon={AlertCircle}
              title={status === 'done' ? '未找到结果' : '等待搜索...'}
              description={
                status === 'done'
                  ? `没有 provider 返回与 "${initialQuery}" 匹配的种子。可尝试更换关键字或类别。`
                  : undefined
              }
              action={
                status === 'done' ? (
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="btn-ghost"
                  >
                    返回首页
                  </button>
                ) : undefined
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

      {/* 过滤抽屉 */}
      <FilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onReset={() =>
          setFilters({ hideDead: false, hideViewed: false, nameFilter: '' })
        }
      />

      {/* Provider 过滤抽屉 */}
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

      {/* 失败源抽屉 */}
      {failureSheetOpen && (
        <FailureSheet
          failures={failures}
          providerNameMap={providerNameMap}
          onClose={() => setFailureSheetOpen(false)}
        />
      )}

      {/* FAB 滚动到顶 */}
      {showFab && <FAB icon={ArrowUp} onClick={scrollToTop} label="回到顶部" />}
    </div>
  );
}

/** 校验类别字符串是否合法 */
function isCategoryValid(c: string | null): c is Category {
  return c != null && ALL_CATEGORIES.includes(c as Category);
}

/** 失败源列表抽屉 */
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
