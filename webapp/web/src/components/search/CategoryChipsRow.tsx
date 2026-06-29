/**
 * 类别 chips 横向滚动行 —— 隐藏滚动条，激活态 accent 高亮。
 */
import clsx from 'clsx';
import type { Category } from '../../types';
import { ALL_CATEGORIES } from '../../types';

export interface CategoryChipsRowProps {
  value: Category;
  onChange: (c: Category) => void;
  categories?: Category[];
  className?: string;
  size?: 'sm' | 'md';
}

const sizeClasses = {
  sm: 'px-2.5 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
} as const;

/** 类别 chips 行（水平滚动，隐藏滚动条） */
export default function CategoryChipsRow({
  value,
  onChange,
  categories = ALL_CATEGORIES,
  className,
  size = 'md',
}: CategoryChipsRowProps) {
  return (
    <div
      className={clsx(
        'flex gap-2 overflow-x-auto scrollbar-none',
        '[scrollbar-width:none] [-ms-overflow-style:none]',
        '[&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {categories.map((c) => {
        const active = c === value;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={clsx(
              'rounded-full whitespace-nowrap border transition-colors',
              sizeClasses[size],
              active
                ? 'bg-accent text-black border-accent'
                : 'bg-bg-card text-fg-muted border-border hover:border-border-strong hover:text-fg',
            )}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
