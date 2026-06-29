/**
 * 搜索输入框 —— 含搜索图标、清除按钮，Enter 提交。
 */
import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import clsx from 'clsx';

export interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  size?: 'sm' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-10 text-sm',
  lg: 'h-14 text-lg',
} as const;

const iconSizeClasses = {
  sm: 'w-4 h-4',
  lg: 'w-5 h-5',
} as const;

/** 搜索框（带左侧 Search 图标和右侧清除按钮） */
export default function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = '搜索种子...',
  autoFocus = false,
  size = 'sm',
  className,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={clsx('relative flex items-center', className)}
    >
      <Search
        className={clsx(
          'absolute left-3 text-accent pointer-events-none',
          iconSizeClasses[size],
        )}
        strokeWidth={2.2}
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(
          'input w-full pl-10 pr-9 font-sans',
          sizeClasses[size],
        )}
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清除"
          className="absolute right-2 p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors"
        >
          <X className={iconSizeClasses[size]} />
        </button>
      )}
    </form>
  );
}
