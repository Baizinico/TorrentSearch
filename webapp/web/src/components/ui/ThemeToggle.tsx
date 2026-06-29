import { Sun, Moon, Monitor } from 'lucide-react';
import clsx from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DarkTheme } from '../../types';

interface ThemeToggleProps {
  className?: string;
}

const options: Array<{ value: DarkTheme; label: string; icon: typeof Sun }> = [
  { value: 'On', label: '暗色', icon: Moon },
  { value: 'Off', label: '亮色', icon: Sun },
  { value: 'FollowSystem', label: '系统', icon: Monitor },
];

/** 主题切换：3 态紧凑按钮组 On / Off / FollowSystem */
export default function ThemeToggle({ className }: ThemeToggleProps) {
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const setDarkTheme = useSettingsStore((s) => s.setDarkTheme);

  return (
    <div
      role="group"
      aria-label="主题切换"
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-btn border border-border bg-bg-subtle p-0.5',
        className,
      )}
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = darkTheme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setDarkTheme(value)}
            aria-pressed={active}
            className={clsx(
              'flex items-center gap-1.5 rounded-input px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-accent text-black'
                : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
            )}
          >
            <Icon size={14} strokeWidth={2} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
