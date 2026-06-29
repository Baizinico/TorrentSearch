/**
 * 详情页 /details — 海报 + 主信息 + 截图 + 描述 + CTA
 * 对应 spec §S12.4
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  Calendar,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  Link2,
  Loader,
  Magnet,
  Tag,
  User,
} from 'lucide-react';
import clsx from 'clsx';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import { useToast } from '../components/ui/Toast';
import { useTorrentDetails } from '../hooks/useTorrentDetails';
import { useBookmarksStore } from '../stores/bookmarksStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatRelativeTime } from '../lib/torrent-utils';

export default function Details() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const url = searchParams.get('url') ?? '';
  const provider = searchParams.get('provider') ?? '';

  const blurNSFWImages = useSettingsStore((s) => s.blurNSFWImages);
  const bookmarksItems = useBookmarksStore((s) => s.items);
  const addBookmark = useBookmarksStore((s) => s.add);
  const removeBookmark = useBookmarksStore((s) => s.remove);

  const { data, isLoading, error, refetch } = useTorrentDetails({
    url,
    provider,
  });

  const [posterRevealed, setPosterRevealed] = useState(false);

  const bookmarkId = useMemo(() => {
    if (data?.status !== 'success') return null;
    const found = bookmarksItems.find(
      (b) => b.torrent.infoHash === data.details.infoHash,
    );
    return found?.id ?? null;
  }, [bookmarksItems, data]);

  if (!url) {
    return (
      <div className="max-w-content mx-auto px-4 py-6">
        <EmptyState
          icon={AlertCircle}
          title="缺少详情页 URL"
          description="请从搜索结果或浏览列表进入详情页。"
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

  if (isLoading) {
    return (
      <div className="max-w-content mx-auto px-4 py-6">
        <div className="card p-6 animate-pulse">
          <div className="h-6 w-2/3 bg-bg-hover rounded mb-4" />
          <div className="h-4 w-1/3 bg-bg-hover rounded mb-6" />
          <div className="flex gap-4">
            <div className="w-48 h-64 bg-bg-hover rounded-card" />
            <div className="flex-1 space-y-3">
              <div className="h-4 w-full bg-bg-hover rounded" />
              <div className="h-4 w-3/4 bg-bg-hover rounded" />
              <div className="h-4 w-1/2 bg-bg-hover rounded" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 text-fg-muted mt-6">
          <Loader className="w-4 h-4 animate-spin" />
          <span className="text-sm">正在抓取详情...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-content mx-auto px-4 py-6">
        <ErrorState
          icon={AlertCircle}
          title="抓取详情失败"
          description={error.message}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-content mx-auto px-4 py-6">
        <EmptyState icon={AlertCircle} title="无数据" />
      </div>
    );
  }

  if (data.status === 'unsupported') {
    return (
      <div className="max-w-content mx-auto px-4 py-6">
        <EmptyState
          icon={AlertCircle}
          title="该站点不支持详情抓取"
          description={`${provider} 未提供详情页解析能力。可直接在浏览器中打开原页面查看。`}
          action={
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              在浏览器打开
            </a>
          }
        />
      </div>
    );
  }

  if (data.status === 'unavailable') {
    return (
      <div className="max-w-content mx-auto px-4 py-6">
        <ErrorState
          icon={AlertCircle}
          title="详情暂不可用"
          description="provider 未返回详情数据，可能页面结构变化或临时不可访问。"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const details = data.details;
  const shouldBlur = details.isNSFW && blurNSFWImages && !posterRevealed;

  const copyMagnet = async () => {
    if (!details.magnetUri) {
      toast('无磁力链接', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(details.magnetUri);
      toast('已复制磁力链接', 'success');
    } catch {
      toast('复制失败', 'error');
    }
  };

  const copyPageUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('已复制页面 URL', 'success');
    } catch {
      toast('复制失败', 'error');
    }
  };

  const toggleBookmark = () => {
    if (bookmarkId) {
      removeBookmark(bookmarkId);
      toast('已取消书签', 'info');
    } else {
      // 从详情构造一个最小 Torrent 入库
      addBookmark({
        infoHash: details.infoHash,
        name: details.name,
        size: details.size ?? '未知',
        seeders: details.seeders ?? 0,
        peers: details.peers ?? 0,
        providerName: provider,
        providerId: provider,
        uploadDate: details.uploadDate,
        category: details.category,
        descriptionPageUrl: url,
        magnetUri: details.magnetUri,
        fileDownloadLink: details.fileDownloadLink,
        isNSFW: details.isNSFW,
      });
      toast('已添加书签', 'success');
    }
  };

  return (
    <div className="max-w-content mx-auto px-4 py-6 pb-24">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-card mb-6">
        {/* 模糊背景 */}
        {details.posterUrl && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center scale-110 blur-3xl opacity-30"
            style={{ backgroundImage: `url(${details.posterUrl})` }}
          />
        )}
        <div className="relative flex flex-col md:flex-row gap-6 p-6">
          {/* 海报 */}
          {details.posterUrl && (
            <div className="shrink-0 mx-auto md:mx-0">
              <button
                type="button"
                onClick={() => setPosterRevealed((v) => !v)}
                className={clsx(
                  'block rounded-card overflow-hidden border border-border',
                  'transition-all hover:ring-2 hover:ring-accent',
                  shouldBlur && 'blur-xl',
                )}
                title={shouldBlur ? '点击解除模糊' : '点击模糊'}
              >
                <img
                  src={details.posterUrl}
                  alt={details.name}
                  className="w-48 h-64 object-cover"
                  loading="lazy"
                />
              </button>
              {shouldBlur && (
                <div className="text-xs text-fg-muted text-center mt-2">
                  NSFW · 点击解除模糊
                </div>
              )}
            </div>
          )}

          {/* 主信息卡 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {details.category && (
                <Badge variant="accent">{details.category}</Badge>
              )}
              {details.isNSFW && <Badge variant="nsfw">NSFW</Badge>}
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-fg leading-tight break-words">
              {details.name}
            </h1>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
              <InfoItem
                icon={HardDrive}
                label="大小"
                value={details.size ?? '未知'}
                mono
              />
              <InfoItem
                icon={ArrowUp}
                label="做种"
                value={details.seeders?.toString() ?? '未知'}
                valueClass="text-success"
                mono
              />
              <InfoItem
                icon={ArrowDown}
                label="下载"
                value={details.peers?.toString() ?? '未知'}
                valueClass="text-cyan"
                mono
              />
              <InfoItem
                icon={Calendar}
                label="上传时间"
                value={
                  details.uploadDate
                    ? formatRelativeTime(details.uploadDate)
                    : '未知'
                }
              />
              <InfoItem
                icon={Tag}
                label="InfoHash"
                value={truncate(details.infoHash, 16)}
                mono
              />
              <InfoItem
                icon={User}
                label="发布者"
                value={details.uploader ?? '未知'}
              />
            </div>

            {details.lastChecked && (
              <div className="text-xs text-fg-subtle mt-4">
                最后检查：{formatRelativeTime(details.lastChecked)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap gap-2">
          {details.magnetUri && (
            <a
              href={details.magnetUri}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Magnet className="w-4 h-4" />
              打开磁力链接
            </a>
          )}
          {details.fileDownloadLink && (
            <a
              href={details.fileDownloadLink}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4 text-accent" />
              下载 .torrent
            </a>
          )}
          <button
            type="button"
            onClick={copyMagnet}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Link2 className="w-4 h-4 text-cyan" />
            复制磁力链
          </button>
          <button
            type="button"
            onClick={copyPageUrl}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Copy className="w-4 h-4 text-fg-muted" />
            复制页面 URL
          </button>
          <button
            type="button"
            onClick={toggleBookmark}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-btn font-medium text-sm transition-colors',
              bookmarkId
                ? 'bg-accent/15 text-accent border border-accent/40'
                : 'bg-bg-hover text-fg hover:bg-border-strong border border-border',
            )}
          >
            <Bookmark
              className={clsx('w-4 h-4', bookmarkId && 'fill-current')}
            />
            {bookmarkId ? '已收藏' : '收藏'}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex items-center gap-2 ml-auto"
          >
            <ExternalLink className="w-4 h-4" />
            原页面
          </a>
        </div>
      </div>

      {/* 截图 */}
      {details.screenshotUrls.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display text-sm font-semibold text-fg-muted uppercase tracking-wider mb-3">
            截图
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {details.screenshotUrls.map((src, i) => (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  'shrink-0 w-64 h-36 rounded-card overflow-hidden border border-border',
                  'hover:ring-2 hover:ring-accent transition-all',
                  shouldBlur && 'blur-xl',
                )}
              >
                <img
                  src={src}
                  alt={`截图 ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 描述 */}
      {details.description && (
        <div className="card p-6">
          <h2 className="font-display text-sm font-semibold text-fg-muted uppercase tracking-wider mb-3">
            描述
          </h2>
          <div className="prose prose-invert max-w-none text-sm leading-relaxed text-fg">
            <ReactMarkdown
              components={{
                img: ({ src, alt }) => (
                  <img
                    src={typeof src === 'string' ? src : undefined}
                    alt={alt ?? ''}
                    loading="lazy"
                    className={clsx(
                      'rounded-card max-w-full h-auto my-3',
                      shouldBlur && 'blur-xl',
                    )}
                  />
                ),
                a: ({ href, children }) => (
                  <a
                    href={typeof href === 'string' ? href : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent-hover underline"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {details.description}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

/** 信息项：图标 + 标签 + 值 */
function InfoItem({
  icon: Icon,
  label,
  value,
  valueClass,
  mono,
}: {
  icon: typeof HardDrive;
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Icon className="w-4 h-4 text-fg-subtle shrink-0" />
      <div className="min-w-0">
        <div className="text-xs text-fg-subtle">{label}</div>
        <div
          className={clsx(
            'text-sm text-fg truncate',
            valueClass,
            mono && 'font-mono',
          )}
          title={value}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

/** 截断字符串（保留首尾） */
function truncate(s: string, max: number): string {
  if (s.length <= max * 2) return s;
  return `${s.slice(0, max)}...${s.slice(-max)}`;
}
