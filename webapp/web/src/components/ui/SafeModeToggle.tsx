import { Shield } from 'lucide-react';
import clsx from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';

interface SafeModeToggleProps {
  className?: string;
}

/**
 * 安全模式开关：safeMode = !enableNSFW。
 * 开启（safe）时滑块在右侧、track 为 accent；
 * 关闭（nsfw 暴露）时滑块在左侧、track 为 nsfw 色。
 */
export default function SafeModeToggle({ className }: SafeModeToggleProps) {
  const enableNSFW = useSettingsStore((s) => s.enableNSFW);
  const setEnableNSFW = useSettingsStore((s) => s.setEnableNSFW);

  const safeMode = !enableNSFW;

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <Shield
        size={16}
        strokeWidth={2}
        className={clsx(safeMode ? 'text-accent' : 'text-nsfw')}
      />
      <span className="text-sm text-fg">安全模式</span>
      <button
        type="button"
        role="switch"
        aria-checked={safeMode}
        aria-label="安全模式"
        onClick={() => setEnableNSFW(!enableNSFW)}
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
          safeMode ? 'bg-accent' : 'bg-nsfw/60',
        )}
      >
        <span
          className={clsx(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            safeMode ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
