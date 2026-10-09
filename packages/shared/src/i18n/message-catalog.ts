/**
 * 桌面端消息目录（ADR-0023）：语义 key + `zh-CN` / `en-US` 两份词典。
 *
 * - 自研轻量方案，不引入 i18next 等运行时框架（与官网和应用既有轻依赖取向一致）。
 * - `zh-CN` 为兜底：key 缺失时回退中文，再回退 key 本身。
 * - 界面语言只影响用户可见文案，不改变页面正文、提交历史与 AI 提示词的语言。
 */

export const UI_LANGUAGES = ['zh-CN', 'en-US'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'zh-CN';

/** 词典值可为字符串，或按 `locale`（`en-US` / 其他）挑选的分支。 */
export type MessageValue = string | { readonly enUS: string; readonly zhCN?: string };

export type MessageCatalog = Readonly<Record<string, MessageValue>>;

/** 判断字符串是否为合法界面语言；非法值一律回退默认语言。 */
export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'zh-CN' || value === 'en-US';
}

/** 首次启动按系统语言初始化：`zh*` → `zh-CN`，其余 → `en-US`（ADR-0023）。 */
export function uiLanguageFromSystem(
  systemLanguages: readonly string[] | undefined | null,
): UiLanguage {
  const primary = systemLanguages?.[0] ?? '';
  return primary.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function pick(value: MessageValue, language: UiLanguage): string | undefined {
  if (typeof value === 'string') return value;
  return language === 'en-US' ? value.enUS : (value.zhCN ?? value.enUS);
}

/**
 * 按界面语言取文案。
 *
 * - key 缺失或值为空时回退 `zh-CN`，再回退 key 本身（让缺失可见而非静默空白）。
 */
export function translate(
  catalog: MessageCatalog,
  key: string,
  language: UiLanguage,
  params?: Readonly<Record<string, string | number>>,
): string {
  const baseline: MessageCatalog = MESSAGES_ZH_CN;
  const raw = catalog[key] ?? baseline[key];
  const template = raw === undefined ? key : (pick(raw, language) ?? key);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** 简体中文词典（兜底与术语基线）。 */
export const MESSAGES_ZH_CN = {
  // —— 通用
  'common.ok': '确定',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.save': '保存',
  'common.delete': '删除',
  'common.rename': '重命名',
  'common.copy': '复制',
  'common.search': '搜索',

  // —— 设置：外观
  'settings.appearance.title': '外观',
  'settings.appearance.description': '主题、字体与语言',
  'settings.appearance.theme': '主题',
  'settings.appearance.theme.description': '浅色、深色或跟随系统',
  'settings.appearance.theme.system': '跟随系统',
  'settings.appearance.theme.light': '浅色',
  'settings.appearance.theme.dark': '深色',
  'settings.appearance.language': '语言',
  'settings.appearance.language.description': '界面显示语言',
  'settings.appearance.language.zhCN': '简体中文',
  'settings.appearance.language.enUS': 'English',
  'settings.appearance.uiFont': 'UI 字体',
  'settings.appearance.uiFont.description': 'CSS 字体族列表',
  'settings.appearance.editorFont': '编辑器字体',
  'settings.appearance.editorFont.description': '编辑器与等宽文本字体族',
  'settings.appearance.uiFontSize': 'UI 字号',
  'settings.appearance.editorFontSize': '编辑器字号',

  // —— 设置：启动
  'settings.startup.title': '启动',
  'settings.startup.description': '应用打开时的行为',
  'settings.startup.behavior': '启动时',
  'settings.startup.behavior.description': '打开上次知识库、走向导或打开特定知识库',
  'settings.startup.behavior.restore': '恢复上次知识库',
  'settings.startup.behavior.welcome': '显示欢迎页',
  'settings.startup.behavior.specificVault': '打开特定知识库',

  // —— 设置：帮助
  'settings.help.title': '帮助',
  'settings.help.description': '查阅产品文档与重新查看产品使用引导',
  'settings.help.productDocs': '产品文档',
  'settings.help.productDocs.description': '在系统默认浏览器中打开官网快速上手文档',
  'settings.help.productDocs.open': '打开产品文档',
  'settings.help.tour': '新手引导',
  'settings.help.tour.description': '分步了解页面树、编辑器、AI 与版本时间线等核心区域',
  'settings.help.tour.replay': '重新播放',

  // —— 设置：翻译默认目标语言
  'settings.translation.title': '翻译',
  'settings.translation.description': '划词 / 全文翻译与翻译工作台的默认目标语言',
  'settings.translation.targetLanguage': '默认目标语言',
  'settings.translation.followInterface': '跟随界面语言',
  'settings.translation.followInterfaceWith': '跟随界面语言（{language}）',
  'settings.translation.overrideHint': '触发点临时切换仅影响当次翻译',
  "settings.section.general": "常规",
  "settings.section.editor": "编辑器",
  "settings.section.git": "Git",
  "settings.section.network": "网络",
  "settings.section.shortcuts": "快捷键",
  "settings.section.about": "关于",
  "settings.section.ai": "AI 供应商",
  "settings.section.plugins": "插件",
  "settings.section.skills": "检索 Skill",
  "settings.section.updates": "更新",
  "settings.page.title": "设置",
  "settings.page.search": "搜索设置",
  "settings.page.searchPlaceholder": "搜索设置项…",
  "settings.page.searching": "搜索中…",
  "settings.page.noResults": "没有找到与 “{query}” 相关的设置",
  "settings.page.searchFailed": "搜索失败，请稍后再试",
  "settings.page.searchResultsLabel": "设置搜索结果",
  "settings.loading": "加载中…",
    "settings.search.about.version": "版本信息",
    "settings.search.ai.section": "AI 设置",
    "settings.search.ai.translationTargetLanguage": "翻译默认目标语言",
    "settings.search.appearance.editorFontFamily": "编辑器字体",
    "settings.search.appearance.editorFontSize": "编辑器字号",
    "settings.search.appearance.language": "语言",
    "settings.search.appearance.theme": "主题",
    "settings.search.appearance.uiFontFamily": "UI 字体",
    "settings.search.appearance.uiFontSize": "UI 字号",
    "settings.search.binary.maxConcurrentTabs": "二进制文档编辑器并发上限",
    "settings.search.editor.autoSaveMs": "自动保存间隔",
    "settings.search.editor.bindFileNameToTitle": "文件名与标题联动",
    "settings.search.editor.codeTheme": "代码块主题",
    "settings.search.editor.defaultPageTemplate": "默认新页面模板",
    "settings.search.editor.vimMode": "Vim 模式",
    "settings.search.git.autoCommit": "自动提交",
    "settings.search.git.autoCommitIntervalMs": "自动提交间隔",
    "settings.search.git.binaryUntrack": "二进制文档不随 Git 跟踪",
    "settings.search.git.commitMessageTemplate": "自动提交消息模板",
    "settings.search.git.defaultBranch": "默认分支名",
    "settings.search.git.useSystemGit": "使用系统 Git",
    "settings.search.network.aiProxy": "AI 独立代理",
    "settings.search.network.applyToGit": "代理 Git 操作",
    "settings.search.network.bypass": "绕过主机",
    "settings.search.network.gitProxy": "Git 独立代理",
    "settings.search.network.host": "代理主机与端口",
    "settings.search.network.mode": "网络模式",
    "settings.search.plugins.section": "插件",
    "settings.search.shortcuts.export": "导出快捷键",
    "settings.search.shortcuts.import": "导入快捷键",
    "settings.search.shortcuts.list": "快捷键",
    "settings.search.skills.section": "检索 Skill",
    "settings.search.startup.behavior": "启动行为",
    "settings.search.updates.autoDownload": "自动下载更新",
    "settings.search.updates.channel": "更新通道",
    "settings.search.updates.checkOnLaunch": "启动时检查更新",
} as const satisfies MessageCatalog;

/** English catalog. */
export const MESSAGES_EN_US = {
  // —— Common
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.rename': 'Rename',
  'common.copy': 'Copy',
  'common.search': 'Search',

  // —— Settings: appearance
  'settings.appearance.title': 'Appearance',
  'settings.appearance.description': 'Theme, fonts, and language',
  'settings.appearance.theme': 'Theme',
  'settings.appearance.theme.description': 'Light, dark, or match system',
  'settings.appearance.theme.system': 'Match system',
  'settings.appearance.theme.light': 'Light',
  'settings.appearance.theme.dark': 'Dark',
  'settings.appearance.language': 'Language',
  'settings.appearance.language.description': 'Interface display language',
  'settings.appearance.language.zhCN': '简体中文',
  'settings.appearance.language.enUS': 'English',
  'settings.appearance.uiFont': 'UI font',
  'settings.appearance.uiFont.description': 'CSS font-family list',
  'settings.appearance.editorFont': 'Editor font',
  'settings.appearance.editorFont.description': 'Font family for editor and monospace text',
  'settings.appearance.uiFontSize': 'UI font size',
  'settings.appearance.editorFontSize': 'Editor font size',

  // —— Settings: startup
  'settings.startup.title': 'Startup',
  'settings.startup.description': 'What happens when the app opens',
  'settings.startup.behavior': 'On launch',
  'settings.startup.behavior.description': 'Reopen the last vault, show the wizard, or open a specific vault',
  'settings.startup.behavior.restore': 'Reopen last vault',
  'settings.startup.behavior.welcome': 'Show welcome page',
  'settings.startup.behavior.specificVault': 'Open a specific vault',

  // —— Settings: help
  'settings.help.title': 'Help',
  'settings.help.description': 'Read the product documentation or replay the in-app tour',
  'settings.help.productDocs': 'Product documentation',
  'settings.help.productDocs.description': 'Open the getting-started docs in your default browser',
  'settings.help.productDocs.open': 'Open docs',
  'settings.help.tour': 'Guided tour',
  'settings.help.tour.description':
    'Walk through the page tree, editor, AI, and version timeline step by step',
  'settings.help.tour.replay': 'Replay',

  // —— Settings: default translation target language
  'settings.translation.title': 'Translation',
  'settings.translation.description':
    'Default target language for selection and full-page translation',
  'settings.translation.targetLanguage': 'Default target language',
  'settings.translation.followInterface': 'Match interface language',
  'settings.translation.followInterfaceWith': 'Match interface language ({language})',
  'settings.translation.overrideHint': 'Switching at a trigger point only affects that translation',
  "settings.section.general": "General",
  "settings.section.editor": "Editor",
  "settings.section.git": "Git",
  "settings.section.network": "Network",
  "settings.section.shortcuts": "Shortcuts",
  "settings.section.about": "About",
  "settings.section.ai": "AI providers",
  "settings.section.plugins": "Plugins",
  "settings.section.skills": "Retrieval skills",
  "settings.section.updates": "Updates",
  "settings.page.title": "Settings",
  "settings.page.search": "Search settings",
  "settings.page.searchPlaceholder": "Search settings…",
  "settings.page.searching": "Searching…",
  "settings.page.noResults": "No settings matching “{query}”",
  "settings.page.searchFailed": "Search failed; try again later",
  "settings.page.searchResultsLabel": "Settings search results",
  "settings.loading": "Loading…",
    "settings.search.about.version": "Version",
    "settings.search.ai.section": "AI settings",
    "settings.search.ai.translationTargetLanguage": "Default translation target language",
    "settings.search.appearance.editorFontFamily": "Editor font",
    "settings.search.appearance.editorFontSize": "Editor font size",
    "settings.search.appearance.language": "Language",
    "settings.search.appearance.theme": "Theme",
    "settings.search.appearance.uiFontFamily": "UI font",
    "settings.search.appearance.uiFontSize": "UI font size",
    "settings.search.binary.maxConcurrentTabs": "Concurrent binary document editors",
    "settings.search.editor.autoSaveMs": "Auto-save interval",
    "settings.search.editor.bindFileNameToTitle": "Keep file name and title in sync",
    "settings.search.editor.codeTheme": "Code block theme",
    "settings.search.editor.defaultPageTemplate": "Default page template",
    "settings.search.editor.vimMode": "Vim mode",
    "settings.search.git.autoCommit": "Auto commit",
    "settings.search.git.autoCommitIntervalMs": "Auto-commit interval",
    "settings.search.git.binaryUntrack": "Keep binary documents out of Git",
    "settings.search.git.commitMessageTemplate": "Auto-commit message template",
    "settings.search.git.defaultBranch": "Default branch name",
    "settings.search.git.useSystemGit": "Use system Git",
    "settings.search.network.aiProxy": "Separate proxy for AI",
    "settings.search.network.applyToGit": "Proxy Git operations",
    "settings.search.network.bypass": "Bypass hosts",
    "settings.search.network.gitProxy": "Separate proxy for Git",
    "settings.search.network.host": "Proxy host and port",
    "settings.search.network.mode": "Network mode",
    "settings.search.plugins.section": "Plugins",
    "settings.search.shortcuts.export": "Export shortcuts",
    "settings.search.shortcuts.import": "Import shortcuts",
    "settings.search.shortcuts.list": "Keyboard shortcuts",
    "settings.search.skills.section": "Retrieval skills",
    "settings.search.startup.behavior": "Startup behavior",
    "settings.search.updates.autoDownload": "Download updates automatically",
    "settings.search.updates.channel": "Update channel",
    "settings.search.updates.checkOnLaunch": "Check for updates on launch",
} as const satisfies MessageCatalog;

export const CATALOGS: Readonly<Record<UiLanguage, MessageCatalog>> = {
  'zh-CN': MESSAGES_ZH_CN,
  'en-US': MESSAGES_EN_US,
};

/** 该语言下缺失的 key（`zh-CN` 视为基线，不计缺失）。 */
export function missingKeys(language: UiLanguage): string[] {
  const baseline = Object.keys(MESSAGES_ZH_CN);
  const catalog = CATALOGS[language];
  return baseline.filter((key) => catalog[key] === undefined);
}
