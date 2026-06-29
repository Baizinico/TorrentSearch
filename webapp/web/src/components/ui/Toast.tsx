import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import clsx from 'clsx';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toastIcon: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const toastIconColor: Record<ToastType, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-cyan',
};

/** ToastProvider：通过 Context 提供 toast(message, type?) 方法 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      counterRef.current += 1;
      const id = counterRef.current;
      setToasts((list) => [...list, { id, message, type }]);
      window.setTimeout(() => remove(id), 3000);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onClose={remove} />
    </ToastContext.Provider>
  );
}

/** useToast：在 ToastProvider 子树中获取 toast 调用方法 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onClose: (id: number) => void;
}

/** ToastContainer：固定右上角渲染所有 toast */
export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = toastIcon[t.type];
        return (
          <div
            key={t.id}
            className="card px-4 py-3 min-w-[280px] flex items-center gap-3 animate-fade-in"
          >
            <Icon
              size={18}
              strokeWidth={2}
              className={clsx('shrink-0', toastIconColor[t.type])}
            />
            <span className="flex-1 text-sm text-fg">{t.message}</span>
            <button
              type="button"
              onClick={() => onClose(t.id)}
              aria-label="关闭"
              className="text-fg-subtle hover:text-fg transition-colors"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastProvider;
