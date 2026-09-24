import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings as SettingsIcon, FileText, Keyboard, GitBranch, Globe, Info } from 'lucide-react';
import { settingsSectionRegistry } from '../../registries';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { invoke } from '../../lib/ipc';
import { useVaultSettingsEffects } from '../../hooks/use-settings-effects';
import type {
  StartupBehavior,
  ThemePreference,
  UpdateChannel,
  CodeTheme,
  ShortcutOverride,
  NetworkMode,
} from '@nexnote/shared';
import { normalizeShortcut } from '@nexnote/shared';

/**
 * DEV-016：设置分区实现。
 * 分区注册走 registry，各功能域（AI/插件/Skill）在自己模块注册。
 * 这里注册核心分区：常规、编辑器、Git、快捷键、关于。
 */

settingsSectionRegistry.register({
  id: 'general',
  title: '常规',
  icon: SettingsIcon,
  order: 10,
  render: () => <GeneralSection />,
});

settingsSectionRegistry.register({
  id: 'editor',
  title: '编辑器',
  icon: FileText,
  order: 20,
  render: () => <EditorSection />,
});

settingsSectionRegistry.register({
  id: 'git',
  title: 'Git',
  icon: GitBranch,
  order: 30,
  render: () => <GitSection />,
});

settingsSectionRegistry.register({
  id: 'network',
  title: '网络',
  icon: Globe,
  order: 35,
  render: () => <NetworkSection />,
});

settingsSectionRegistry.register({
  id: 'shortcuts',
  title: '快捷键',
  icon: Keyboard,
  order: 40,
  render: () => <ShortcutsSection />,
});

settingsSectionRegistry.register({
  id: 'about',
  title: '关于',
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
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

function GeneralSection() {
  const { global, setGlobal } = useGlobalSettings();
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    void invoke('app:getInfo').then((info) => setAppVersion(info.version));
  }, []);

  if (!global) return <div className="text-sm text-muted-foreground">加载中…</div>;

  return (
    <div className="space-y-6">
      <SectionHeader title="外观" description="主题、字体与语言" />
      <Row label="主题" description="浅色、深色或跟随系统">
        <Select
          value={global.appearance.theme}
          onChange={(v) => void setGlobal({ appearance: { theme: v as ThemePreference } })}
          options={[
            { value: 'system', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
      </Row>
      <Row label="语言" description="界面显示语言">
        <Select
          value={global.appearance.language}
          onChange={(v) => void setGlobal({ appearance: { language: v as 'zh-CN' | 'en-US' } })}
          options={[
            { value: 'zh-CN', label: '简体中文' },
            { value: 'en-US', label: 'English' },
          ]}
        />
      </Row>
      <Row label="UI 字体" description="CSS 字体族列表">
        <input
          aria-label="UI 字体"
          type="text"
          value={global.appearance.uiFontFamily}
          onChange={(e) => void setGlobal({ appearance: { uiFontFamily: e.target.value } })}
          className="h-8 w-64 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
      <Row label="编辑器字体" description="编辑器与等宽文本字体族">
        <input
          aria-label="编辑器字体"
          type="text"
          value={global.appearance.editorFontFamily}
          onChange={(e) => void setGlobal({ appearance: { editorFontFamily: e.target.value } })}
          className="h-8 w-64 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
      <Row label="UI 字号" description={`${global.appearance.uiFontSize}px`}>
        <input
          type="range"
          min={10}
          max={24}
          value={global.appearance.uiFontSize}
          onChange={(e) => void setGlobal({ appearance: { uiFontSize: Number(e.target.value) } })}
          className="w-32"
        />
      </Row>
      <Row label="编辑器字号" description={`${global.appearance.editorFontSize}px`}>
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
        <SectionHeader title="启动" description="应用打开时的行为" />
        <Row label="启动时" description="打开上次知识库、走向导或打开特定知识库">
          <Select
            value={global.startup.behavior}
            onChange={(v) => void setGlobal({ startup: { behavior: v as StartupBehavior } })}
            options={[
              { value: 'restore', label: '恢复上次知识库' },
              { value: 'welcome', label: '显示欢迎页' },
              { value: 'specific-vault', label: '打开特定知识库' },
            ]}
          />
        </Row>
      </div>

      <div className="border-t pt-6">
        <SectionHeader title="更新" description="自动检查与下载更新" />
        <Row label="启动时检查更新">
          <Toggle
            checked={global.updates.checkOnLaunch}
            onChange={(v) => void setGlobal({ updates: { checkOnLaunch: v } })}
          />
        </Row>
        <Row label="自动下载更新">
          <Toggle
            checked={global.updates.autoDownload}
            onChange={(v) => void setGlobal({ updates: { autoDownload: v } })}
          />
        </Row>
        <Row label="更新通道">
          <Select
            value={global.updates.channel}
            onChange={(v) => void setGlobal({ updates: { channel: v as UpdateChannel } })}
            options={[
              { value: 'stable', label: '稳定版' },
              { value: 'beta', label: 'Beta' },
              { value: 'alpha', label: 'Alpha' },
            ]}
          />
        </Row>
      </div>

      <div className="border-t pt-6">
        <SectionHeader title="帮助" description="重新查看产品使用引导" />
        <Row label="新手引导" description="分步了解页面树、编辑器、AI 与版本时间线等核心区域">
          <button
            type="button"
            data-testid="settings-replay-tour"
            onClick={() => useUiStore.getState().setTourOpen(true)}
            className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            重新播放
          </button>
        </Row>
      </div>

      <div className="border-t pt-6">
        <SectionHeader title="Git" description="全局 Git 行为（每个知识库可单独设置）" />
        <Row label="使用系统 Git" description="默认使用 NexNote 内置 Git">
          <Toggle
            checked={global.git.useSystemGit}
            onChange={(v) => void setGlobal({ git: { useSystemGit: v } })}
          />
        </Row>
      </div>

      <p className="text-[11px] text-muted-foreground/70">NexNote v{appVersion}</p>
    </div>
  );
}

function NetworkSection() {
  const { global, setGlobal } = useGlobalSettings();
  const net = global?.network ?? null;
  const setNet = useCallback(
    (patch: Partial<NonNullable<typeof net>>) => {
      void setGlobal({ network: patch });
    },
    [setGlobal],
  );
  if (!net) return <div className="text-sm text-muted-foreground">加载中…</div>;
  return (
    <div className="space-y-6">
      <SectionHeader
        title="网络"
        description="AI 请求与 Git 同步的网络代理。默认跟随系统代理；如无系统代理则直连。"
      />
      <Row label="代理模式" description="system = 跟随系统；off = 不走代理；自定义 = 走指定代理">
        <Select
          value={net.mode}
          onChange={(v) => setNet({ mode: v as NetworkMode })}
          options={[
            { value: 'system', label: '跟随系统' },
            { value: 'http', label: 'HTTP' },
            { value: 'https', label: 'HTTPS' },
            { value: 'socks5', label: 'SOCKS5' },
            { value: 'off', label: '关闭代理' },
          ]}
        />
      </Row>
      {net.mode !== 'system' && net.mode !== 'off' && (
        <>
          <Row label="主机" description="代理服务器地址（IP 或域名）">
            <input
              type="text"
              value={net.host ?? ''}
              onChange={(e) => setNet({ host: e.target.value.trim() || null })}
              placeholder="127.0.0.1"
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row label="端口" description="1–65535">
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
          <Row label="账号" description="（可选）需要认证时填写">
            <input
              type="text"
              value={net.username ?? ''}
              onChange={(e) => setNet({ username: e.target.value.trim() || null })}
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
          <Row label="密码" description="（可选）仅保存在本机 settings 文件">
            <input
              type="password"
              value={net.password ?? ''}
              onChange={(e) => setNet({ password: e.target.value || null })}
              className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </Row>
        </>
      )}
      <Row label="代理 AI 请求" description="为 AI provider 调用注入代理">
        <Toggle checked={net.applyToAi} onChange={(v) => setNet({ applyToAi: v })} />
      </Row>
      <Row label="代理 Git 操作" description="为 Git 同步/推送注入代理">
        <Toggle checked={net.applyToGit} onChange={(v) => setNet({ applyToGit: v })} />
      </Row>
    </div>
  );
}

function EditorSection() {
  const { vault } = useVaultSettingsEffects();
  const setVault = useSettingsStore((s) => s.setVault);

  if (!vault) {
    return (
      <div className="text-sm text-muted-foreground">尚未打开知识库，打开后可配置编辑器行为。</div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="编辑器" description="当前知识库的编辑器行为" />
      <Row label="自动保存间隔" description={`${vault.editor.autoSaveMs}ms（100ms–10s）`}>
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
      <Row label="文件名与 H1 标题联动" description="修改标题自动重命名文件">
        <Toggle
          checked={vault.editor.bindFileNameToTitle}
          onChange={(v) => void setVault({ editor: { bindFileNameToTitle: v } })}
        />
      </Row>
      <Row label="代码块主题">
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
      <Row label="Vim 模式" description="实验性功能，当前版本尚未启用">
        <Toggle
          checked={vault.editor.vimMode}
          onChange={(v) => void setVault({ editor: { vimMode: v } })}
        />
      </Row>
      <Row
        label="二进制文档编辑器并发上限"
        description={`docx / xlsx / xmind tab 最多同时打开 ${vault.binary.maxConcurrentTabs} 个，超出自动关闭最早打开的（1–8）`}
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
  const { vault } = useVaultSettingsEffects();
  const setVault = useSettingsStore((s) => s.setVault);
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
            ? `已停止跟踪 ${r.removedFromIndex} 个二进制文档，文件仍保留在本地`
            : '新建的二进制文档将不再随 Git 跟踪'
          : '二进制文档恢复 Git 跟踪（仅对之后新增的文件生效）',
      );
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  if (!vault) {
    return (
      <div className="text-sm text-muted-foreground">尚未打开知识库，打开后可配置 Git 行为。</div>
    );
  }

  const saveInterval = async (ms: number): Promise<void> => {
    try {
      await setVault({ git: { autoCommitIntervalMs: ms } });
      setMessage(`已保存：自动提交防抖 ${ms}ms`);
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Git（当前知识库）" description="版本控制行为" />
      <Row label="自动提交">
        <Toggle
          checked={vault.git.autoCommit}
          onChange={(v) => void setVault({ git: { autoCommit: v } })}
        />
      </Row>
      <Row label="自动提交间隔" description={`${vault.git.autoCommitIntervalMs}ms（2s–10min）`}>
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
      <Row label="提交消息模板" description="{summary} 会被替换为变更摘要">
        <input
          type="text"
          value={vault.git.commitMessageTemplate}
          onChange={(e) => void setVault({ git: { commitMessageTemplate: e.target.value } })}
          className="h-8 w-56 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
      <Row label="默认分支名" description="新建知识库时使用">
        <input
          type="text"
          value={vault.git.defaultBranch}
          onChange={(e) => void setVault({ git: { defaultBranch: e.target.value } })}
          className="h-8 w-40 rounded-md border bg-background px-2 text-sm"
        />
      </Row>
      {binaryUntracked !== null && (
        <Row
          label="二进制文档不随 Git 跟踪"
          description="docx / xlsx / xmind 默认随知识库版本化；开启后写入 .gitignore 不再跟踪"
        >
          <Toggle
            checked={binaryUntracked}
            onChange={(v) => void setBinaryUntrack(v)}
          />
        </Row>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
function ShortcutsSection() {
  const { global } = useGlobalSettings();
  const setShortcuts = useSettingsStore((s) => s.setShortcuts);
  const shortcuts = useMemo(() => global?.shortcuts ?? [], [global?.shortcuts]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const persist = useCallback(
    async (next: ShortcutOverride[]) => {
      try {
        await setShortcuts(next);
        setMessage('快捷键已保存');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [setShortcuts],
  );

  const saveBinding = async (shortcut: ShortcutOverride): Promise<void> => {
    const canonical = normalizeShortcut(drafts[shortcut.commandId] ?? shortcut.key);
    if (!canonical) {
      setMessage('请输入有效快捷键，例如 Mod+Shift+F');
      return;
    }
    const collision = shortcuts.find(
      (candidate) =>
        candidate.commandId !== shortcut.commandId &&
        !candidate.disabled &&
        candidate.key === canonical,
    );
    if (collision) {
      setMessage(`快捷键与 ${collision.commandId} 冲突`);
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
      setMessage('启用前请先输入有效快捷键');
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

  if (!global) return <div className="text-sm text-muted-foreground">加载中…</div>;

  const handleImport = async (): Promise<void> => {
    try {
      const result = await invoke('settings:pickImportFile');
      if (result) {
        const { imported } = await invoke('settings:importShortcuts', { json: result });
        setMessage(`已导入 ${imported} 条快捷键`);
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
      setMessage('快捷键已导出');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="快捷键" description="直接编辑快捷键，或单独启用、禁用每个绑定。" />
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => void handleImport()}
          className="h-7 rounded-md border px-3 text-xs hover:bg-accent"
        >
          导入…
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          className="h-7 rounded-md border px-3 text-xs hover:bg-accent"
        >
          导出…
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
              aria-label={`${shortcut.commandId} 快捷键`}
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
  const [info, setInfo] = useState<{
    version: string;
    platform: string;
    arch: string;
    electronVersion: string;
  } | null>(null);

  useEffect(() => {
    void invoke('app:getInfo').then(setInfo);
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader title="关于 NexNote" />
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">版本</span>
          <span className="font-mono">{info?.version ?? '…'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">平台</span>
          <span className="font-mono">{info?.platform ?? '…'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">架构</span>
          <span className="font-mono">{info?.arch ?? '…'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Electron</span>
          <span className="font-mono">{info?.electronVersion ?? '…'}</span>
        </div>
      </div>
      <div className="pt-4 text-xs text-muted-foreground">
        <p>NexNote — 面向 AI 原生工作流的本地知识库。</p>
        <p className="mt-2">所有数据保存在本地知识库目录中。</p>
      </div>
    </div>
  );
}
