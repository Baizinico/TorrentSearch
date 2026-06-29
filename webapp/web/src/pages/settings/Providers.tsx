/**
 * Provider 管理页 /settings/providers
 * 列表：name + url + 类别 badges + 类型 + 安全标记 + 启用开关
 * Unsafe: 点击弹对话框显示原因
 * CF: 显示锁定状态 + 解锁按钮
 * Torznab: 行内菜单（编辑/删除/检测连接）
 * 顶部"添加 Torznab"按钮
 * 对应 spec §S12.8
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  ServerCog,
  ShieldCheck,
  Trash2,
  Unlock,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DropdownMenu from '../../components/ui/DropdownMenu';
import EmptyState from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { useProviders } from '../../hooks/useProviders';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTorznabStore } from '../../stores/torznabStore';
import { checkTorznab } from '../../lib/api';
import type { ProviderInfo } from '../../types';

interface UnsafeDialogState {
  open: boolean;
  provider: ProviderInfo | null;
}

interface CheckState {
  status: 'idle' | 'checking' | 'success' | 'failed';
  message?: string;
}

export default function Providers() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const { providers, isLoading } = useProviders();
  const enabledProviderIds = useSettingsStore((s) => s.enabledProviderIds);
  const toggleProvider = useSettingsStore((s) => s.toggleProvider);
  const unlockedProviderIds = useSettingsStore((s) => s.unlockedProviderIds);
  const unlockProvider = useSettingsStore((s) => s.unlockProvider);
  const flareSolverrUrl = useSettingsStore((s) => s.flareSolverrUrl);

  const torznabConfigs = useTorznabStore((s) => s.configs);
  const removeTorznab = useTorznabStore((s) => s.remove);

  const [unsafeDialog, setUnsafeDialog] = useState<UnsafeDialogState>({
    open: false,
    provider: null,
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [checkStates, setCheckStates] = useState<Record<string, CheckState>>({});

  // 当前启用集合
  const enabledSet = useMemo(
    () => new Set(enabledProviderIds),
    [enabledProviderIds],
  );

  const unlockedSet = useMemo(
    () => new Set(unlockedProviderIds),
    [unlockedProviderIds],
  );

  const handleUnlock = (p: ProviderInfo) => {
    if (!flareSolverrUrl) {
      toast('请先在设置中配置 FlareSolverr URL', 'error');
      return;
    }
    // 实际解锁由后端搜索时通过 cloudflareUnlocked 传入；这里仅做标记
    unlockProvider(p.id);
    toast(`已标记 ${p.name} 为已解锁`, 'success');
  };

  const handleCheckTorznab = async (id: string, url: string, apiKey: string) => {
    setCheckStates((s) => ({
      ...s,
      [id]: { status: 'checking' },
    }));
    try {
      const result = await checkTorznab(url, apiKey);
      if (result.status === 'established') {
        setCheckStates((s) => ({
          ...s,
          [id]: { status: 'success', message: '连接成功' },
        }));
        toast('连接正常', 'success');
      } else if (result.status === 'invalid_api_key') {
        setCheckStates((s) => ({
          ...s,
          [id]: { status: 'failed', message: 'API Key 无效' },
        }));
        toast('API Key 无效', 'error');
      } else if (result.status === 'connection_failed') {
        setCheckStates((s) => ({
          ...s,
          [id]: { status: 'failed', message: result.message },
        }));
        toast('连接失败', 'error');
      } else if (result.status === 'application_error') {
        setCheckStates((s) => ({
          ...s,
          [id]: { status: 'failed', message: `应用错误 (${result.code})` },
        }));
        toast(`应用错误: ${result.code}`, 'error');
      } else if (result.status === 'unexpected_response') {
        setCheckStates((s) => ({
          ...s,
          [id]: { status: 'failed', message: `异常响应 (${result.code})` },
        }));
        toast(`异常响应: ${result.code}`, 'error');
      } else {
        setCheckStates((s) => ({
          ...s,
          [id]: { status: 'failed', message: result.message },
        }));
        toast(result.message, 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCheckStates((s) => ({
        ...s,
        [id]: { status: 'failed', message: msg },
      }));
      toast('检测失败', 'error');
    }
  };

  return (
    <div className="max-w-content mx-auto px-4 py-6 pb-24">
      {/* 顶部 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate('/settings')}
          aria-label="返回"
          className="p-2 rounded-btn text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold">Provider 管理</h1>
          <p className="text-sm text-fg-muted mt-1">
            共 {providers.length + torznabConfigs.length} 个源 ·{' '}
            {enabledSet.size + torznabConfigs.length} 个已启用
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings/providers/edit')}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          添加 Torznab
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader className="w-5 h-5 animate-spin text-accent" />
        </div>
      ) : providers.length === 0 && torznabConfigs.length === 0 ? (
        <EmptyState
          icon={ServerCog}
          title="没有可用 Provider"
          description="请检查后端服务是否正常启动。"
        />
      ) : (
        <div className="space-y-6">
          {/* 内置 Provider */}
          {providers.length > 0 && (
            <section>
              <h2 className="font-display text-sm font-semibold text-fg-muted uppercase tracking-wider mb-3">
                内置源 ({providers.length})
              </h2>
              <div className="card divide-y divide-border overflow-hidden">
                {providers.map((p) => (
                  <ProviderRow
                    key={p.id}
                    provider={p}
                    enabled={enabledSet.has(p.id)}
                    unlocked={unlockedSet.has(p.id)}
                    flareSolverrConfigured={!!flareSolverrUrl}
                    onToggle={() => toggleProvider(p.id)}
                    onUnlock={() => handleUnlock(p)}
                    onShowUnsafe={() =>
                      setUnsafeDialog({ open: true, provider: p })
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* Torznab Provider */}
          {torznabConfigs.length > 0 && (
            <section>
              <h2 className="font-display text-sm font-semibold text-fg-muted uppercase tracking-wider mb-3">
                Torznab 索引器 ({torznabConfigs.length})
              </h2>
              <div className="card divide-y divide-border overflow-hidden">
                {torznabConfigs.map((c) => {
                  const state = checkStates[c.id] ?? { status: 'idle' };
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-4 px-5 py-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-fg truncate">
                            {c.name}
                          </span>
                          <Badge variant="cyan">Torznab</Badge>
                          <Badge variant="default">{c.category}</Badge>
                        </div>
                        <div className="text-xs text-fg-muted mt-1 truncate font-mono">
                          {c.url}
                        </div>
                        {state.status !== 'idle' && (
                          <div
                            className={clsx(
                              'text-xs mt-1 inline-flex items-center gap-1',
                              state.status === 'checking' && 'text-fg-muted',
                              state.status === 'success' && 'text-success',
                              state.status === 'failed' && 'text-danger',
                            )}
                          >
                            {state.status === 'checking' && (
                              <Loader className="w-3 h-3 animate-spin" />
                            )}
                            {state.status === 'success' && (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            {state.status === 'failed' && (
                              <XCircle className="w-3 h-3" />
                            )}
                            {state.message ?? ''}
                          </div>
                        )}
                      </div>
                      <DropdownMenu
                        trigger={
                          <span className="p-2 rounded-btn text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors">
                            <MoreVertical className="w-4 h-4" />
                          </span>
                        }
                        items={[
                          {
                            label: '检测连接',
                            icon: ShieldCheck,
                            onClick: () =>
                              handleCheckTorznab(c.id, c.url, c.apiKey),
                          },
                          {
                            label: '编辑',
                            icon: Pencil,
                            onClick: () =>
                              navigate(
                                `/settings/providers/edit?id=${encodeURIComponent(c.id)}`,
                              ),
                          },
                          { label: '', separator: true },
                          {
                            label: '删除',
                            icon: Trash2,
                            danger: true,
                            onClick: () => setConfirmDelete(c.id),
                          },
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Unsafe 原因对话框 */}
      <ConfirmDialog
        open={unsafeDialog.open}
        title={unsafeDialog.provider?.name ?? ''}
        description={unsafeDialog.provider?.unsafeReason}
        confirmLabel="知道了"
        cancelLabel="关闭"
        variant="default"
        onConfirm={() =>
          setUnsafeDialog({ open: false, provider: null })
        }
        onCancel={() => setUnsafeDialog({ open: false, provider: null })}
      />

      {/* 删除 Torznab 确认 */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="删除该 Torznab 索引器？"
        description="此操作不可撤销。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={() => {
          if (confirmDelete) {
            removeTorznab(confirmDelete);
            toast('已删除', 'info');
          }
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ProviderRow({
  provider,
  enabled,
  unlocked,
  flareSolverrConfigured,
  onToggle,
  onUnlock,
  onShowUnsafe,
}: {
  provider: ProviderInfo;
  enabled: boolean;
  unlocked: boolean;
  flareSolverrConfigured: boolean;
  onToggle: () => void;
  onUnlock: () => void;
  onShowUnsafe: () => void;
}) {
  const safe = provider.safetyStatus === 'Safe';
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-fg truncate">
            {provider.name}
          </span>
          <button
            type="button"
            onClick={onShowUnsafe}
            title={safe ? '安全源' : provider.unsafeReason}
          >
            <Badge variant={safe ? 'success' : 'danger'}>
              {safe ? (
                <ShieldCheck className="w-3 h-3" />
              ) : (
                <AlertTriangle className="w-3 h-3" />
              )}
              {safe ? '安全' : '不安全'}
            </Badge>
          </button>
          {provider.type === 'Torznab' && (
            <Badge variant="cyan">Torznab</Badge>
          )}
          {provider.cloudflareProtected && (
            <Badge variant="accent">
              {unlocked ? (
                <Unlock className="w-3 h-3" />
              ) : (
                <Lock className="w-3 h-3" />
              )}
              CF
            </Badge>
          )}
        </div>
        <div className="text-xs text-fg-muted mt-1 truncate font-mono">
          {provider.url}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {provider.supportedCategories.map((c) => (
            <Badge key={c} variant="default">
              {c}
            </Badge>
          ))}
        </div>
      </div>

      {/* CF 解锁按钮 */}
      {provider.cloudflareProtected && !unlocked && (
        <button
          type="button"
          onClick={onUnlock}
          disabled={!flareSolverrConfigured}
          title={
            flareSolverrConfigured
              ? '标记为已解锁（通过 FlareSolverr）'
              : '请先在设置中配置 FlareSolverr URL'
          }
          className="btn-secondary px-3 h-9 inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
        >
          <Unlock className="w-3.5 h-3.5 text-accent" />
          解锁
        </button>
      )}

      {/* 启用开关 */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`切换 ${provider.name}`}
        onClick={onToggle}
        className={clsx(
          'relative w-10 h-6 rounded-full transition-colors shrink-0',
          enabled ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
            enabled && 'translate-x-4',
          )}
        />
      </button>
    </div>
  );
}
