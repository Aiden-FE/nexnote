import { useRef, useState } from 'react';
import type { AiFeatureKey, AiProfileView, ConnectionTestResult } from '@nexnote/shared';
import { invoke } from '../../lib/ipc';
import { useAiConfig, useAiWizard } from './ai-config';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import {
  Bot,
  Check,
  Download,
  KeyRound,
  Loader2,
  MessageSquareText,
  PenLine,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

const FEATURE_LABELS: Array<{ key: AiFeatureKey; label: string; hint: string; icon: typeof Bot }> =
  [
    {
      key: 'writing',
      label: '写作辅助',
      hint: '改写 / 扩写 / 润色',
      icon: PenLine,
    },
    { key: 'chat', label: '对话', hint: '对话与上下文注入', icon: MessageSquareText },
    { key: 'embedding', label: 'Embedding', hint: '向量索引与召回', icon: Bot },
  ];

/**
 * 设置页 · AI 供应商分区：Profile 管理（增删改/默认/测试）、
 * 分功能指定模型与导入导出（不含密钥）。
 */
export function AiSettingsSection() {
  const state = useAiConfig((s) => s.state);
  const apply = useAiConfig((s) => s.apply);
  const showWizard = useAiWizard((s) => s.show);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const profiles = state?.profiles ?? [];

  const testProfile = async (p: AiProfileView) => {
    setBusyId(p.id);
    setNotice(null);
    try {
      const result = await invoke('ai:testConnection', { profileId: p.id });
      setTestResults((prev) => ({ ...prev, [p.id]: result }));
    } catch (e) {
      setNotice(`测试失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const removeProfile = async (p: AiProfileView) => {
    if (!window.confirm(`删除 Profile「${p.name}」？相关分功能指定将被清除。`)) return;
    const { state: next } = await invoke('ai:profile:delete', { id: p.id });
    apply(next);
  };

  const setDefault = async (p: AiProfileView) => {
    const { state: next } = await invoke('ai:profile:setDefault', { id: p.id });
    apply(next);
  };

  const setFeature = async (feature: AiFeatureKey, profileId: string, model: string) => {
    const { state: next } = await invoke('ai:features:set', {
      feature,
      assignment: profileId && model ? { profileId, model } : null,
    });
    apply(next);
  };

  const exportProfiles = async () => {
    const { json, count } = await invoke('ai:export');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexnote-ai-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${count} 个 Profile（不含密钥）。导入后需重新填写 API Key。`);
  };

  const importProfiles = async (file: File) => {
    try {
      const json = await file.text();
      const result = await invoke('ai:import', { json });
      apply(result.state);
      setNotice(
        `导入完成：${result.imported} 个 Profile${result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 个（${result.skipped.join('、')}）` : ''}。密钥需重新填写。`,
      );
    } catch (e) {
      setNotice(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div data-testid="ai-settings" className="space-y-6 text-sm">
      <header className="space-y-1">
        <h3 className="text-base font-medium">AI 供应商</h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="size-3.5" />
          密钥仅保存在本机系统钥匙串（macOS Keychain / Windows 凭据管理器 / Linux
          libsecret），任何页面与导出文件都不含明文。
        </p>
      </header>

      {notice && (
        <div
          data-testid="ai-settings-notice"
          className="flex items-start justify-between gap-2 rounded-md border bg-muted/50 p-2.5 text-xs"
        >
          <span>{notice}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Profile 列表 */}
      <section className="space-y-2" data-testid="ai-profile-list">
        {profiles.length === 0 && (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            还没有 AI Profile。
            <Button
              data-testid="ai-add-profile-empty"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => showWizard()}
            >
              立即配置
            </Button>
          </div>
        )}
        {profiles.map((p) => {
          const test = testResults[p.id];
          const isDefault = state?.defaultProfileId === p.id;
          return (
            <div
              key={p.id}
              data-testid={`ai-profile-card-${p.id.slice(0, 8)}`}
              className="rounded-lg border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {p.kind === 'azure-openai' ? 'Azure' : 'OpenAI 协议'}
                </span>
                {isDefault && (
                  <span
                    data-testid="ai-default-badge"
                    className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                  >
                    <Star className="size-2.5" />
                    默认
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busyId === p.id}
                    onClick={() => void testProfile(p)}
                    data-testid={`ai-test-profile-${p.id.slice(0, 8)}`}
                  >
                    {busyId === p.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    测试
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => showWizard(p.id)}
                    aria-label={`编辑 ${p.name}`}
                  >
                    编辑
                  </Button>
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void setDefault(p)}
                    >
                      设为默认
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => void removeProfile(p)}
                    aria-label={`删除 ${p.name}`}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{p.baseUrl}</span>
                <span>模型 {p.defaultModel}</span>
                <span>{p.hasApiKey ? '🔑 已配置密钥' : '无密钥（本地方服务）'}</span>
              </div>
              {test && (
                <div
                  data-testid={`ai-test-result-${p.id.slice(0, 8)}`}
                  className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"
                >
                  {test.reachable ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <Check className="size-3" /> 连通 · {test.latencyMs}ms
                    </span>
                  ) : (
                    <span className="text-destructive">不可达 · {test.error}</span>
                  )}
                  {(['chat', 'streaming', 'embeddings', 'tools'] as const).map((cap) => (
                    <span
                      key={cap}
                      className={cn(
                        'rounded-full border px-1.5 py-0.5',
                        test.capabilities[cap]
                          ? 'border-green-600/40 text-green-700'
                          : 'text-muted-foreground line-through',
                      )}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="ai-add-profile"
            variant="outline"
            size="sm"
            onClick={() => showWizard()}
          >
            <Plus className="size-3.5" />
            新增 Profile
          </Button>
          <Button
            data-testid="ai-export-profiles"
            variant="outline"
            size="sm"
            disabled={profiles.length === 0}
            onClick={() => void exportProfiles()}
          >
            <Download className="size-3.5" />
            导出
          </Button>
          <Button
            data-testid="ai-import-profiles"
            variant="outline"
            size="sm"
            onClick={() => importRef.current?.click()}
          >
            <Upload className="size-3.5" />
            导入
          </Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="ai-import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importProfiles(f);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      {/* 分功能指定 */}
      <section className="space-y-2.5" data-testid="ai-feature-assignments">
        <h4 className="text-[13px] font-medium">分功能指定模型</h4>
        <p className="text-xs text-muted-foreground">
          未指定时回退到全局默认 Profile；embedding 模型变更会触发向量索引重建标记。
        </p>
        {FEATURE_LABELS.map(({ key, label, hint, icon: Icon }) => {
          const assignment = state?.features[key] ?? null;
          return (
            <div
              key={key}
              data-testid={`ai-feature-${key}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="w-20 shrink-0 text-[13px] font-medium">{label}</span>
              <select
                data-testid={`ai-feature-profile-${key}`}
                value={assignment?.profileId ?? ''}
                onChange={(e) =>
                  void setFeature(
                    key,
                    e.target.value,
                    e.target.value ? assignmentModelHint(state, key, e.target.value) : '',
                  )
                }
                className="h-8 rounded-md border bg-transparent px-2 text-xs"
              >
                <option value="">（跟随默认）</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {assignment && (
                <>
                  <input
                    data-testid={`ai-feature-model-${key}`}
                    value={assignment.model}
                    onChange={(e) => void setFeature(key, assignment.profileId, e.target.value)}
                    placeholder="模型名"
                    className="h-8 w-44 rounded-md border bg-transparent px-2 font-mono text-xs"
                    spellCheck={false}
                  />
                  {key === 'embedding' && assignment.dimensions != null && (
                    <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {assignment.dimensions} 维 · gen {state?.embeddingGeneration}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`清除 ${label} 指定`}
                    onClick={() => void setFeature(key, '', '')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              )}
              <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
                {hint}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** 切换 Profile 时给一个合理的初始模型（该 Profile 的默认模型）。 */
function assignmentModelHint(
  state: ReturnType<typeof useAiConfig.getState>['state'],
  _feature: AiFeatureKey,
  profileId: string,
): string {
  return state?.profiles.find((p) => p.id === profileId)?.defaultModel ?? '';
}
