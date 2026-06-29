import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import TryAgainButton from './TryAgainButton';

interface ErrorStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

/** 错误态：danger 色图标 + 标题 + 描述 + 可选重试按钮 */
export default function ErrorState({
  icon: Icon,
  title,
  description,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <Icon size={64} strokeWidth={1.5} className="text-danger/60" />
      <h3 className="font-display text-xl font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-fg-muted">{description}</p>
      ) : null}
      {onRetry ? <div className="mt-2">{<TryAgainButton onClick={onRetry} />}</div> : null}
    </div>
  );
}
