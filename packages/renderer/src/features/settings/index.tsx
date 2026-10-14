import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings as SettingsIcon, FileText, Keyboard, GitBranch, Globe, Info } from 'lucide-react';
import { settingsSectionRegistry } from '../../registries';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { invoke } from '../../lib/ipc';
import { gettingStartedDocsUrl } from '../../lib/product-docs';
import { useI18n } from '../../lib/i18n';
import { useVaultSettingsEffects } from '../../hooks/use-settings-effects';
import { TranslationDefaultSettings } from '../ai/translation/TranslationDefaultSettings';
import type {
  StartupBehavior,
  ThemePreference,
  CodeTheme,
  ShortcutOverride,
  NetworkMode,
  NetworkProxyConfig,
  NetworkSettings,
} from '@nexnote/shared';
import { normalizeShortcut } from '@nexnote/shared';

/**
 * DEV-016：设置分区实现。
 * 分区注册走 registry，各功能域（AI/插件/Skill）在自己模块注册。
 * 这里注册核心分区：常规、编辑器、Git、快捷键、关于。
 */

settingsSectionRegistry.register({
  id: 'general',
  title: 'settings.section.general',
  titleIsKey: true,
  icon: SettingsIcon,
  order: 10,
  render: () => <GeneralSection />,
});

settingsSectionRegistry.register({
  id: 'editor',
  title: 'settings.section.editor',
  titleIsKey: true,
  icon: FileText,
  order: 20,
  render: () => <EditorSection />,
});

settingsSectionRegistry.register({
  id: 'git',
  title: 'settings.section.git',
  titleIsKey: true,
  icon: GitBranch,
  order: 30,
  render: () => <GitSection />,
});

settingsSectionRegistry.register({
  id: 'network',
  title: 'settings.section.network',
  titleIsKey: true,
  icon: Globe,
  order: 35,
  render: () => <NetworkSection />,
});

settingsSectionRegistry.register({
  id: 'shortcuts',
  title: 'settings.section.shortcuts',
  titleIsKey: true,
  icon: Keyboard,
  order: 40,
  render: () => <ShortcutsSection />,
});

settingsSectionRegistry.register({
  id: 'about',
  title: 'settings.section.about',
  titleIsKey: true,
  icon: Info,
  order: 100,
  render: () => <AboutSection />,
});

function useGlobalSettings() {
  const global = useSettingsStore((s) => s.global);
  const setGlobal = useSettingsStore((s) => s.setGlobal);
  const loadGlobal = useSettingsStore((s) => s.loadGlobal);
  useEffect(() => {
    void loadGlobal();
  }, [loadGlobal]);
  return { global, setGlobal };
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border bg-background px-2 text-sm"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center overflow-hidden rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-1 ring-black/5 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** 常规分区：外观、翻译默认值、启动、帮助。导出供 ADR-0023 接缝测试。 */
export function GeneralSection() {
  const { global, setGlobal } = useGlobalSettings();
  const t = useI18n();
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    void invoke('app:getInfo').then((info) => setAppVersion(info.version));
  }, []);

  if (!global) return <div className="text-sm text-muted-foreground">{t('settings.loading')}</div>;

  return (
    <div className="space-y-6">
      <SectionHeader title={t('settings.appearance.title')} description={t('settings.appearance.description')} />
      <Row label={t('settings.appearance.theme')} description={t('settings.appearance.theme.description')}>
        <Select
          value={global.appearance.theme}
          onChange={(v) => void setGlobal({ appearance: { theme: v as ThemePreference } })}
          options={[
            { value: 'system', label: t('settings.appearance.theme.system') },
            { value: 'light', label: t('settings.appearance.theme.light') },
            { value: 'dark', label: t('settings.appearance.theme.dark') },
          ]}
        />
      </Row>
      <Row label={t('settings.appearance.language')} description={t('settings.appearance.language.description')}>
        <Select
          value={global.appearance.language}
          onChange={(v) => void setGlobal({ appearance: { language: v as 'zh-CN' | 'en-US' } })}
          options={[
            { value: 'zh-CN', label: t('settings.appearance.language.zhCN') },
            { value: 'en-US', label: t('settings.appearance.language.enUS') },
          ]}
        />
      </Row>
      <Row label={t('settings.appearance.uiFont')} description={t('settings.appearance.uiFont.description')}>
        <input
          aria-label={t('settings.appearance.uiFont')}
          type="text"
          value={global.appearance.uiFontFamily}
          onChange={(e) => void setGlobal({ appearance: { uiFontFamily: e.target.value } })}
          className="h-8 w-64 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
      <Row label={t('settings.appearance.editorFont')} description={t('settings.appearance.editorFont.description')}>
        <input
          aria-label={t('settings.appearance.editorFont')}
          type="text"
          value={global.appearance.editorFontFamily}
          onChange={(e) => void setGlobal({ appearance: { editorFontFamily: e.target.value } })}
          className="h-8 w-64 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
      <Row label={t('settings.appearance.uiFontSize')} description={`${global.appearance.uiFontSize}px`}>
        <input
          type="range"
          min={10}
          max={24}
          value={global.appearance.uiFontSize}
          onChange={(e) => void setGlobal({ appearance: { uiFontSize: Number(e.target.value) } })}
          className="w-32"
        />
      </Row>
      <Row label={t('settings.appearance.editorFontSize')} description={`${global.appearance.editorFontSize}px`}>
        <input
          type="range"
          min={10}
          max={32}
          value={global.appearance.editorFontSize}
          onChange={(e) =>
            void setGlobal({ appearance: { editorFontSize: Number(e.target.value) } })
          }
          className="w-32"
        />
      </Row>

      <div className="border-t pt-6">
        <SectionHeader title={t('settings.translation.title')} description={t('settings.translation.description')} />
        <TranslationDefaultSettings />
      </div>

      <div className="border-t pt-6">
        <SectionHeader title={t('settings.startup.title')} description={t('settings.startup.description')} />
        <Row label={t('settings.startup.behavior')} description={t('settings.startup.behavior.description')}>
          <Select
            value={global.startup.behavior}
            onChange={(v) => void setGlobal({ startup: { behavior: v as StartupBehavior } })}
            options={[
              { value: 'restore', label: t('settings.startup.behavior.restore') },
              { value: 'welcome', label: t('settings.startup.behavior.welcome') },
              { value: 'specific-vault', label: t('settings.startup.behavior.specificVault') },
            ]}
          />
        </Row>
      </div>

      <div className="border-t pt-6">
        <SectionHeader title={t('settings.help.title')} description={t('settings.help.description')} />
        <Row label={t('settings.help.productDocs')} description={t('settings.help.productDocs.description')}>
          <button
            type="button"
            data-testid="settings-open-product-docs"
            onClick={() =>
              window.open(gettingStartedDocsUrl(global.appearance.language), '_blank', 'noopener')
            }
            className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            {t('settings.help.productDocs.open')}
          </button>
        </Row>
        <Row label={t('settings.help.tour')} description={t('settings.help.tour.description')}>
          <button
            type="button"
            data-testid="settings-replay-tour"
            onClick={() => useUiStore.getState().setTourOpen(true)}
            className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            {t('settings.help.tour.replay')}
          </button>
        </Row>
      </div>

      <p className="text-[11px] text-muted-foreground/70">NexNote v{appVersion}</p>
    </div>
  );
}

function NetworkSection() {
  const { global, setGlobal } = useGlobalSettings();
  const tr = useI18n();
  const net = global?.network ?? null;
  const setNet = useCallback(
    (patch: Partial<NonNullable<typeof net>>) => {
      void setGlobal({ network: patch });
    },
    [setGlobal],
  );
  if (!net) return <div className="text-sm text-muted-foreground">{tr('settings.loading')}</div>;
  return (
    <div className="space-y-6">
      <SectionHeader
        title={tr('settings.network.title')}
        description={tr('settings.network.description')}
      />
      <Row
        label={tr('settings.network.mode')}
        description={tr('settings.network.mode.description')}
      >
        <Select
          value={net.mode}
          onChange={(v) => setNet({ mode: v as NetworkMode })}
          options={[
            { value: 'system', label: tr('settings.network.mode.system') },
            { value: 'http', label: 'HTTP' },
            { value: 'https', label: 'HTTPS' },
            { value: 'socks5', label: 'SOCKS5' },
            { value: 'off', label: tr('settings.network.mode.off') },
          ]}
        />
      </Row>
      {net.mode !== 'system' && net.mode !== 'off' && (
        <>
          <Row
            label={tr('settings.network.host')}
            description={tr('settings.network.host.description')}
          >
            <input
              type="text"
              value={net.host ?? ''}
              onChange={(e) => setNet({ host: e.target.value.trim() || null })}
              placeholder="127.0.0.1"
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row label={tr('settings.network.port')} description={tr('settings.network.port.description')}>
            <input
              type="number"
              min={1}
              max={65535}
              value={net.port ?? ''}
              onChange={(e) => {
                const n = Number(e.target.value);
                setNet({ port: Number.isFinite(n) && n > 0 && n <= 65535 ? Math.round(n) : null });
              }}
              placeholder="7890"
              className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row
            label={tr('settings.network.username')}
            description={tr('settings.network.username.description')}
          >
            <input
              type="text"
              value={net.username ?? ''}
              onChange={(e) => setNet({ username: e.target.value.trim() || null })}
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row
            label={tr('settings.network.password')}
            description={tr('settings.network.password.description')}
          >
            <input
              type="password"
              value={net.password ?? ''}
              onChange={(e) => setNet({ password: e.target.value || null })}
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
        </>
      )}
      <Row
        label={tr('settings.network.bypass')}
        description={tr('settings.network.bypass.description')}
      >
        <input
          type="text"
          value={net.bypass.join(', ')}
          onChange={(event) =>
            setNet({
              bypass: event.target.value
                .split(',')
                .map((host) => host.trim())
                .filter(Boolean),
            })
          }
          placeholder="localhost, .example.com"
          className="h-8 w-64 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
      <Row
        label={tr('settings.network.applyAi')}
        description={tr('settings.network.applyAi.description')}
      >
        <Toggle checked={net.applyToAi} onChange={(v) => setNet({ applyToAi: v })} />
      </Row>
      <Row
        label={tr('settings.network.applyGit')}
        description={tr('settings.network.applyGit.description')}
      >
        <Toggle checked={net.applyToGit} onChange={(v) => setNet({ applyToGit: v })} />
      </Row>
      <Row
        label={tr('settings.network.aiProxy')}
        description={tr('settings.network.aiProxy.description')}
      >
        <Toggle
          label={tr('settings.network.aiProxy')}
          checked={net.aiProxy !== null}
          onChange={(enabled) => setNet({ aiProxy: enabled ? profileFromNetwork(net) : null })}
        />
      </Row>
      {net.aiProxy && (
        <NetworkProxyEditor
          label="AI"
          value={net.aiProxy}
          onChange={(aiProxy) => setNet({ aiProxy })}
        />
      )}
      <Row
        label={tr('settings.network.gitProxy')}
        description={tr('settings.network.gitProxy.description')}
      >
        <Toggle
          label={tr('settings.network.gitProxy')}
          checked={net.gitProxy !== null}
          onChange={(enabled) => setNet({ gitProxy: enabled ? profileFromNetwork(net) : null })}
        />
      </Row>
      {net.gitProxy && (
        <NetworkProxyEditor
          label="Git"
          value={net.gitProxy}
          onChange={(gitProxy) => setNet({ gitProxy })}
        />
      )}
    </div>
  );
}

function profileFromNetwork(network: NetworkSettings): NetworkProxyConfig {
  return {
    mode: network.mode,
    host: network.host,
    port: network.port,
    username: network.username,
    password: network.password,
    bypass: network.bypass,
  };
}

function NetworkProxyEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: NetworkProxyConfig;
  onChange: (next: NetworkProxyConfig) => void;
}) {
  const tr = useI18n();
  const set = (patch: Partial<NetworkProxyConfig>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 border-l-2 pl-3">
      <Row label={tr('settings.network.proxyMode', { label })}>
        <Select
          value={value.mode}
          onChange={(mode) => set({ mode: mode as NetworkMode })}
          options={[
            { value: 'system', label: tr('settings.network.mode.system') },
            { value: 'http', label: 'HTTP' },
            { value: 'https', label: 'HTTPS' },
            { value: 'socks5', label: 'SOCKS5' },
            { value: 'off', label: tr('settings.network.mode.off') },
          ]}
        />
      </Row>
      {value.mode !== 'system' && value.mode !== 'off' && (
        <>
          <Row label={tr('settings.network.proxyHost', { label })}>
            <input
              type="text"
              value={value.host ?? ''}
              onChange={(event) => set({ host: event.target.value.trim() || null })}
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row label={tr('settings.network.proxyPort', { label })}>
            <input
              type="number"
              min={1}
              max={65535}
              value={value.port ?? ''}
              onChange={(event) => {
                const port = Number(event.target.value);
                set({
                  port:
                    Number.isFinite(port) && port > 0 && port <= 65535 ? Math.round(port) : null,
                });
              }}
              className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row label={tr('settings.network.proxyUsername', { label })}>
            <input
              type="text"
              value={value.username ?? ''}
              onChange={(event) => set({ username: event.target.value.trim() || null })}
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row label={tr('settings.network.proxyPassword', { label })}>
            <input
              type="password"
              value={value.password ?? ''}
              onChange={(event) => set({ password: event.target.value || null })}
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
        </>
      )}
      <Row label={tr('settings.network.proxyBypass', { label })}>
        <input
          type="text"
          value={value.bypass.join(', ')}
          onChange={(event) =>
            set({
              bypass: event.target.value
                .split(',')
                .map((host) => host.trim())
                .filter(Boolean),
            })
          }
          placeholder="localhost, .example.com"
          className="h-8 w-64 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
    </div>
  );
}

function EditorSection() {
  const { vault } = useVaultSettingsEffects();
  const setVault = useSettingsStore((s) => s.setVault);
  const tr = useI18n();

  if (!vault) {
    return (
      <div className="text-sm text-muted-foreground">{tr('settings.editor.vaultRequired')}</div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title={tr('settings.editor.title')} description={tr('settings.editor.description')} />
      <Row
        label={tr('settings.editor.autoSaveMs')}
        description={tr('settings.editor.autoSaveMs.description', { ms: vault.editor.autoSaveMs })}
      >
        <input
          type="range"
          min={100}
          max={10000}
          step={100}
          value={vault.editor.autoSaveMs}
          onChange={(e) => void setVault({ editor: { autoSaveMs: Number(e.target.value) } })}
          className="w-32"
        />
      </Row>
      <Row
        label={tr('settings.editor.bindFileNameToTitle')}
        description={tr('settings.editor.bindFileNameToTitle.description')}
      >
        <Toggle
          checked={vault.editor.bindFileNameToTitle}
          onChange={(v) => void setVault({ editor: { bindFileNameToTitle: v } })}
        />
      </Row>
      <Row label={tr('settings.editor.codeTheme')}>
        <Select
          value={vault.editor.codeTheme}
          onChange={(v) => void setVault({ editor: { codeTheme: v as CodeTheme } })}
          options={[
            { value: 'github', label: 'GitHub' },
            { value: 'dracula', label: 'Dracula' },
            { value: 'nord', label: 'Nord' },
          ]}
        />
      </Row>
      <Row label={tr('settings.editor.vimMode')} description={tr('settings.editor.vimMode.description')}>
        <Toggle
          checked={vault.editor.vimMode}
          onChange={(v) => void setVault({ editor: { vimMode: v } })}
        />
      </Row>
      <Row
        label={tr('settings.editor.binaryMax')}
        description={tr('settings.editor.binaryMax.description', {
          count: vault.binary.maxConcurrentTabs,
        })}
      >
        <input
          type="range"
          min={1}
          max={8}
          step={1}
          value={vault.binary.maxConcurrentTabs}
          onChange={(e) => void setVault({ binary: { maxConcurrentTabs: Number(e.target.value) } })}
          className="w-32"
        />
      </Row>
    </div>
  );
}

function GitSection() {
  const { global, setGlobal } = useGlobalSettings();
  const { vault } = useVaultSettingsEffects();
  const setVault = useSettingsStore((s) => s.setVault);
  const tr = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [binaryUntracked, setBinaryUntracked] = useState<boolean | null>(null);

  // DEV-074：二进制文档 Git 跟踪开关（写 vault 根 .gitignore）。
  useEffect(() => {
    let cancelled = false;
    void invoke('binary:gitignore:get')
      .then((r) => {
        if (!cancelled) setBinaryUntracked(r.untracked);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setBinaryUntrack = async (untrack: boolean): Promise<void> => {
    try {
      const r = await invoke('binary:gitignore:set', { untrack });
      setBinaryUntracked(r.untracked);
      setMessage(
        untrack
          ? r.removedFromIndex > 0
            ? tr('settings.git.binaryUntrackedCount', { count: r.removedFromIndex })
            : tr('settings.git.binaryUntrackedNew')
          : tr('settings.git.binaryTrackingRestored'),
      );
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveInterval = async (ms: number): Promise<void> => {
    try {
      await setVault({ git: { autoCommitIntervalMs: ms } });
      setMessage(tr('settings.git.intervalSaved', { ms }));
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Git" description={tr('settings.git.description')} />
      <Row label={tr('settings.git.system')} description={tr('settings.git.system.description')}>
        <Toggle
          label={tr('settings.git.system')}
          checked={global?.git.useSystemGit ?? false}
          onChange={(v) => void setGlobal({ git: { useSystemGit: v } })}
        />
      </Row>
      <div className="border-t pt-6">
        <SectionHeader
          title={tr('settings.git.currentVault')}
          description={tr('settings.git.currentVault.description')}
        />
        {!vault ? (
          <div className="text-sm text-muted-foreground">
            {tr('settings.git.vaultRequired')}
          </div>
        ) : (
          <>
            <Row label={tr('settings.git.autoCommit')}>
              <Toggle
                checked={vault.git.autoCommit}
                onChange={(v) => void setVault({ git: { autoCommit: v } })}
              />
            </Row>
            <Row
              label={tr('settings.git.interval')}
              description={tr('settings.git.interval.description', {
                ms: vault.git.autoCommitIntervalMs,
              })}
            >
              <input
                type="range"
                min={2000}
                max={600000}
                step={1000}
                value={vault.git.autoCommitIntervalMs}
                onChange={(e) => {
                  void saveInterval(Number(e.target.value));
                }}
                className="w-32"
              />
            </Row>
            <Row
              label={tr('settings.git.commitTemplate')}
              description={tr('settings.git.commitTemplate.description', { summary: '{summary}' })}
            >
              <input
                type="text"
                value={vault.git.commitMessageTemplate}
                onChange={(e) => void setVault({ git: { commitMessageTemplate: e.target.value } })}
                className="h-8 w-56 rounded-md border bg-background px-2 text-sm"
              />
            </Row>
            <Row
              label={tr('settings.git.defaultBranch')}
              description={tr('settings.git.defaultBranch.description')}
            >
              <input
                type="text"
                value={vault.git.defaultBranch}
                onChange={(e) => void setVault({ git: { defaultBranch: e.target.value } })}
                className="h-8 w-40 rounded-md border bg-background px-2 text-sm"
              />
            </Row>
            {binaryUntracked !== null && (
              <Row
                label={tr('settings.git.binaryUntrack')}
                description={tr('settings.git.binaryUntrack.description')}
              >
                <Toggle checked={binaryUntracked} onChange={(v) => void setBinaryUntrack(v)} />
              </Row>
            )}
          </>
        )}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
function ShortcutsSection() {
  const { global } = useGlobalSettings();
  const setShortcuts = useSettingsStore((s) => s.setShortcuts);
  const tr = useI18n();
  const shortcuts = useMemo(() => global?.shortcuts ?? [], [global?.shortcuts]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const persist = useCallback(
    async (next: ShortcutOverride[]) => {
      try {
        await setShortcuts(next);
        setMessage(tr('settings.shortcuts.saved'));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [setShortcuts, tr],
  );

  const saveBinding = async (shortcut: ShortcutOverride): Promise<void> => {
    const canonical = normalizeShortcut(drafts[shortcut.commandId] ?? shortcut.key);
    if (!canonical) {
      setMessage(tr('settings.shortcuts.invalid'));
      return;
    }
    const collision = shortcuts.find(
      (candidate) =>
        candidate.commandId !== shortcut.commandId &&
        !candidate.disabled &&
        candidate.key === canonical,
    );
    if (collision) {
      setMessage(tr('settings.shortcuts.conflict', { commandId: collision.commandId }));
      return;
    }
    await persist(
      shortcuts.map((candidate) =>
        candidate.commandId === shortcut.commandId
          ? { ...candidate, key: canonical, disabled: false }
          : candidate,
      ),
    );
  };

  const toggleBinding = async (shortcut: ShortcutOverride): Promise<void> => {
    const key = normalizeShortcut(drafts[shortcut.commandId] ?? shortcut.key);
    if (shortcut.disabled && !key) {
      setMessage(tr('settings.shortcuts.enableRequiresKey'));
      return;
    }
    await persist(
      shortcuts.map((candidate) =>
        candidate.commandId === shortcut.commandId
          ? { ...candidate, key: shortcut.disabled ? key : '', disabled: !shortcut.disabled }
          : candidate,
      ),
    );
  };

  if (!global) return <div className="text-sm text-muted-foreground">{tr('settings.loading')}</div>;

  const handleImport = async (): Promise<void> => {
    try {
      const result = await invoke('settings:pickImportFile');
      if (result) {
        const { imported } = await invoke('settings:importShortcuts', { json: result });
        setMessage(tr('settings.shortcuts.imported', { count: imported }));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExport = async (): Promise<void> => {
    try {
      const result = await invoke('settings:exportShortcuts');
      await invoke('settings:saveExportFile', {
        suggestedName: 'nexnote-shortcuts.json',
        contents: result.json,
      });
      setMessage(tr('settings.shortcuts.exported'));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title={tr('settings.section.shortcuts')}
        description={tr('settings.shortcuts.description')}
      />
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => void handleImport()}
          className="h-7 rounded-md border px-3 text-xs hover:bg-accent"
        >
          {tr('settings.shortcuts.import')}
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          className="h-7 rounded-md border px-3 text-xs hover:bg-accent"
        >
          {tr('settings.shortcuts.export')}
        </button>
      </div>
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      <div className="divide-y rounded-md border">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.commandId}
            className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_auto] items-center gap-2 px-3 py-2 text-sm"
          >
            <label
              htmlFor={`shortcut-${shortcut.commandId}`}
              className="truncate text-muted-foreground"
            >
              {shortcut.commandId}
            </label>
            <input
              id={`shortcut-${shortcut.commandId}`}
              aria-label={tr('settings.shortcuts.aria', { commandId: shortcut.commandId })}
              value={drafts[shortcut.commandId] ?? shortcut.key}
              disabled={shortcut.disabled}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [shortcut.commandId]: event.target.value }))
              }
              onBlur={() => {
                if (!shortcut.disabled) void saveBinding(shortcut);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveBinding(shortcut);
                }
              }}
              className="h-8 rounded-md border bg-background px-2 font-mono text-xs disabled:opacity-50"
            />
            <Toggle checked={!shortcut.disabled} onChange={() => void toggleBinding(shortcut)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutSection() {
  const tr = useI18n();
  const [info, setInfo] = useState<{
    version: string;
    platform: string;
    arch: string;
    runtimeName: string;
    runtimeVersion: string;
  } | null>(null);

  useEffect(() => {
    void invoke('app:getInfo').then(setInfo);
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader title={tr('settings.about.title')} />
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{tr('settings.about.version')}</span>
          <span className="font-mono">{info?.version ?? '…'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{tr('settings.about.platform')}</span>
          <span className="font-mono">{info?.platform ?? '…'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{tr('settings.about.architecture')}</span>
          <span className="font-mono">{info?.arch ?? '…'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Runtime</span>
          <span className="font-mono">
            {info ? `${info.runtimeName} ${info.runtimeVersion}` : '…'}
          </span>
        </div>
      </div>
      <div className="pt-4 text-xs text-muted-foreground">
        <p>{tr('settings.about.description')}</p>
        <p className="mt-2">{tr('settings.about.localData')}</p>
      </div>
    </div>
  );
}
