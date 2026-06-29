/**
 * 排序菜单 —— 字段+方向选择下拉。
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react';
import clsx from 'clsx';
import type { SortCriteria, SortOrder } from '../../types';

export interface SortMenuProps {
  criteria: SortCriteria;
  order: SortOrder;
  onChange: (c: SortCriteria, o: SortOrder) => void;
  className?: string;
}

const FIELDS: Array<{ value: SortCriteria; label: string }> = [
  { value: 'Name', label: '名称' },
  { value: 'Seeders', label: '做种数' },
  { value: 'Peers', label: '下载数' },
  { value: 'FileSize', label: '大小' },
  { value: 'Date', label: '日期' },
];

/** 排序菜单（trigger 按钮 + 下拉面板） */
export default function SortMenu({
  criteria,
  order,
  onChange,
  className,
}: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentLabel = FIELDS.find((f) => f.value === criteria)?.label ?? '名称';
  const OrderDirIcon = order === 'Ascending' ? ArrowUp : ArrowDown;

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ArrowUpDown className="w-4 h-4 text-accent" />
        <span>{currentLabel}</span>
        <OrderDirIcon className="w-3.5 h-3.5 text-fg-muted" />
      </button>
      {open && (
        <div
          role="menu"
          className="card absolute right-0 mt-1 min-w-[200px] py-1 z-30 animate-fade-in"
        >
          {FIELDS.map((f) => {
            const active = f.value === criteria;
            const orderForThis: SortOrder = active ? order : 'Descending';
            const DirIcon = orderForThis === 'Ascending' ? ArrowUp : ArrowDown;
            return (
              <button
                key={f.value}
                type="button"
                role="menuitem"
                onClick={() => {
                  if (active) {
                    // 切换方向
                    onChange(
                      f.value,
                      order === 'Ascending' ? 'Descending' : 'Ascending',
                    );
                  } else {
                    onChange(f.value, order);
                  }
                  setOpen(false);
                }}
                className={clsx(
                  'px-3 py-2 text-sm hover:bg-bg-hover cursor-pointer flex items-center justify-between w-full text-left',
                  active && 'text-accent',
                )}
              >
                <span className="flex items-center gap-2">
                  {active && <Check className="w-3.5 h-3.5" />}
                  {f.label}
                </span>
                <DirIcon className="w-3.5 h-3.5 text-fg-muted" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
