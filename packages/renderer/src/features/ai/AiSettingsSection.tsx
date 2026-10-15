import { useEffect, useRef, useState } from 'react';
import type {
  AiFeatureKey,
  AiProfileView,
  ConnectionTestResult,
  RetrievalIndexStatusPayload,
} from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';
import { useAiConfig, useAiWizard } from './ai-config';
import {
  fetchModelCandidates,
  modelCandidateCacheKey,
  peekModelCandidates,
} from './model-candidates';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { t, useI18n } from '../../lib/i18n';
import {
  Bot,
  Check,
  ChevronDown,
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

const FEATURE_KEYS: Array<{
  key: AiFeatureKey;
  labelKey: string;
  hintKey: string;
  icon: typeof Bot;
}> = [
  {
    key: 'writing',
    labelKey: 'ai.feature.writing.label',
    hintKey: 'ai.feature.writing.hint',
    icon: PenLine,
  },
  {
    key: 'translation',
    labelKey: 'ai.feature.translation.label',
    hintKey: 'ai.feature.translation.hint',
    icon: Bot,
  },
  {
    key: 'chat',
    labelKey: 'ai.feature.chat.label',
    hintKey: 'ai.feature.chat.hint',
    icon: MessageSquareText,
  },
  {
    key: 'embedding',
    labelKey: 'ai.feature.embedding.label',
    hintKey: 'ai.feature.embedding.hint',
    icon: Bot,
  },
];

const CAPABILITY_LABELS: Record<keyof ConnectionTestResult['capabilities'], string> = {
  chat: 'ai.wizard.capability.chat',
  streaming: 'ai.wizard.capability.streaming',
  embeddings: 'ai.wizard.capability.embeddings',
  tools: 'ai.wizard.capability.tools',
};

/**
 * 设置页 · AI 供应商分区：Profile 管理（增删改/默认/测试）、
 * 分功能指定模型与导入导出（不含密钥）。
 */
export function AiSettingsSection() {
  const tr = useI18n();
  const state = useAiConfig((s) => s.state);
  const apply = useAiConfig((s) => s.apply);
  const showWizard = useAiWizard((s) => s.show);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<RetrievalIndexStatusPayload | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => onEvent('ai:retrievalStatus', ({ status }) => setIndexStatus(status)), []);

  const profiles = state?.profiles ?? [];

  const testProfile = async (p: AiProfileView) => {
    setBusyId(p.id);
    setNotice(null);
    try {
      const result = await invoke('ai:testConnection', { profileId: p.id });
      setTestResults((prev) => ({ ...prev, [p.id]: result }));
    } catch (e) {
      setNotice(
        t('ai.settings.testFailed', { message: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setBusyId(null);
    }
  };

  const removeProfile = async (p: AiProfileView) => {
    if (!window.confirm(t('ai.settings.deleteConfirm', { name: p.name }))) return;
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
    setNotice(t('ai.settings.exported', { count }));
  };

  const cancelIndexBuild = async () => {
    try {
      const result = await invoke('ai:cancelRetrievalBuild');
      if (!result.cancelled) setNotice(t('ai.retrievalIndex.notBuilding'));
    } catch (e) {
      setNotice(
        t('ai.retrievalIndex.cancelFailed', {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };

  const importProfiles = async (file: File) => {
    try {
      const json = await file.text();
      const result = await invoke('ai:import', { json });
      apply(result.state);
      setNotice(
        t('ai.settings.imported', {
          imported: result.imported,
          skipped: result.skipped.length
            ? t('ai.settings.importSkipped', {
                count: result.skipped.length,
                items: result.skipped.join(t('ai.settings.importSkippedSeparator')),
              })
            : '',
        }),
      );
    } catch (e) {
      setNotice(
        t('ai.settings.importFailed', { message: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  return (
    <div data-testid="ai-settings" className="space-y-6 text-sm">
      <header className="space-y-1">
        <h3 className="text-base font-medium">{tr('ai.settings.title')}</h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="size-3.5" />
          {tr('ai.settings.keyNotice')}
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
            aria-label={tr('ai.settings.closeNotice')}
            onClick={() => setNotice(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {indexStatus && (
        <section
          data-testid="ai-retrieval-index-status"
          className="space-y-2 rounded-md border p-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{tr('ai.retrievalIndex.title')}</span>
            <span data-testid="ai-retrieval-index-phase">
              {tr(`ai.retrievalIndex.phase.${indexStatus.phase}`)}
            </span>
            {indexStatus.phase === 'building' && (
              <Button
                data-testid="ai-retrieval-index-cancel"
                variant="outline"
                size="sm"
                className="ml-auto h-7 px-2 text-xs"
                onClick={() => void cancelIndexBuild()}
              >
                {tr('ai.retrievalIndex.cancel')}
              </Button>
            )}
          </div>
          {indexStatus.blocksTotal > 0 && (
            <progress
              data-testid="ai-retrieval-index-progress"
              value={indexStatus.blocksDone}
              max={indexStatus.blocksTotal}
              aria-label={tr('ai.retrievalIndex.progress', {
                done: indexStatus.blocksDone,
                total: indexStatus.blocksTotal,
              })}
            />
          )}
          {indexStatus.error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
              {indexStatus.error}
            </div>
          )}
        </section>
      )}

      {/* Profile 列表 */}
      <section className="space-y-2" data-testid="ai-profile-list">
        {profiles.length === 0 && (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {tr('ai.settings.empty')}
            <Button
              data-testid="ai-add-profile-empty"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => showWizard()}
            >
              {tr('ai.settings.configureNow')}
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
                  {p.kind === 'azure-openai' ? 'Azure' : t('ai.profile.kind.openai')}
                </span>
                {isDefault && (
                  <span
                    data-testid="ai-default-badge"
                    className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                  >
                    <Star className="size-2.5" />
                    {tr('ai.settings.default')}
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
                    {tr('ai.settings.test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => showWizard(p.id)}
                    aria-label={tr('ai.settings.editAria', { name: p.name })}
                  >
                    {tr('ai.settings.edit')}
                  </Button>
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void setDefault(p)}
                    >
                      {tr('ai.settings.setAsDefault')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => void removeProfile(p)}
                    aria-label={tr('ai.settings.deleteAria', { name: p.name })}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{p.baseUrl}</span>
                <span>{t('ai.settings.model', { model: p.defaultModel })}</span>
                <span>{p.hasApiKey ? t('ai.profile.hasKey') : t('ai.profile.noKey')}</span>
              </div>
              {test && (
                <div
                  data-testid={`ai-test-result-${p.id.slice(0, 8)}`}
                  className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"
                >
                  {test.reachable ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <Check className="size-3" />{' '}
                      {t('ai.settings.reachable', { latency: test.latencyMs })}
                    </span>
                  ) : (
                    <span className="text-destructive">
                      {t('ai.settings.unreachable', { error: test.error ?? '' })}
                    </span>
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
                      {t(CAPABILITY_LABELS[cap])}
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
            {tr('ai.settings.add')}
          </Button>
          <Button
            data-testid="ai-export-profiles"
            variant="outline"
            size="sm"
            disabled={profiles.length === 0}
            onClick={() => void exportProfiles()}
          >
            <Download className="size-3.5" />
            {tr('ai.settings.export')}
          </Button>
          <Button
            data-testid="ai-import-profiles"
            variant="outline"
            size="sm"
            onClick={() => importRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {tr('ai.settings.import')}
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
        <h4 className="text-[13px] font-medium">{tr('ai.featureAssignments')}</h4>
        <p className="text-xs text-muted-foreground">{tr('ai.featureAssignments.description')}</p>
        {FEATURE_KEYS.map(({ key, labelKey, hintKey, icon: Icon }) => {
          const assignment = state?.features[key] ?? null;
          return (
            <div
              key={key}
              data-testid={`ai-feature-${key}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="w-20 shrink-0 text-[13px] font-medium">{t(labelKey)}</span>
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
                <option value={''}>{tr('ai.feature.followDefault')}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {assignment && (
                <>
                  <ModelPicker
                    feature={key}
                    profileId={assignment.profileId}
                    initialValue={assignment.model}
                    onCommit={(model) => void setFeature(key, assignment.profileId, model)}
                    data-testid={`ai-feature-model-${key}`}
                  />
                  {key === 'embedding' && assignment.dimensions != null && (
                    <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t('ai.assignment.dimensions', {
                        dimensions: assignment.dimensions,
                        generation: state?.embeddingGeneration ?? 0,
                      })}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={t('ai.assignment.clearAria', { label: t(labelKey) })}
                    onClick={() => void setFeature(key, '', '')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              )}
              <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
                {t(hintKey)}
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

/**
 * 分功能指定模型的 Combobox。
 * - 输入框 + 自定义下拉面板（替代 <datalist>，确保所有模型可见可浏览）。
 * - 聚焦或点击下拉箭头时拉取 /models；候选在下拉面板中完整展示，支持输入过滤。
 * - 仅在 blur（值与初始值不同）/ Enter / 候选点选时 commit。
 * - 候选拉取失败时刷新按钮变红并 tooltip 显示错误；仍可自由输入。
 */
function ModelPicker({
  feature,
  profileId,
  initialValue,
  onCommit,
  ...rest
}: {
  feature: AiFeatureKey;
  profileId: string;
  initialValue: string;
  onCommit(model: string): void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const tr = useI18n();
  const profile = useAiConfig((s) => s.state?.profiles.find((p) => p.id === profileId));
  const cacheKey = modelCandidateCacheKey(profileId, profile);

  const [value, setValue] = useState(initialValue);
  const [fetched, setFetched] = useState<{
    cacheKey: string;
    list: string[];
    error: string | null;
  } | null>(null);
  const allCandidates =
    fetched?.cacheKey === cacheKey ? fetched.list : peekModelCandidates(cacheKey);
  const [fetching, setFetching] = useState(false);
  const [open, setOpen] = useState(false);
  // 只有用户主动输入时才过滤候选；初始值（当前已保存的模型名）不作为过滤条件。
  const [userTyped, setUserTyped] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered =
    userTyped && value
      ? allCandidates.filter((c) => c.toLowerCase().includes(value.toLowerCase()))
      : allCandidates;

  const loadCandidates = async (force = false): Promise<void> => {
    setFetching(true);
    try {
      const { models, error } = await fetchModelCandidates(profileId, profile, cacheKey, force);
      setFetched({ cacheKey, list: models, error });
    } finally {
      setFetching(false);
    }
  };

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer, { capture: true });
    return () => document.removeEventListener('mousedown', onPointer, true);
  }, [open]);

  const [committedBaseline, setCommittedBaseline] = useState(initialValue);
  const commit = (next: string): void => {
    if (next === committedBaseline) {
      setValue(committedBaseline);
      return;
    }
    setCommittedBaseline(next);
    onCommit(next);
  };

  const pick = (model: string): void => {
    setValue(model);
    setUserTyped(false);
    setOpen(false);
    commit(model);
    inputRef.current?.blur();
  };

  return (
    <span
      ref={containerRef}
      className="relative inline-flex items-center gap-1"
      data-testid={`ai-model-picker-${feature}-${profileId}`}
    >
      <span className="relative">
        <input
          {...rest}
          ref={(el) => {
            inputRef.current = el;
          }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setUserTyped(true);
          }}
          onFocus={() => {
            setOpen(true);
            setUserTyped(false);
            if (allCandidates.length === 0) void loadCandidates();
          }}
          onBlur={() => {
            // 延迟关闭，让下拉点击先触发
            setTimeout(() => {
              setOpen(false);
              commit(value);
            }, 150);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(value);
              setOpen(false);
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setValue(initialValue);
              setOpen(false);
            }
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              setOpen(true);
              if (allCandidates.length === 0) void loadCandidates();
            }
          }}
          placeholder={tr('ai.model.placeholder')}
          className="h-8 w-52 rounded-md border bg-transparent px-2 pr-7 font-mono text-xs"
          spellCheck={false}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={tr('ai.model.expand')}
          onClick={() => {
            setOpen((prev) => !prev);
            setUserTyped(false);
            if (!open && allCandidates.length === 0) void loadCandidates();
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </span>
      {open && (
        <div
          data-testid={`ai-model-dropdown-${feature}-${profileId}`}
          className="absolute left-0 top-full z-50 mt-1 max-h-60 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {fetching && allCandidates.length === 0 ? (
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> {tr('ai.model.loading')}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {allCandidates.length === 0 ? tr('ai.model.noCandidates') : tr('ai.model.noMatch')}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className={`flex w-full items-center rounded-sm px-2 py-1 text-left text-xs hover:bg-accent ${
                  c === value ? 'bg-accent font-medium' : ''
                }`}
              >
                {c}
              </button>
            ))
          )}
        </div>
      )}
      <button
        type="button"
        aria-label={tr('ai.model.refresh')}
        title={
          fetched?.cacheKey === cacheKey && fetched.error
            ? tr('ai.model.refreshFailed', { error: fetched.error })
            : tr('ai.model.refresh')
        }
        onClick={() => void loadCandidates(true)}
        className={`rounded p-1 hover:bg-accent ${
          fetched?.cacheKey === cacheKey && fetched.error
            ? 'text-destructive'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {fetching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
      </button>
    </span>
  );
}
