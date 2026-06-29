/**
 * 过滤底部抽屉 —— 死种/已浏览/名称过滤。
 */
import { X } from 'lucide-react';
import clsx from 'clsx';

export interface FilterState {
  hideDead: boolean;
  hideViewed: boolean;
  nameFilter: string;
}

export interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  filters: FilterState;
  onChange: (f: Partial<FilterState>) => void;
  onReset?: () => void;
  className?: string;
}

/** 自写的 toggle 开关 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-2">
      <span className="text-sm text-fg">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative w-9 h-5 rounded-full transition-colors shrink-0',
          checked ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </label>
  );
}

/** 过滤底部抽屉 */
export default function FilterSheet({
  open,
  onClose,
  filters,
  onChange,
  onReset,
  className,
}: FilterSheetProps) {
  if (!open) return null;
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
        aria-label="过滤"
        className={clsx(
          'fixed bottom-0 left-0 right-0 mx-auto w-full max-w-content',
          'bg-bg-card border-t border-border rounded-t-card p-6',
          'max-h-[80vh] overflow-y-auto z-50 animate-fade-in-up',
          className,
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold">过滤</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 divide-y divide-border">
          <div className="pt-1">
            <Toggle
              label="隐藏死种"
              checked={filters.hideDead}
              onChange={(v) => onChange({ hideDead: v })}
            />
          </div>
          <div>
            <Toggle
              label="隐藏已浏览"
              checked={filters.hideViewed}
              onChange={(v) => onChange({ hideViewed: v })}
            />
          </div>
          <div className="pt-3">
            <label className="block text-sm text-fg mb-2">名称包含</label>
            <input
              type="text"
              value={filters.nameFilter}
              onChange={(e) => onChange({ nameFilter: e.target.value })}
              placeholder="输入关键字..."
              className="input w-full"
            />
          </div>
        </div>

        {onReset && (
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onReset}
              className="btn-ghost"
            >
              重置
            </button>
          </div>
        )}
      </div>
    </>
  );
}
