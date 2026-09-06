import { useEffect } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { useAiConfig, useAiWizard, needsOnboarding } from './ai-config';
import { ChatDock } from './chat/ChatDock';
import { Button } from '../../components/ui/button';

/**
 * 对话 dock 面板：
 * - 未配置 → 欢迎文案 + 配置入口（首启动 AI 引导向导）
 * - 已配置 → 正式对话 dock（DEV-012：流式回答 / 上下文注入 / 会话即页面 / 参考来源）
 */
export function AiDockPanel() {
  const state = useAiConfig((s) => s.state);
  const load = useAiConfig((s) => s.load);
  const showWizard = useAiWizard((s) => s.show);

  useEffect(() => {
    void load();
  }, [load]);

  if (needsOnboarding(state)) {
    return (
      <div data-testid="ai-dock-empty" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Sparkles className="size-5 text-primary" />
        </div>
        <p data-testid="ai-dock-welcome" className="text-sm font-medium text-foreground">欢迎使用 AI</p>
        <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
          连接 OpenAI、Azure 或本地模型，解锁写作辅助、对话与语义检索。密钥仅保存在本机系统钥匙串。
        </p>
        <Button data-testid="ai-dock-configure" size="sm" onClick={() => showWizard()}>
          <Bot className="size-3.5" />
          配置 AI 供应商
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
