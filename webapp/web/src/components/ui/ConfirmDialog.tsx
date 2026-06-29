import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

/** 确认对话框：居中 modal + 半透明遮罩 + AlertTriangle 图标 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 animate-fade-in"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="card w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={22}
            className={clsx(
              'mt-0.5 shrink-0',
              isDanger ? 'text-danger' : 'text-accent',
            )}
            strokeWidth={2}
          />
          <div className="flex-1">
            <h3
              id="confirm-dialog-title"
              className="font-display text-base font-semibold text-fg"
            >
              {title}
            </h3>
            {description ? (
              <p className="mt-1 text-sm text-fg-muted">{description}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={clsx(
              'btn',
              isDanger
                ? 'bg-danger text-black hover:bg-danger/90'
                : 'bg-accent text-black hover:bg-accent-hover',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
