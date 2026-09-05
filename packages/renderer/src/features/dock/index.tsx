import { Sparkles } from 'lucide-react';
import { dockPanelRegistry } from '../../registries';

/** 右侧 dock 内置面板：AI 对话占位。DEV-012 在此接入真实对话 UI（或并行注册新面板）。 */
dockPanelRegistry.register({
  id: 'ai-chat',
  title: 'AI 对话',
  icon: Sparkles,
  render: AiChatPlaceholder,
});

function AiChatPlaceholder() {
  return (
    <div data-testid="dock-panel-ai-chat" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Sparkles className="size-5" />
      </div>
      <p className="text-sm font-medium text-foreground">AI 对话 Dock</p>
      <p className="max-w-52 text-xs leading-relaxed">
        将在 DEV-012 接入：上下文注入选择、参考来源展示、会话即页面（type: chat）。
      </p>
    </div>
  );
}
