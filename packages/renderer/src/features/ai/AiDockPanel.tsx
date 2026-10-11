import { useEffect } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { useAiConfig, needsOnboarding } from './ai-config';
import { ChatDock } from './chat/ChatDock';
import { Button } from '../../components/ui/button';
import { openSettings } from '../../lib/open-settings';
import { useI18n } from '../../lib/i18n';

/**
 * 对话 dock 面板：
 * - 未配置 → 欢迎文案 + 配置入口（统一跳设置页「AI 供应商」分区）
 * - 已配置 → 正式对话 dock（DEV-012：流式回答 / 上下文注入 / 会话即页面 / 参考来源）
 */
export function AiDockPanel() {
  const t = useI18n();
  const state = useAiConfig((s) => s.state);
  const load = useAiConfig((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (needsOnboarding(state)) {
    return (
      <div
        data-testid="ai-dock-empty"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Sparkles className="size-5 text-primary" />
        </div>
        <p data-testid="ai-dock-welcome" className="text-sm font-medium text-foreground">
          {t('ai.dock.welcome')}
        </p>
        <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
          {t('ai.dock.description')}
        </p>
        <Button data-testid="ai-dock-configure" size="sm" onClick={() => openSettings('ai')}>
          <Bot className="size-3.5" />
          {t('ai.dock.configure')}
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="ai-dock-ready" className="h-full min-h-0">
      <ChatDock />
    </div>
  );
}
