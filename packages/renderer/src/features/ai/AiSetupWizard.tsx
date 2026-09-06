import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiProviderKind, ConnectionTestResult } from '@nexnote/shared';
import { invoke } from '../../lib/ipc';
import { useAiConfig, useAiWizard } from './ai-config';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { connectionTestSignature, isConnectionTestCurrent } from './ai-wizard-test-state';
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

/** provider 预设：向导第一步的选择项。 */
const PROVIDER_PRESETS: Array<{
  id: string;
  title: string;
  desc: string;
  kind: AiProviderKind;
  baseUrl: string;
  icon: typeof Cloud;
}> = [
  {
    id: 'openai',
    title: 'OpenAI 官方',
    desc: 'api.openai.com，需要官方 API Key',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    icon: Cloud,
  },
  {
    id: 'azure',
    title: 'Azure OpenAI',
    desc: '企业级部署，模型名 = deployment 名',
    kind: 'azure-openai',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com',
    icon: CloudCog,
  },
  {
    id: 'ollama',
    title: '本地 Ollama',
    desc: '本地推理，无需密钥',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    icon: Server,
  },
  {
    id: 'compatible',
    title: '其他 OpenAI 兼容',
    desc: '中转站 / 自建网关 / vLLM 等',
    kind: 'openai-compatible',
    baseUrl: '',
    icon: Bot,
  },
];

type Step = 'provider' | 'connection' | 'test' | 'model';

const CAPABILITY_LABELS: Array<{ key: keyof ConnectionTestResult['capabilities']; label: string }> =
  [
    { key: 'chat', label: '对话' },
    { key: 'streaming', label: '流式' },
    { key: 'embeddings', label: 'Embedding' },
    { key: 'tools', label: '工具调用' },
  ];

/**
 * 首启动 AI 引导向导（未配置时 AI 入口进入）+ Profile 编辑器（设置页复用）。
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
  const editing = useAiConfig((s) => s.state?.profiles.find((p) => p.id === editProfileId) ?? null);
  const apply = useAiConfig((s) => s.apply);

  const [step, setStep] = useState<Step>(editing ? 'connection' : 'provider');
  const [presetId, setPresetId] = useState('openai');
  const [name, setName] = useState(editing?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? '');
  const [kind, setKind] = useState<AiProviderKind>(editing?.kind ?? 'openai-compatible');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(editing?.defaultModel ?? '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 通过测试时对应的连接输入签名。输入一变即视为测试过期（防止用过期结果保存）。 */
  const [testedSignature, setTestedSignature] = useState<string | null>(null);

  const preset = useMemo(() => PROVIDER_PRESETS.find((p) => p.id === presetId)!, [presetId]);
  const isEdit = !!editing;

  const currentTestInputs = { kind, baseUrl, apiKey };
  /** 测试结果是否仍然对应当前输入（未被改动）。 */
  const testValid = isConnectionTestCurrent(testResult, testedSignature, currentTestInputs);

  /** 任何影响连接的输入变化都使既有测试结果失效（必须重测）。 */
  const invalidateTest = useCallback(() => {
    setTestResult(null);
    setTestError(null);
    setModels([]);
    setTestedSignature(null);
  }, []);

  const pickPreset = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setKind(p.kind);
    if (!isEdit) {
      setBaseUrl(p.baseUrl);
      if (!name) setName(p.title);
    }
    invalidateTest();
    setStep('connection');
  };

  const runTest = useCallback(
    async (silent = false) => {
      if (!silent) setTesting(true);
      setTestError(null);
      try {
        const target = {
          // 编辑场景同时传 profileId + candidate：主进程可复用已存密钥，
          // 但网络请求必须按当前候选 kind/baseUrl/defaultModel 实测。
          ...(editing && { profileId: editing.id }),
          candidate: {
            kind,
            baseUrl,
            apiKey: apiKey || undefined,
            // 编辑模式携带既有默认模型：模型列表不可用时仍能对已知模型做实测
            defaultModel: (isEdit ? model.trim() || editing?.defaultModel : '') || undefined,
          },
        };
        const result = await invoke('ai:testConnection', target);
        setTestResult(result);
        setModels(result.models);
        setTestedSignature(connectionTestSignature({ kind, baseUrl, apiKey }));
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
        setTestedSignature(null);
        return null;
      } finally {
        setTesting(false);
      }
    },
    [apiKey, baseUrl, editing, isEdit, kind, model],
  );

  const finish = async () => {
    // 纵深防御：保存前验证测试结果仍然有效（对应当前输入）
    if (!testValid) {
      setSaveError('连接测试已失效（输入已变更），请重新测试连通性后再保存');
      setStep('test');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await invoke('ai:profile:save', {
        id: editing?.id,
        profile: {
          name: name.trim(),
          kind,
          baseUrl: baseUrl.trim(),
          defaultModel: model.trim(),
          apiKey: apiKey ? apiKey : editing ? undefined : null,
        },
      });
      // 新建首个 Profile：自动设默认 + 分功能智能填充
      if (!editing) {
        await invoke('ai:profile:setDefault', { id: saved.id }).catch(() => undefined);
        const chatModel =
          saved.state.profiles.find((p) => p.id === saved.id)?.defaultModel ?? model;
        await invoke('ai:features:set', {
          feature: 'chat',
          assignment: { profileId: saved.id, model: chatModel },
        }).catch(() => undefined);
        const embedModel = models.find((m) => m.toLowerCase().includes('embed'));
        if (embedModel) {
          await invoke('ai:features:set', {
            feature: 'embedding',
            assignment: { profileId: saved.id, model: embedModel },
          }).catch(() => undefined);
        }
      }
      const finalState = await invoke('ai:getState');
      apply(finalState);
      onClose();
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
    { id: 'provider', label: '选择服务' },
    { id: 'connection', label: '连接信息' },
    { id: 'test', label: '连通测试' },
    { id: 'model', label: '默认模型' },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);
  const canNext =
    step === 'connection'
      ? name.trim().length > 0 && /^https?:\/\//i.test(baseUrl.trim())
      : step === 'test'
        ? testValid
        : step === 'model'
          ? model.trim().length > 0
          : true;

  return (
    <div
      data-testid="ai-wizard"
      role="dialog"
      aria-modal="true"
      aria-label="AI 配置向导"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center gap-2 border-b px-5 py-3.5">
          <Bot className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{isEdit ? '编辑 AI Profile' : '配置 AI 供应商'}</h2>
          <button
            type="button"
            aria-label="关闭向导"
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
                选择 AI 供应商类型。NexNote 兼容一切 OpenAI 协议端点，密钥只保存在本机系统钥匙串。
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
                    <span className="block font-medium">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">{p.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'connection' && (
            <div data-testid="ai-wizard-connection" className="space-y-3.5">
              {!isEdit && (
                <p className="text-xs text-muted-foreground">
                  当前选择：<span className="font-medium text-foreground">{preset.title}</span>
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => setStep('provider')}
                  >
                    重选
                  </button>
                </p>
              )}
              <Field label="Profile 名称">
                <Input
                  data-testid="ai-wizard-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：OpenAI 官方 / 本地 Ollama"
                />
              </Field>
              <Field
                label="Base URL"
                hint={
                  kind === 'azure-openai'
                    ? '形如 https://资源名.openai.azure.com'
                    : '通常以 /v1 结尾'
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
              <Field
                label="API Key"
                hint={
                  editing
                    ? '留空 = 保留已保存密钥'
                    : kind === 'openai-compatible' && presetId === 'ollama'
                      ? '本地服务可留空'
                      : '仅存本机系统钥匙串，不会上传'
                }
              >
                <Input
                  data-testid="ai-wizard-apikey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    invalidateTest();
                  }}
                  placeholder={editing?.hasApiKey ? '••••••（已保存）' : 'sk-…'}
                  autoComplete="off"
                />
              </Field>
            </div>
          )}

          {step === 'test' && (
            <div data-testid="ai-wizard-test" className="space-y-3">
              <p className="text-muted-foreground">
                向供应商发送最小探测请求（列模型 + 对话 + SSE 流式 + 工具调用 + 向量）。
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
                {testing ? '测试中…' : testResult ? '重新测试' : '测试连通性'}
              </Button>

              {testError && (
                <div
                  data-testid="ai-wizard-test-error"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  {testError}
                  <p className="mt-1 opacity-80">请检查 base-url / 密钥后重试。</p>
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
                        <Check className="size-4 text-green-600" /> 连接成功 ·{' '}
                        {testResult.latencyMs}ms
                      </>
                    ) : (
                      <>
                        <X className="size-4 text-destructive" /> {testResult.error ?? '连接失败'}
                      </>
                    )}
                  </div>
                  {testResult.reachable && (
                    <div className="flex flex-wrap gap-1.5">
                      {CAPABILITY_LABELS.map(({ key, label }) => (
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
                          {label}
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
                label="默认对话模型"
                hint={
                  models.length > 0
                    ? `来自供应商模型列表（共 ${models.length} 个）`
                    : '供应商未返回列表，可手动输入'
                }
              >
                <Input
                  data-testid="ai-wizard-model-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
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
            上一步
          </Button>
          <div className="flex gap-2">
            {step === 'connection' && (
              <Button
                data-testid="ai-wizard-next"
                size="sm"
                disabled={!canNext}
                onClick={() => setStep('test')}
              >
                下一步
                <ArrowRight className="size-3.5" />
              </Button>
            )}
            {step === 'test' && (
              <Button
                data-testid="ai-wizard-to-model"
                size="sm"
                disabled={!testValid}
                onClick={() => setStep('model')}
              >
                下一步
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
                {isEdit ? '保存' : '完成配置'}
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
