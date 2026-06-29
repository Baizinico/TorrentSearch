/**
 * 种子行 —— compact / detailed 两种变体，支持虚拟列表 style 注入。
 */
import type { CSSProperties } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Bookmark, Link2 } from 'lucide-react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { Torrent } from '../../types';

dayjs.extend(relativeTime);

export interface TorrentRowProps {
  torrent: Torrent;
  onOpenDetails?: (t: Torrent) => void;
  onBookmark?: (t: Torrent) => void;
  onCopyMagnet?: (t: Torrent) => void;
  isBookmarked?: boolean;
  isViewed?: boolean;
  variant?: 'compact' | 'detailed';
  className?: string;
  style?: CSSProperties;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '未知';
  const d = dayjs(iso);
  return d.isValid() ? d.fromNow() : '未知';
}

/** NSFW 警告标记 */
function NsfwMark() {
  return (
    <AlertTriangle
      className="w-3.5 h-3.5 text-nsfw shrink-0"
      aria-label="NSFW"
      strokeWidth={2.2}
    />
  );
}

/** Magnet 操作按钮 */
function MagnetButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-label="复制磁力链接"
      className="p-1.5 rounded text-fg-muted hover:text-cyan hover:bg-bg-hover transition-colors"
    >
      <Link2 className="w-4 h-4" />
    </button>
  );
}

/** Bookmark 操作按钮 */
function BookmarkButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-label={active ? '取消书签' : '添加书签'}
      className={clsx(
        'p-1.5 rounded transition-colors',
        active
          ? 'text-accent hover:bg-accent/10'
          : 'text-fg-muted hover:text-accent hover:bg-bg-hover',
      )}
    >
      <Bookmark
        className={clsx('w-4 h-4', active && 'fill-current')}
        strokeWidth={2}
      />
    </button>
  );
}

/** compact 单行布局 */
function CompactRow({
  torrent,
  isBookmarked,
  isViewed,
  onOpenDetails,
  onBookmark,
  onCopyMagnet,
  className,
  style,
}: TorrentRowProps) {
  return (
    <div
      onClick={() => onOpenDetails?.(torrent)}
      className={clsx(
        'flex items-center gap-3 px-4 py-3 hover:bg-bg-hover border-b border-border cursor-pointer',
        className,
      )}
      style={style}
    >
      <span
        className={clsx(
          'w-2 h-2 rounded-full shrink-0',
          isViewed ? 'bg-fg-subtle' : 'bg-accent',
        )}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {torrent.isNSFW && <NsfwMark />}
          <span className="text-sm text-fg truncate font-medium">
            {torrent.name}
          </span>
        </div>
        <div className="flex gap-3 text-xs text-fg-muted mt-0.5">
          <span className="font-mono">{torrent.size}</span>
          <span className="text-success flex items-center gap-0.5">
            <ArrowUp className="w-3 h-3" />
            {torrent.seeders}
          </span>
          <span className="text-cyan flex items-center gap-0.5">
            <ArrowDown className="w-3 h-3" />
            {torrent.peers}
          </span>
          <span className="truncate">{torrent.providerName}</span>
          <span className="shrink-0">{formatRelative(torrent.uploadDate)}</span>
        </div>
      </div>
      <div className="flex items-center shrink-0">
        <MagnetButton onClick={() => onCopyMagnet?.(torrent)} />
        <BookmarkButton
          active={!!isBookmarked}
          onClick={() => onBookmark?.(torrent)}
        />
      </div>
    </div>
  );
}

/** detailed 双行卡片布局 */
function DetailedRow({
  torrent,
  isBookmarked,
  isViewed,
  onOpenDetails,
  onBookmark,
  onCopyMagnet,
  className,
  style,
}: TorrentRowProps) {
  return (
    <div
      onClick={() => onOpenDetails?.(torrent)}
      className={clsx('card card-hover p-4 cursor-pointer', className)}
      style={style}
    >
      <div className="flex items-start gap-2">
        {torrent.isNSFW && <NsfwMark />}
        <h3 className="flex-1 text-sm font-medium text-fg leading-snug break-words">
          {torrent.name}
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          {torrent.category && (
            <span className="badge bg-bg-hover text-fg-muted border border-border">
              {torrent.category}
            </span>
          )}
          {isViewed && (
            <span className="badge bg-bg-hover text-fg-subtle border border-border">
              已浏览
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted mt-2">
        <span className="font-mono">{torrent.size}</span>
        <span className="text-success flex items-center gap-0.5">
          <ArrowUp className="w-3 h-3" />
          {torrent.seeders} 做种
        </span>
        <span className="text-cyan flex items-center gap-0.5">
          <ArrowDown className="w-3 h-3" />
          {torrent.peers} 下载
        </span>
        <span>{torrent.providerName}</span>
        <span>{formatRelative(torrent.uploadDate)}</span>
      </div>
      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border">
        <MagnetButton onClick={() => onCopyMagnet?.(torrent)} />
        <BookmarkButton
          active={!!isBookmarked}
          onClick={() => onBookmark?.(torrent)}
        />
      </div>
    </div>
  );
}

/** 种子行（compact 或 detailed） */
export default function TorrentRow(props: TorrentRowProps) {
  const { variant = 'compact' } = props;
  return variant === 'detailed' ? (
    <DetailedRow {...props} />
  ) : (
    <CompactRow {...props} />
  );
}
