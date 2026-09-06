import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bot } from 'lucide-react';
import { settingsSectionRegistry, commandRegistry } from '../../registries';
import { useAiWizard, initAiConfig, aiEntryOrWizard } from './ai-config';
import { AiSetupWizard } from './AiSetupWizard';
import { AiSettingsSection } from './AiSettingsSection';
import { openSettings } from '../../lib/open-settings';

/**
 * AI 域装配点（DEV-009）：
 * - 设置分区「AI 供应商」（Profile 管理 / 分功能指定 / 导入导出 / 调试）
 * - 首启动引导向导（全局 modal，未配置时由 AI 入口触发）
 * - ⌘K 命令（AI 设置 / AI 引导）
 * - 订阅主进程 ai:configChanged，初始化脱敏配置状态
 * DEV-010（写作辅助）/ DEV-012（对话）在此追加更多入口与命令。
 */

initAiConfig();

settingsSectionRegistry.register({
  id: 'ai',
  title: 'AI 供应商',
  icon: Bot,
  order: 15,
  render: AiSettingsSection,
});

commandRegistry.register({
  id: 'ai.settings',
  title: 'AI 供应商设置',
  category: 'AI',
  keywords: ['ai', 'provider', 'profile', 'llm', '配置', '供应商'],
  run: () => openSettings('ai'),
});

commandRegistry.register({
  id: 'ai.setup',
  title: '配置 AI 供应商（引导向导）',
  category: 'AI',
  keywords: ['ai', 'setup', 'wizard', 'onboarding', '向导', '引导'],
  run: () => aiEntryOrWizard(() => useAiWizard.getState().show()),
});

/** 全局 AI 覆盖层：引导向导 modal（portal 到 body，避免被 dock 容器裁剪）。 */
export function AiGlobalLayer() {
  useEffect(() => {
    initAiConfig();
  }, []);
  return createPortal(<AiSetupWizard />, document.body);
}
