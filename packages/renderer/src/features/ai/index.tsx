import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bot } from 'lucide-react';
import { settingsSectionRegistry, commandRegistry } from '../../registries';
import {
  fetchAiStateOnce,
  initAiConfig,
  shouldAutoShowSetupPrompt,
  useAiWizard,
} from './ai-config';
import { AiSetupWizard } from './AiSetupWizard';
import { AiSettingsSection } from './AiSettingsSection';
import { openSettings } from '../../lib/open-settings';
import { useVault } from '../../shell/vault-context';

/**
 * AI 域装配点（DEV-009，DEV-026 收口）：
 * - 设置分区「AI 供应商」（Profile 管理 / 分功能指定 / 导入导出 / 调试）
 * - ⌘K 命令「AI 供应商设置」：一切配置入口统一收口到设置页
 * - 首启动 AI 引导（全局 modal）：仅 vault 首次就绪且未配置、未跳过时自动弹一次
 * - 订阅主进程 ai:configChanged，初始化脱敏配置状态
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
  keywords: [
    'ai',
    'provider',
    'profile',
    'llm',
    '配置',
    '供应商',
    'setup',
    'wizard',
    'onboarding',
    '引导',
    '向导',
  ],
  run: () => openSettings('ai'),
});

/** 全局 AI 覆盖层：首启动引导 modal（portal 到 body，避免被 dock 容器裁剪）。 */
export function AiGlobalLayer() {
  const vault = useVault();
  // 每个 app 会话只在 vault 第一次就绪时评估一次；后续切换/打开其他知识库不再自动弹。
  const evaluatedRef = useRef(false);

  useEffect(() => {
    initAiConfig();
  }, []);

  useEffect(() => {
    if (!vault || evaluatedRef.current) return;
    evaluatedRef.current = true;
    void (async () => {
      if (shouldAutoShowSetupPrompt(await fetchAiStateOnce())) {
        useAiWizard.getState().show();
      }
    })();
    // 只随 vault 是否就绪评估一次；配置状态经 store 异步拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault !== null]);

  return createPortal(<AiSetupWizard />, document.body);
}
