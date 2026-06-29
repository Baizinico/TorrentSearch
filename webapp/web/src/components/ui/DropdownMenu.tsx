import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

export interface DropdownItem {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  danger?: boolean;
  separator?: boolean;
}

interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  className?: string;
}

/** 下拉菜单：点击 trigger 切换，外部点击关闭，支持 danger / separator 项 */
export default function DropdownMenu({
  trigger,
  items,
  align = 'right',
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    window.addEventListener('keydown', escHandler);
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('keydown', escHandler);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={clsx(
            'card absolute z-40 mt-1 min-w-[180px] py-1 animate-fade-in',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, idx) => {
            if (item.separator) {
              return (
                <div
                  key={`sep-${idx}`}
                  className="border-t border-border my-1"
                  role="separator"
                />
              );
            }
            const ItemIcon = item.icon;
            return (
              <button
                key={`${item.label}-${idx}`}
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onClick?.();
                  setOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                  'hover:bg-bg-hover transition-colors',
                  item.danger
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-fg',
                )}
              >
                {ItemIcon ? (
                  <ItemIcon size={15} strokeWidth={2} className="shrink-0" />
                ) : null}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
