/**
 * 首页 / — Hero + 大搜索框 + 类别 chips + 快捷入口
 * 对应 spec §S12.1
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bookmark,
  Compass,
  Magnet,
  Search as SearchIcon,
  ServerCog,
  Sliders,
} from 'lucide-react';
import clsx from 'clsx';
import SearchBar from '../components/search/SearchBar';
import CategoryChipsRow from '../components/search/CategoryChipsRow';
import { useSettingsStore } from '../stores/settingsStore';
import {
  ALL_CATEGORIES,
  SAFE_CATEGORIES,
  type Category,
} from '../types';

interface QuickLink {
  to: string;
  label: string;
  desc: string;
  icon: typeof Bookmark;
}

const QUICK_LINKS: QuickLink[] = [
  { to: '/bookmarks', label: '书签', desc: '我的收藏', icon: Bookmark },
  { to: '/browse', label: '浏览', desc: '最新种子', icon: Compass },
  { to: '/settings', label: '设置', desc: '应用偏好', icon: Sliders },
  { to: '/settings/providers', label: 'Provider 管理', desc: '索引器配置', icon: ServerCog },
];

export default function Home() {
  const navigate = useNavigate();

  const defaultCategory = useSettingsStore((s) => s.defaultCategory);
  const enableNSFW = useSettingsStore((s) => s.enableNSFW);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>(defaultCategory);

  // 安全模式下隐藏 NSFW 类别
  const categories = useMemo(
    () => (enableNSFW ? ALL_CATEGORIES : SAFE_CATEGORIES),
    [enableNSFW],
  );

  // 若当前类别在安全模式下不可见，回退到 All
  const effectiveCategory = categories.includes(category) ? category : 'All';

  const submitSearch = (q: string, cat: Category) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const qs = new URLSearchParams({ q: trimmed, category: cat });
    navigate(`/search?${qs.toString()}`);
  };

  const handleSubmit = () => submitSearch(query, effectiveCategory);

  return (
    <div className="min-h-full">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* 装饰：磁力链 SVG */}
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-end opacity-[0.06] pointer-events-none"
        >
          <Magnet
            className="w-[480px] h-[480px] -mr-32 -mt-24 text-accent"
            strokeWidth={1}
          />
        </div>

        <div className="relative max-w-content mx-auto px-6 pt-20 pb-12 md:pt-28 md:pb-16">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-4 text-accent">
              <Magnet className="w-5 h-5" strokeWidth={2.4} />
              <span className="font-mono text-xs tracking-widest uppercase">
                Self-Hosted · 35 Sources
              </span>
            </div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
              一次查询，<span className="text-accent">全网种子</span>
              <br />
              即搜即得。
            </h1>
            <p className="mt-4 text-fg-muted text-base md:text-lg max-w-xl">
              聚合 34 个内置源与任意 Torznab 索引器，SSE 流式渲染，结果按完成顺序追加。
              书签与设置全部本地保存。
            </p>
          </div>

          {/* 大搜索框 */}
          <div className="relative mt-10 max-w-3xl">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              placeholder="输入关键字，例如 ubuntu、avian 02、spider-man..."
              size="lg"
              autoFocus
            />
            <div className="mt-4">
              <CategoryChipsRow
                value={effectiveCategory}
                onChange={setCategory}
                categories={categories}
                size="md"
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!query.trim()}
                className="btn-primary inline-flex items-center gap-2 px-6 h-11 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <SearchIcon className="w-4 h-4" />
                搜索
              </button>
              <button
                type="button"
                onClick={() => navigate('/browse?tab=latest')}
                className="btn-secondary inline-flex items-center gap-2 px-5 h-11 text-sm"
              >
                <Compass className="w-4 h-4 text-accent" />
                浏览最新
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 主体内容 */}
      <section className="max-w-content mx-auto px-6 pb-16 space-y-10">
        {/* 快捷入口 */}
        <div>
          <h2 className="font-display text-sm font-semibold text-fg-muted uppercase tracking-wider mb-3">
            快捷入口
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <button
                  key={link.to}
                  type="button"
                  onClick={() => navigate(link.to)}
                  className={clsx(
                    'card card-hover p-4 flex flex-col items-start gap-3 text-left',
                    'group transition-colors',
                  )}
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-btn bg-accent/10 text-accent group-hover:bg-accent group-hover:text-black transition-colors">
                    <Icon className="w-5 h-5" strokeWidth={2.2} />
                  </div>
                  <div>
                    <div className="font-display text-sm font-semibold text-fg">
                      {link.label}
                    </div>
                    <div className="text-xs text-fg-muted mt-0.5">
                      {link.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 特性卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FeatureCard
            title="流式搜索"
            desc="每个 provider 完成即推送，无需等待全部源返回。"
          />
          <FeatureCard
            title="Cloudflare 解锁"
            desc="通过 FlareSolverr 适配受 CF 保护的源。"
          />
          <FeatureCard
            title="Torznab 兼容"
            desc="添加任意 Jackett / Prowlarr 索引器扩展能力。"
          />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="card p-5">
      <h3 className="font-display text-base font-semibold text-fg mb-1">
        {title}
      </h3>
      <p className="text-sm text-fg-muted leading-relaxed">{desc}</p>
    </div>
  );
}
