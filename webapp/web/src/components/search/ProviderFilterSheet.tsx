/**
 * Provider 过滤底部抽屉 —— 复选框 + 类别 badges + 安全标记。
 */
import { Check, Square, X } from 'lucide-react';
import clsx from 'clsx';
import type { ProviderInfo } from '../../types';
import Badge from '../ui/Badge';

export interface ProviderFilterSheetProps {
  open: boolean;
  onClose: () => void;
  providers: ProviderInfo[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
  className?: string;
}

/** Provider 过滤底部抽屉 */
export default function ProviderFilterSheet({
  open,
  onClose,
  providers,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
  className,
}: ProviderFilterSheetProps) {
  if (!open) return null;
  const allSelected =
    providers.length > 0 && providers.every((p) => selectedIds.has(p.id));

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
        aria-label="Provider 过滤"
        className={clsx(
          'fixed bottom-0 left-0 right-0 mx-auto w-full max-w-content',
          'bg-bg-card border-t border-border rounded-t-card p-6',
          'max-h-[80vh] overflow-y-auto z-50 animate-fade-in-up',
          className,
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold">Provider 过滤</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={allSelected ? onClearAll : onSelectAll}
            className="btn-ghost text-sm"
          >
            {allSelected ? '全不选' : '全选'}
          </button>
          <span className="text-xs text-fg-muted ml-auto">
            已选 {selectedIds.size} / {providers.length}
          </span>
        </div>

        <div className="space-y-1">
          {providers.map((p) => {
            const checked = selectedIds.has(p.id);
            const safe = p.safetyStatus === 'Safe';
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onToggle(p.id)}
                className={clsx(
                  'w-full flex items-start gap-3 px-3 py-3 rounded-btn text-left transition-colors',
                  'hover:bg-bg-hover',
                  checked && 'bg-bg-hover',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {checked ? (
                    <Check className="w-4 h-4 text-accent" />
                  ) : (
                    <Square className="w-4 h-4 text-fg-subtle" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-fg truncate">
                      {p.name}
                    </span>
                    <Badge
                      variant={safe ? 'success' : 'danger'}
                      title={p.unsafeReason}
                    >
                      {safe ? '安全' : '不安全'}
                    </Badge>
                    {p.type === 'Torznab' && (
                      <Badge variant="cyan">Torznab</Badge>
                    )}
                    {p.cloudflareProtected && (
                      <Badge variant="accent">CF</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {p.supportedCategories.map((c) => (
                      <Badge key={c} variant="default">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
          {providers.length === 0 && (
            <div className="py-8 text-center text-sm text-fg-muted">
              暂无可用 provider
            </div>
          )}
        </div>
      </div>
    </>
  );
}
