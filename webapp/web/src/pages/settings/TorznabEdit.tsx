/**
 * Torznab 编辑页 /settings/providers/edit
 * 表单：名称 / URL / apiKey / 类别 + 检测连接 + 保存 / 取消
 * 对应 spec §S12.9
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Loader,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '../../components/ui/Toast';
import { useTorznabStore } from '../../stores/torznabStore';
import { checkTorznab } from '../../lib/api';
import {
  ALL_CATEGORIES,
  SAFE_CATEGORIES,
  type Category,
} from '../../types';
import { useSettingsStore } from '../../stores/settingsStore';

interface CheckState {
  status: 'idle' | 'checking' | 'success' | 'failed';
  message?: string;
}

export default function TorznabEdit() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const editingId = searchParams.get('id');
  const configs = useTorznabStore((s) => s.configs);
  const addConfig = useTorznabStore((s) => s.add);
  const updateConfig = useTorznabStore((s) => s.update);

  const enableNSFW = useSettingsStore((s) => s.enableNSFW);
  const categories = enableNSFW ? ALL_CATEGORIES : SAFE_CATEGORIES;

  // 编辑模式预填
  const editingConfig = editingId
    ? configs.find((c) => c.id === editingId)
    : undefined;

  const [name, setName] = useState(editingConfig?.name ?? '');
  const [url, setUrl] = useState(editingConfig?.url ?? '');
  const [apiKey, setApiKey] = useState(editingConfig?.apiKey ?? '');
  const [category, setCategory] = useState<Category>(
    editingConfig?.category ?? 'All',
  );
  const [checkState, setCheckState] = useState<CheckState>({ status: 'idle' });

  const isEdit = !!editingConfig;

  const canSave = !!(name.trim() && url.trim() && apiKey.trim());

  const handleCheck = async () => {
    if (!url.trim() || !apiKey.trim()) {
      toast('请填写 URL 和 API Key', 'error');
      return;
    }
    setCheckState({ status: 'checking' });
    try {
      const result = await checkTorznab(url.trim(), apiKey.trim());
      if (result.status === 'established') {
        setCheckState({ status: 'success', message: '连接成功' });
        toast('连接正常', 'success');
      } else if (result.status === 'invalid_api_key') {
        setCheckState({ status: 'failed', message: 'API Key 无效' });
        toast('API Key 无效', 'error');
      } else if (result.status === 'connection_failed') {
        setCheckState({ status: 'failed', message: result.message });
        toast('连接失败', 'error');
      } else if (result.status === 'application_error') {
        setCheckState({
          status: 'failed',
          message: `应用错误 (${result.code})`,
        });
        toast(`应用错误: ${result.code}`, 'error');
      } else if (result.status === 'unexpected_response') {
        setCheckState({
          status: 'failed',
          message: `异常响应 (${result.code})`,
        });
        toast(`异常响应: ${result.code}`, 'error');
      } else {
        setCheckState({ status: 'failed', message: result.message });
        toast(result.message, 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCheckState({ status: 'failed', message: msg });
      toast('检测失败', 'error');
    }
  };

  const handleSave = () => {
    if (!canSave) {
      toast('请填写所有必填字段', 'error');
      return;
    }
    const payload = {
      name: name.trim(),
      url: url.trim(),
      apiKey: apiKey.trim(),
      category,
    };
    if (isEdit && editingId) {
      updateConfig(editingId, payload);
      toast('已更新 Torznab 索引器', 'success');
    } else {
      addConfig(payload);
      toast('已添加 Torznab 索引器', 'success');
    }
    navigate('/settings/providers');
  };

  const handleCancel = () => {
    navigate('/settings/providers');
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* 顶部 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleCancel}
          aria-label="返回"
          className="p-2 rounded-btn text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display text-2xl font-bold">
          {isEdit ? '编辑 Torznab' : '添加 Torznab'}
        </h1>
      </div>

      {/* 表单 */}
      <div className="card p-6 space-y-5">
        <FormField label="名称" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：Jackett"
            className="input w-full"
          />
        </FormField>

        <FormField
          label="URL"
          required
          hint="不含 /api 后缀，将自动追加；例如 http://localhost:9117/jackett"
        >
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:9117/jackett"
            className="input w-full font-mono text-sm"
          />
        </FormField>

        <FormField label="API Key" required>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API Key"
            className="input w-full font-mono text-sm"
            autoComplete="off"
          />
        </FormField>

        <FormField label="类别" hint="搜索时使用的默认类别">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="input w-full"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>

        {/* 检测结果 */}
        {checkState.status !== 'idle' && (
          <div
            className={clsx(
              'flex items-center gap-2 text-sm px-3 py-2 rounded-btn border',
              checkState.status === 'checking' &&
                'text-fg-muted bg-bg-subtle border-border',
              checkState.status === 'success' &&
                'text-success bg-success/10 border-success/30',
              checkState.status === 'failed' &&
                'text-danger bg-danger/10 border-danger/30',
            )}
          >
            {checkState.status === 'checking' && (
              <Loader className="w-4 h-4 animate-spin" />
            )}
            {checkState.status === 'success' && (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {checkState.status === 'failed' && <XCircle className="w-4 h-4" />}
            <span>{checkState.message}</span>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleCheck}
            disabled={checkState.status === 'checking' || !url.trim() || !apiKey.trim()}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-accent" />
            {checkState.status === 'checking' ? '检测中...' : '检测连接'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleCancel}
            className="btn-ghost"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {isEdit ? '保存' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-fg mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-fg-muted mt-1">{hint}</p>}
    </div>
  );
}
