import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiProviderKind, ConnectionTestResult } from '@nexnote/shared';
import { invoke } from '../../lib/ipc';
import { useAiConfig, useAiWizard } from './ai-config';
import { openSettings } from '../../lib/open-settings';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Cloud,
  CloudCog,
  Loader2,
  RefreshCw,
  Server,
  X,
} from 'lucide-react';
import { t, useI18n } from '../../lib/i18n';

/** provider 预设：向导第一步的选择项。 */
const PROVIDER_PRESETS: Array<{
  id: string;
  titleKey: string;
  descKey: string;
  kind: AiProviderKind;
  baseUrl: string;
  icon: typeof Cloud;
}> = [
  {
    id: 'openai',
    titleKey: 'ai.wizard.presets.openai.title',
    descKey: 'ai.wizard.presets.openai.description',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    icon: Cloud,
  },
  {
    id: 'azure',
    titleKey: 'ai.wizard.presets.azure.title',
    descKey: 'ai.wizard.presets.azure.description',
    kind: 'azure-openai',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com',
    icon: CloudCog,
  },
  {
    id: 'ollama',
    titleKey: 'ai.wizard.presets.ollama.title',
    descKey: 'ai.wizard.presets.ollama.description',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    icon: Server,
  },
  {
    id: 'compatible',
    titleKey: 'ai.wizard.presets.compatible.title',
    descKey: 'ai.wizard.presets.compatible.description',
    kind: 'openai-compatible',
    baseUrl: '',
    icon: Bot,
  },
  {
    id: 'local-embedding',
    titleKey: 'ai.wizard.presets.localEmbedding.title',
    descKey: 'ai.wizard.presets.localEmbedding.description',
    kind: 'local-embedding',
    baseUrl: 'local://embedding',
    icon: Server,
  },
];

type Step = 'provider' | 'connection' | 'test' | 'model';

const CAPABILITY_KEYS: Array<{ key: keyof ConnectionTestResult['capabilities']; keyName: string }> =
  [
    { key: 'chat', keyName: 'ai.wizard.capability.chat' },
    { key: 'streaming', keyName: 'ai.wizard.capability.streaming' },
    { key: 'embeddings', keyName: 'ai.wizard.capability.embeddings' },
    { key: 'tools', keyName: 'ai.wizard.capability.tools' },
  ];

/**
 * AI 供应商配置向导：首启动自动弹一次（此后入口一律跳设置页）+ 设置页可重播/编辑 Profile。
 * 步骤：选 provider → 填 base-url/key → 测连通 → 选默认模型 → 完成。
 */
export function AiSetupWizard() {
  const { open, editProfileId, close } = useAiWizard();
  if (!open) return null;
  return <WizardBody key={editProfileId ?? 'new'} editProfileId={editProfileId} onClose={close} />;
}

function WizardBody({
  editProfileId,
  onClose,
}: {
  editProfileId: string | null;
  onClose: () => void;
}) {
  const tr = useI18n();
  const editing = useAiConfig((s) => s.state?.profiles.find((p) => p.id === editProfileId) ?? null);
  const apply = useAiConfig((s) => s.apply);

  const [step, setStep] = useState<Step>(editing ? 'connection' : 'provider');
  const [presetId, setPresetId] = useState('openai');
  const [name, setName] = useState(editing?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? '');
  const [kind, setKind] = useState<AiProviderKind>(editing?.kind ?? 'openai-compatible');
  // Credential material stays only in the password input DOM node until a single IPC submission.
  // Never put it in React/Zustand state, signatures, logs, or a renderer-visible config type.
  const credentialTokenRef = useRef<string | undefined>(undefined);
  const apiKeyInput = () =>
    document.querySelector<HTMLInputElement>('[data-testid="ai-wizard-apikey"]');
  const [, setCredentialRevision] = useState(0);
  const [model, setModel] = useState(editing?.defaultModel ?? '');
  const [temperature, setTemperature] = useState(
    editing?.params.temperature === undefined ? '' : String(editing.params.temperature),
  );
  const [maxTokens, setMaxTokens] = useState(
    editing?.params.maxTokens === undefined ? '' : String(editing.params.maxTokens),
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const preset = useMemo(() => PROVIDER_PRESETS.find((p) => p.id === presetId)!, [presetId]);
  const isEdit = !!editing;

  /** 任何影响连接的输入变化都使既有测试结果失效（必须重测）。 */
  const invalidateTest = useCallback(() => {
    setTestResult(null);
    setTestError(null);
    setModels([]);
  }, []);

  const pickPreset = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setKind(p.kind);
    if (!isEdit) {
      setBaseUrl(p.baseUrl);
      if (!name) setName(t(p.titleKey));
      if (id === 'local-embedding') setModel('local-hash-384');
    }
    invalidateTest();
    setStep('connection');
  };

  const submitCredential = useCallback(async () => {
    const input = apiKeyInput();
    const secret = input?.value.trim();
    if (!secret) return;
    const credential = await invoke('ai:credential:submit', { secret, baseUrl: baseUrl.trim() });
    credentialTokenRef.current = credential.credentialToken;
    if (input) input.value = '';
  }, [baseUrl]);

  const leaveConnection = useCallback(async () => {
    try {
      await submitCredential();
      setStep('test');
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    }
  }, [submitCredential]);

  const runTest = useCallback(
    async (silent = false) => {
      if (!silent) setTesting(true);
      setTestError(null);
      try {
        await submitCredential();
        const target = {
          // 编辑场景同时传 profileId + candidate：主进程可复用已存密钥，
          // 但网络请求必须按当前候选 kind/baseUrl/defaultModel 实测。
          ...(editing && { profileId: editing.id }),
          candidate: {
            kind,
            baseUrl,
            credentialToken: credentialTokenRef.current,
            // Azure 无模型列表权限很常见，首次配置时 deployment 名也必须用于探测。
            defaultModel: model.trim() || editing?.defaultModel || undefined,
          },
        };
        const result = await invoke('ai:testConnection', target);
        setTestResult(result);
        setModels(result.models);
        if (!silent && result.models.length > 0 && !result.models.includes(model)) {
          setModel(
            result.models.find((m) => !m.toLowerCase().includes('embed')) ?? result.models[0]!,
          );
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setTestError(msg);
        setTestResult(null);
        return null;
      } finally {
        setTesting(false);
      }
    },
    [baseUrl, editing, kind, model, submitCredential],
  );

  const finish = async () => {
    setSaving(true);
    // Always preflight the exact selected target immediately before saving. This also permits
    // choosing a model after discovery without ever silently saving a different target.
    const finalTest = await runTest(true);
    if (!finalTest?.reachable) {
      setSaving(false);
      setSaveError(t('ai.wizard.finalTestFailed'));
      setStep('test');
      return;
    }
    setSaveError(null);
    try {
      const saved = await invoke('ai:profile:save', {
        id: editing?.id,
        profile: {
          name: name.trim(),
          kind,
          baseUrl: baseUrl.trim(),
          defaultModel: model.trim(),
          params: {
            ...(temperature.trim() !== '' && { temperature: Number(temperature) }),
            ...(maxTokens.trim() !== '' && { maxTokens: Number(maxTokens) }),
          },
          ...(credentialTokenRef.current
            ? { credentialToken: credentialTokenRef.current }
            : editing
              ? {}
              : { clearCredential: true }),
        },
      });
      // 新建首个 Profile：自动设默认 + 分功能智能填充
      if (!editing) {
        // An embedding-only profile must not become the chat/default profile. It is assigned only
        // to embedding; existing default/chat assignments remain untouched.
        if (kind !== 'local-embedding') {
          await invoke('ai:profile:setDefault', { id: saved.id }).catch(() => undefined);
          const chatModel =
            saved.state.profiles.find((p) => p.id === saved.id)?.defaultModel ?? model;
          await invoke('ai:features:set', {
            feature: 'chat',
            assignment: { profileId: saved.id, model: chatModel },
          }).catch(() => undefined);
        }
        const embedModel =
          kind === 'local-embedding'
            ? 'local-hash-384'
            : models.find((m) => m.toLowerCase().includes('embed'));
        if (embedModel) {
          await invoke('ai:features:set', {
            feature: 'embedding',
            assignment: { profileId: saved.id, model: embedModel },
          }).catch(() => undefined);
        }
      }
      const input = apiKeyInput();
      if (input) input.value = '';
      const finalState = await invoke('ai:getState');
      apply(finalState);
      onClose();
      // 配置完成统一落点：设置页「AI 供应商」分区（DEV-026 收口）。
      openSettings('ai');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    // 编辑模式预填后静默探测既有 Profile（延迟一拍避免 effect 内同步 setState）
    if (!isEdit) return;
    const t = setTimeout(() => void runTest(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps: Array<{ id: Step; label: string }> = [
    { id: 'provider', label: tr('ai.wizard.steps.provider') },
    { id: 'connection', label: tr('ai.wizard.steps.connection') },
    { id: 'test', label: tr('ai.wizard.steps.test') },
    { id: 'model', label: tr('ai.wizard.steps.model') },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);
  const canNext =
    step === 'connection'
      ? name.trim().length > 0 &&
        (/^https?:\/\//i.test(baseUrl.trim()) || kind === 'local-embedding') &&
        (kind !== 'azure-openai' || model.trim().length > 0)
      : step === 'test'
        ? !!testResult?.reachable
        : step === 'model'
          ? model.trim().length > 0
          : true;

  return (
    <div
      data-testid="ai-wizard"
      role="dialog"
      aria-modal="true"
      aria-label={tr('ai.wizard.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center gap-2 border-b px-5 py-3.5">
          <Bot className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">
            {isEdit ? tr('ai.wizard.editTitle') : tr('ai.wizard.newTitle')}
          </h2>
          <button
            type="button"
            aria-label={tr('ai.wizard.close')}
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 步骤指示 */}
        <div className="flex items-center gap-1 px-5 pt-3.5 text-[11px] text-muted-foreground">
          {steps.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1">
              {i > 0 && <span className={cn(i <= stepIndex ? 'text-foreground' : '')}>·</span>}
              <span
                data-testid={`ai-wizard-step-${s.id}`}
                className={cn(
                  i === stepIndex && 'font-medium text-foreground',
                  i < stepIndex && 'text-foreground/70',
                )}
              >
                {i < stepIndex ? <Check className="inline size-3" /> : null}
                {s.label}
              </span>
            </span>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm">
          {step === 'provider' && (
            <div data-testid="ai-wizard-provider" className="space-y-2">
              <p className="mb-3 text-muted-foreground">
                {tr('ai.wizard.providerDescription')}
              </p>
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`ai-wizard-preset-${p.id}`}
                  onClick={() => pickPreset(p.id)}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
                >
                  <p.icon className="mt-0.5 size-4.5 shrink-0 text-primary" />
                  <span>
                    <span className="block font-medium">{t(p.titleKey)}</span>
                    <span className="block text-xs text-muted-foreground">{t(p.descKey)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'connection' && (
            <div data-testid="ai-wizard-connection" className="space-y-3.5">
              {!isEdit && (
                <p className="text-xs text-muted-foreground">
                  {tr('ai.wizard.currentPreset')}
                  <span className="font-medium text-foreground">{t(preset.titleKey)}</span>
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => setStep('provider')}
                  >
                    {tr('ai.wizard.reselect')}
                  </button>
                </p>
              )}
              <Field label={tr('ai.wizard.nameLabel')}>
                <Input
                  data-testid="ai-wizard-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tr('ai.wizard.namePlaceholder')}
                />
              </Field>
              <Field
                label={tr('ai.wizard.baseUrlLabel')}
                hint={
                  kind === 'azure-openai'
                    ? tr('ai.wizard.baseUrl.azureHint')
                    : tr('ai.wizard.baseUrl.hint')
                }
              >
                <Input
                  data-testid="ai-wizard-baseurl"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    invalidateTest();
                  }}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                />
              </Field>
              {kind === 'azure-openai' && (
                <Field
                  label={tr('ai.wizard.deploymentLabel')}
                  hint={tr('ai.wizard.deploymentHint')}
                >
                  <Input
                    data-testid="ai-wizard-azure-deployment"
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      invalidateTest();
                    }}
                    placeholder={tr('ai.wizard.deploymentPlaceholder')}
                    spellCheck={false}
                  />
                </Field>
              )}
              <Field
                label={tr('ai.wizard.apiKeyLabel')}
                hint={
                  editing
                    ? tr('ai.wizard.apiKey.editHint')
                    : kind === 'local-embedding'
                      ? tr('ai.wizard.apiKey.localEmbeddingHint')
                      : kind === 'openai-compatible' && presetId === 'ollama'
                        ? tr('ai.wizard.apiKey.ollamaHint')
                        : tr('ai.wizard.apiKey.hint')
                }
              >
                <Input
                  data-testid="ai-wizard-apikey"
                  type="password"
                  defaultValue=""
                  onChange={() => {
                    setCredentialRevision((revision) => revision + 1);
                    invalidateTest();
                  }}
                  placeholder={editing?.hasApiKey ? tr('ai.wizard.apiKey.savedPlaceholder') : 'sk-…'}
                  autoComplete="off"
                />
              </Field>
            </div>
          )}

          {step === 'test' && (
            <div data-testid="ai-wizard-test" className="space-y-3">
              <p className="text-muted-foreground">
                {tr('ai.wizard.testDescription')}
              </p>
              <Button
                data-testid="ai-wizard-test-btn"
                variant="outline"
                size="sm"
                disabled={testing}
                onClick={() => void runTest()}
              >
                {testing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {testing
                  ? tr('ai.wizard.testing')
                  : testResult
                    ? tr('ai.wizard.testRetest')
                    : tr('ai.wizard.testNow')}
              </Button>

              {testError && (
                <div
                  data-testid="ai-wizard-test-error"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  {testError}
                  <p className="mt-1 opacity-80">{tr('ai.wizard.testRetryHint')}</p>
                </div>
              )}

              {testResult && (
                <div
                  data-testid="ai-wizard-test-result"
                  className="space-y-2 rounded-md border p-3 text-xs"
                >
                  <div className="flex items-center gap-2 font-medium">
                    {testResult.reachable ? (
                      <>
                        <Check className="size-4 text-green-600" />{' '}
                        {tr('ai.wizard.connected', { latency: testResult.latencyMs })}
                      </>
                    ) : (
                      <>
                        <X className="size-4 text-destructive" />{' '}
                        {testResult.error ?? tr('ai.wizard.unreachable')}
                      </>
                    )}
                  </div>
                  {testResult.reachable && (
                    <div className="flex flex-wrap gap-1.5">
                      {CAPABILITY_KEYS.map(({ key, keyName }) => (
                        <span
                          key={key}
                          data-testid={`ai-wizard-cap-${key}`}
                          className={cn(
                            'rounded-full border px-2 py-0.5',
                            testResult.capabilities[key]
                              ? 'border-green-600/40 bg-green-600/10 text-green-700'
                              : 'border-border text-muted-foreground line-through',
                          )}
                        >
                          {t(keyName)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'model' && (
            <div data-testid="ai-wizard-model" className="space-y-3">
              <Field
                label={tr('ai.wizard.modelLabel')}
                hint={
                  models.length > 0
                    ? tr('ai.wizard.modelFromProvider', { count: models.length })
                    : tr('ai.wizard.modelManual')
                }
              >
                <Input
                  data-testid="ai-wizard-model-input"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    invalidateTest();
                  }}
                  placeholder="gpt-4o-mini"
                  list="ai-wizard-models"
                  spellCheck={false}
                />
                <datalist id="ai-wizard-models">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr('ai.wizard.temperature')} hint={tr('ai.wizard.temperatureHint')}>
                  <Input
                    data-testid="ai-wizard-temperature"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder={tr('ai.wizard.temperaturePlaceholder')}
                  />
                </Field>
                <Field label={tr('ai.wizard.maxTokens')} hint={tr('ai.wizard.maxTokensHint')}>
                  <Input
                    data-testid="ai-wizard-max-tokens"
                    type="number"
                    min="1"
                    step="1"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    placeholder={tr('ai.wizard.maxTokensPlaceholder')}
                  />
                </Field>
              </div>
              {models.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {models.slice(0, 12).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModel(m)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px]',
                        model === m
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent/50',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {saveError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {saveError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={step === 'provider' || (step === 'connection' && isEdit)}
            onClick={() => {
              if (step === 'test') setStep('connection');
              else if (step === 'model') setStep('test');
              else if (isEdit) setStep('connection');
            }}
          >
            <ArrowLeft className="size-3.5" />
            {tr('ai.wizard.previous')}
          </Button>
          <div className="flex gap-2">
            {step === 'connection' && (
              <Button
                data-testid="ai-wizard-next"
                size="sm"
                disabled={!canNext}
                onClick={() => void leaveConnection()}
              >
                {tr('ai.wizard.next')}
                <ArrowRight className="size-3.5" />
              </Button>
            )}
            {step === 'test' && (
              <Button
                data-testid="ai-wizard-to-model"
                size="sm"
                disabled={!testResult?.reachable}
                onClick={() => setStep('model')}
              >
                {tr('ai.wizard.next')}
                <ArrowRight className="size-3.5" />
              </Button>
            )}
            {step === 'model' && (
              <Button
                data-testid="ai-wizard-finish"
                size="sm"
                disabled={!canNext || saving}
                onClick={() => void finish()}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {isEdit ? tr('ai.wizard.save') : tr('ai.wizard.finish')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
