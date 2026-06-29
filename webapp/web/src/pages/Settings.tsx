/**
 * 设置页 /settings — 分组卡片：外观/通用/搜索/高级/关于
 * 对应 spec §S12.7
 */
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  FileText,
  FlaskConical,
  Github,
  Magnet,
  Monitor,
  Moon,
  Palette,
  Search,
  ServerCog,
  Settings as SettingsIcon,
  Shield,
  Sun,
} from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '../components/ui/Toast';
import { useSettingsStore } from '../stores/settingsStore';
import {
  ALL_CATEGORIES,
  SAFE_CATEGORIES,
  type Category,
  type DarkTheme,
  type SortCriteria,
  type SortOrder,
} from '../types';

export default function Settings() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const s = useSettingsStore();

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">设置</h1>
        <p className="text-sm text-fg-muted mt-1">
          所有设置通过 localStorage 本地保存，不会上传服务器。
        </p>
      </div>

      {/* 外观 */}
      <SettingsSection icon={Palette} title="外观">
        <SettingsRow
          icon={Moon}
          title="主题"
          desc="暗色 / 浅色 / 跟随系统"
        >
          <SegmentedControl<DarkTheme>
            value={s.darkTheme}
            onChange={(v) => s.setDarkTheme(v)}
            options={[
              { value: 'On', label: '暗色', icon: Moon },
              { value: 'Off', label: '浅色', icon: Sun },
              { value: 'FollowSystem', label: '系统', icon: Monitor },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          icon={Eye}
          title="纯黑模式"
          desc="暗色下使用 #000 作为背景（OLED 省电）"
        >
          <Toggle
            checked={s.pureBlack}
            onChange={(v) => s.setPureBlack(v)}
            label="纯黑"
          />
        </SettingsRow>
      </SettingsSection>

      {/* 通用 */}
      <SettingsSection icon={Shield} title="通用">
        <SettingsRow
          icon={Eye}
          title="启用 NSFW 内容"
          desc="显示 Porn 类别和不安全源"
        >
          <Toggle
            checked={s.enableNSFW}
            onChange={(v) => {
              s.setEnableNSFW(v);
              // 关闭 NSFW 时若默认类别是 Porn，回退到 All
              if (!v && s.defaultCategory === 'Porn') {
                s.setDefaultCategory('All');
              }
            }}
            label="NSFW"
          />
        </SettingsRow>
        <SettingsRow
          icon={Eye}
          title="模糊 NSFW 图片"
          desc="详情页海报与截图默认模糊，点击解除"
        >
          <Toggle
            checked={s.blurNSFWImages}
            onChange={(v) => s.setBlurNSFWImages(v)}
            label="模糊"
          />
        </SettingsRow>
      </SettingsSection>

      {/* 搜索 */}
      <SettingsSection icon={Search} title="搜索">
        <SettingsRow
          icon={Search}
          title="默认类别"
          desc="首页与历史复搜使用的默认类别"
        >
          <Select<Category>
            value={s.defaultCategory}
            onChange={(v) => s.setDefaultCategory(v)}
            options={(s.enableNSFW ? ALL_CATEGORIES : SAFE_CATEGORIES).map(
              (c) => ({ value: c, label: c }),
            )}
          />
        </SettingsRow>
        <SettingsRow
          icon={Search}
          title="默认排序"
          desc="搜索结果的默认排序字段与方向"
        >
          <div className="flex gap-2">
            <Select<SortCriteria>
              value={s.sortCriteria}
              onChange={(v) => s.setSortCriteria(v)}
              options={[
                { value: 'Name', label: '名称' },
                { value: 'Seeders', label: '做种数' },
                { value: 'Peers', label: '下载数' },
                { value: 'FileSize', label: '大小' },
                { value: 'Date', label: '日期' },
              ]}
            />
            <Select<SortOrder>
              value={s.sortOrder}
              onChange={(v) => s.setSortOrder(v)}
              options={[
                { value: 'Descending', label: '降序' },
                { value: 'Ascending', label: '升序' },
              ]}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          icon={Search}
          title="最大结果数"
          desc="-1 表示无限，正数限制显示条数"
        >
          <NumberInput
            value={s.maxNumResults}
            onChange={(v) => s.setMaxNumResults(v)}
            min={-1}
            step={50}
          />
        </SettingsRow>
        <SettingsRow
          icon={ServerCog}
          title="Provider 管理"
          desc="启用 / 禁用源，添加 Torznab 索引器"
        >
          <button
            type="button"
            onClick={() => navigate('/settings/providers')}
            className="btn-secondary"
          >
            管理 →
          </button>
        </SettingsRow>
      </SettingsSection>

      {/* 高级 */}
      <SettingsSection icon={FlaskConical} title="高级">
        <SettingsRow
          icon={FileText}
          title="应用内打开详情"
          desc="关闭则在新标签页打开原页面"
        >
          <Toggle
            checked={s.openDetailsInApp}
            onChange={(v) => s.setOpenDetailsInApp(v)}
            label="应用内"
          />
        </SettingsRow>
        <SettingsRow
          icon={Shield}
          title="FlareSolverr URL"
          desc="用于解锁 Cloudflare 保护的源；留空则不使用"
        >
          <TextInput
            value={s.flareSolverrUrl}
            onChange={(v) => s.setFlareSolverrUrl(v)}
            placeholder="http://localhost:8191"
            onBlur={() => toast('FlareSolverr URL 已保存', 'success')}
          />
        </SettingsRow>
      </SettingsSection>

      {/* 关于 */}
      <SettingsSection icon={SettingsIcon} title="关于">
        <SettingsRow icon={Magnet} title="TorrentSearch" desc="Web 版 v1.0.0">
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex items-center gap-2"
          >
            <Github className="w-4 h-4" />
            GitHub
          </a>
        </SettingsRow>
        <SettingsRow
          icon={ServerCog}
          title="自托管"
          desc="34 个内置源 + 任意 Torznab 索引器"
        >
          <span className="text-xs text-fg-subtle font-mono">MIT</span>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

// ==================== 子组件 ====================

function SettingsSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Palette;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 px-5 py-3 border-b border-border bg-bg-subtle">
        <Icon className="w-4 h-4 text-accent" />
        <h2 className="font-display text-sm font-semibold text-fg">{title}</h2>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function SettingsRow({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Palette;
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <Icon className="w-4 h-4 text-fg-subtle shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-fg">{title}</div>
        {desc && <div className="text-xs text-fg-muted mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative w-10 h-6 rounded-full transition-colors shrink-0',
        checked ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: typeof Moon }>;
}) {
  return (
    <div className="flex items-center gap-1 p-1 bg-bg-subtle rounded-btn">
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={clsx(
              'px-3 py-1 rounded text-xs font-medium transition-colors inline-flex items-center gap-1',
              active ? 'bg-accent text-black' : 'text-fg-muted hover:text-fg',
            )}
          >
            {Icon && <Icon className="w-3 h-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="input h-9 py-0 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      step={step}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="input h-9 w-24 py-0 text-sm font-mono"
    />
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className="input h-9 w-56 py-0 text-sm font-mono"
    />
  );
}
