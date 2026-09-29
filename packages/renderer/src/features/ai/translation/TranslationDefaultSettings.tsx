import { useEffect } from 'react';
import { fetchAiStateOnce, useAiConfig } from '../ai-config';
import { invoke } from '../../../lib/ipc';
import { useSettingsStore } from '../../../stores/settings-store';
import { TRANSLATION_LANGUAGES, mapInterfaceLanguageToTranslationTarget } from './languages';

/**
 * 翻译默认目标语言（渲染在设置页 · 常规分区）：
 * 数据仍归 AI 域（ai:translation:setTargetLanguage），此处只承载 UI。
 * 首项「跟随界面语言」表示未显式指定时跟随设置内的语言选项。
 */
export function TranslationDefaultSettings() {
  const state = useAiConfig((s) => s.state);
  const apply = useAiConfig((s) => s.apply);
  const appLanguage = useSettingsStore((s) => s.global?.appearance.language);
  const effectiveFromAppLang = mapInterfaceLanguageToTranslationTarget(appLanguage);

  useEffect(() => {
    void fetchAiStateOnce();
  }, []);

  const setTargetLanguage = async (targetLanguage: string): Promise<void> => {
    const { state: next } = await invoke('ai:translation:setTargetLanguage', { targetLanguage });
    apply(next);
  };

  return (
    <label className="flex items-center gap-3 rounded-lg border p-2.5 text-[13px]">
      <span className="w-28 shrink-0 font-medium">默认目标语言</span>
      <select
        data-testid="ai-translation-target-language"
        value={state?.translationTargetLanguage ?? ''}
        onChange={(e) => void setTargetLanguage(e.target.value)}
        className="h-8 rounded-md border bg-transparent px-2 text-xs"
      >
        <option value="">
          跟随界面语言{effectiveFromAppLang ? `（${effectiveFromAppLang}）` : ''}
        </option>
        {TRANSLATION_LANGUAGES.map((language) => (
          <option key={language.id} value={language.id}>
            {language.label}
          </option>
        ))}
      </select>
      <span className="ml-auto text-[11px] text-muted-foreground">
        触发点临时切换仅影响当次翻译
      </span>
    </label>
  );
}
