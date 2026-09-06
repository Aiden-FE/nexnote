import { Sparkles } from 'lucide-react';
import { dockPanelRegistry } from '../../registries';
import { AiDockPanel } from '../ai/AiDockPanel';

/**
 * 右侧 dock 内置面板：AI 对话。
 * DEV-009：空态 = 欢迎 + 配置入口（引导向导）+ 迷你流式调试；DEV-012 在此接入完整对话 UI。
 */
dockPanelRegistry.register({
  id: 'ai-chat',
  title: 'AI 对话',
  icon: Sparkles,
  render: AiDockPanel,
});
