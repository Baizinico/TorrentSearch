import { NavLink, Outlet } from 'react-router-dom';
import { Home, Search, Compass, Star, Settings, Magnet } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../hooks/useTheme';
import { useProviders } from '../hooks/useProviders';
import ThemeToggle from '../components/ui/ThemeToggle';
import SafeModeToggle from '../components/ui/SafeModeToggle';

const navItems = [
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/browse', label: '浏览', icon: Compass },
  { to: '/bookmarks', label: '书签', icon: Star },
  { to: '/settings', label: '设置', icon: Settings },
];

export default function RootLayout() {
  // 应用主题（dark/pure-black class 切换）
  useTheme();
  // 顶层预加载 providers 并初始化 enabledProviderIds
  useProviders();

  return (
    <div className="min-h-screen flex">
      {/* 左侧导航 - 桌面端 */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-bg-card">
        <div className="px-5 py-6 flex items-center gap-2">
          <Magnet className="w-6 h-6 text-accent" strokeWidth={2.2} />
          <div className="font-display font-bold text-lg tracking-tight">
            Torrent<span className="text-accent">Search</span>
          </div>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-btn text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:text-fg hover:bg-bg-hover',
                )
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 space-y-3 border-t border-border">
          <ThemeToggle />
          <SafeModeToggle />
          <div className="text-xs text-fg-subtle">
            <div className="font-mono">v1.0.0</div>
            <div className="mt-1">自托管 · 30+ 源</div>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* 移动端顶栏 */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-bg-card sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <Magnet className="w-5 h-5 text-accent" />
            <span className="font-display font-bold">
              Torrent<span className="text-accent">Search</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SafeModeToggle />
          </div>
        </div>

        {/* 页面内容 */}
        <div className="flex-1 pb-16 md:pb-0">
          <Outlet />
        </div>

        {/* 移动端底部导航 */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 flex border-t border-border bg-bg-card z-20">
          {navItems.slice(0, 5).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px]',
                  isActive ? 'text-accent' : 'text-fg-muted',
                )
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </main>
    </div>
  );
}
