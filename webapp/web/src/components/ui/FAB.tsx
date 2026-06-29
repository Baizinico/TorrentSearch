import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface FABProps {
  icon: LucideIcon;
  onClick: () => void;
  label: string;
  className?: string;
}

/** 浮动操作按钮：固定右下角的圆形主操作按钮 */
export default function FAB({
  icon: Icon,
  onClick,
  label,
  className,
}: FABProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        'fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center',
        'rounded-full bg-accent text-black shadow-lg shadow-accent/20',
        'transition-transform duration-150 hover:scale-105 active:scale-95',
        'animate-fade-in focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-accent focus-visible:ring-offset-2',
        'focus-visible:ring-offset-bg-base',
        className,
      )}
    >
      <Icon size={24} strokeWidth={2.25} />
    </button>
  );
}
