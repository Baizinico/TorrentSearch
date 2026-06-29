import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** 空态：垂直居中，accent 半透明图标 + 标题 + 描述 + 可选操作 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <Icon size={64} strokeWidth={1.5} className="text-accent/40" />
      <h3 className="font-display text-xl font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
