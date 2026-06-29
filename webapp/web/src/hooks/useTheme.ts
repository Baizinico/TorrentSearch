/**
 * useTheme — 主题切换 Hook
 *
 * - 'On'：强制 dark
 * - 'Off'：强制 light
 * - 'FollowSystem'：跟随系统 prefers-color-scheme
 * - pureBlack：dark 模式下用 #000 主背景
 */

import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

export function useTheme() {
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const pureBlack = useSettingsStore((s) => s.pureBlack);

  useEffect(() => {
    const root = document.documentElement;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark =
        darkTheme === 'On' || (darkTheme === 'FollowSystem' && mql.matches);
      root.classList.toggle('dark', isDark);
      root.classList.toggle('pure-black', isDark && pureBlack);
      root.style.colorScheme = isDark ? 'dark' : 'light';
    };

    apply();
    if (darkTheme === 'FollowSystem') {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
  }, [darkTheme, pureBlack]);

  return { darkTheme, pureBlack };
}
