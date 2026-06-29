/**
 * 种子操作底部抽屉 —— 一组横向 action 按钮（含 danger）。
 */
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import type { Torrent } from '../../types';

export interface TorrentAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

export interface TorrentActionsSheetProps {
  open: boolean;
  onClose: () => void;
  torrent: Torrent | null;
  actions: TorrentAction[];
  className?: string;
}

/** 种子操作底部抽屉 */
export default function TorrentActionsSheet({
  open,
  onClose,
  torrent,
  actions,
  className,
}: TorrentActionsSheetProps) {
  if (!open || !torrent) return null;
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
        aria-label="种子操作"
        className={clsx(
          'fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-content',
          'bg-bg-card border-t border-border rounded-t-card p-4',
          'max-h-[80vh] overflow-y-auto z-50 animate-fade-in-up',
          className,
        )}
      >
        <div className="flex items-center justify-between mb-3 px-2">
          <h2 className="font-display text-base font-bold truncate flex-1 min-w-0">
            {torrent.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-0.5">
          {actions.map((a, i) => {
            const Icon = a.icon;
            return (
              <button
                key={`${a.label}-${i}`}
                type="button"
                onClick={() => {
                  a.onClick();
                  onClose();
                }}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover text-left transition-colors rounded-btn',
                  a.danger ? 'text-danger' : 'text-fg',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-sm">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
