import { useEffect, useState } from 'react';
import type { AppInfo } from '@nexnote/shared';
import { Command, FileCode2, GraduationCap, Link2, Moon, Sparkles, Sun } from 'lucide-react';
import { Button } from '../components/ui/button';
import { invoke } from '../lib/ipc';
import { usePaletteStore } from '../stores/palette-store';
import { useSettingsStore } from '../stores/settings-store';
import { useUiStore } from '../stores/ui-store';
import { useThemeStore } from '../theme/theme-store';
import { useVault } from '../shell/vault-context';

/**
 * 官网产品文档（ADR-0021 / ADR-0022）。语言跟随界面语言设置，
 * 与官网 `/docs`（英文）、`/zh/docs`（简体中文）一一对应。
 */
const DOCS_BASE_URL = 'https://nexnote-app.vercel.app';

const CAPABILITY_LINE =
  '块编辑与 Markdown 双格式文档 · 页面树、双向链接与图谱 · 内置 Git 版本历史 · AI 对话与写作辅助';

const highlights = [
  { icon: FileCode2, text: '源码 / 分栏 / 预览随时切' },
  { icon: Sparkles, text: 'AI 仅在显式意图时发起' },
  { icon: Link2, text: '[[双链]] 与回链自动生成' },
];

/** 默认欢迎 Tab。 */
export function WelcomePage() {
  const vault = useVault();
  const setPaletteOpen = usePaletteStore((s) => s.setOpen);
  const toggleTheme = useThemeStore((s) => s.setPreference);
  const resolved = useThemeStore((s) => s.resolved);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const language = useSettingsStore((s) => s.global?.appearance.language);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  const gettingStartedUrl = `${DOCS_BASE_URL}${
    language === 'en-US' ? '/docs' : '/zh/docs'
  }/getting-started`;

  useEffect(() => {
    void invoke('app:getInfo')
      .then(setAppInfo)
      .catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-10 px-8">
      <header className="text-center">
        <div className="flex min-w-0 items-center justify-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            N
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">NexNote</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {vault?.name ?? '—'}
              {appInfo && <span className="opacity-70"> · v{appInfo.version}</span>}
            </p>
          </div>
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">这里是你的本地知识库</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          打开左侧页面树开始写作，或直接进入一个动作。
        </p>
      </header>

      <div className="flex flex-col items-center gap-2.5">
        <Button
          size="lg"
          className="h-11 w-full max-w-sm text-sm"
          data-testid="welcome-start-tour"
          data-docs-url={gettingStartedUrl}
          onClick={() => window.open(gettingStartedUrl, '_blank', 'noopener')}
        >
          <GraduationCap className="size-4" />
          快速上手
        </Button>
        <div className="flex w-full max-w-sm gap-2">
          <Button
            variant="outline"
            size="lg"
            className="h-11 flex-1"
            onClick={() => setPaletteOpen(true)}
          >
            <Command className="size-4" />
            命令面板
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 flex-1"
            aria-label="切换主题"
            onClick={() => toggleTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            主题
          </Button>
        </div>
        <button
          type="button"
          onClick={toggleDock}
          className="mt-1 text-[11px] text-muted-foreground underline-offset-4 hover:underline"
        >
          切换 Dock
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {highlights.map(({ icon: Icon, text }) => (
          <div
            key={text}
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[11px] text-muted-foreground"
          >
            <Icon className="size-3.5 shrink-0" />
            {text}
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
        {CAPABILITY_LINE}
      </p>
    </div>
  );
}
