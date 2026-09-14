import { useEffect, useState } from 'react';
import { FolderGit2, Moon, Sun } from 'lucide-react';
import { statusBarRegistry } from '../../registries';
import { invoke } from '../../lib/ipc';
import { useVault } from '../../shell/vault-context';
import { useThemeStore } from '../../theme/theme-store';
import type { AppInfo } from '@nexnote/shared';

/**
 * 状态栏内置条目：
 * - 左：知识库名称
 * - 右：主题切换、版本号
 */
statusBarRegistry.register({ id: 'vault', align: 'left', render: VaultStatusItem });
statusBarRegistry.register({ id: 'theme', align: 'right', render: ThemeToggleItem });
statusBarRegistry.register({ id: 'version', align: 'right', render: VersionItem });

function VaultStatusItem() {
  const vault = useVault();
  if (!vault) return null;
  return (
    <span className="flex items-center gap-1.5" title={vault.root} data-testid="status-vault">
      <FolderGit2 className="size-3.5" />
      {vault.name}
    </span>
  );
}

function ThemeToggleItem() {
  const resolved = useThemeStore((s) => s.resolved);
  const setPreference = useThemeStore((s) => s.setPreference);
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      title={resolved === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
      onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
    >
      {resolved === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      {resolved === 'dark' ? '暗色' : '亮色'}
    </button>
  );
}

function VersionItem() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void invoke('app:getInfo')
      .then(setInfo)
      .catch(() => undefined);
  }, []);
  if (!info) return null;
  return (
    <span
      className="opacity-70"
      title={`Electron ${info.electronVersion} · ${info.platform}/${info.arch}`}
    >
      v{info.version}
    </span>
  );
}
