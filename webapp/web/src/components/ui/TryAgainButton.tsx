import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';

interface TryAgainButtonProps {
  onClick: () => void;
  label?: string;
  loading?: boolean;
  className?: string;
}

/** 重试按钮：.btn-secondary + RefreshCw 图标，loading 时旋转 */
export default function TryAgainButton({
  onClick,
  label = '重试',
  loading = false,
  className,
}: TryAgainButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={clsx('btn-secondary', className)}
    >
      <RefreshCw
        size={16}
        className={clsx(loading && 'animate-spin')}
        strokeWidth={2}
      />
      <span>{label}</span>
    </button>
  );
}
