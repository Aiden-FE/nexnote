//! Bilingual settings search index (DEV-118).
//!
//! The renderer remains responsible for presentation, but the backend must not
//! return an empty result set: it owns the stable entry ids and searches both
//! catalog languages plus explicit keywords.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingSearchEntry {
    pub id: &'static str,
    pub section_id: &'static str,
    pub title_key: &'static str,
    pub keywords: &'static [&'static str],
    pub scope: &'static str,
}

macro_rules! setting {
    ($id:literal, $section:literal, $title:literal, $keywords:expr, $scope:literal) => {
        SettingSearchEntry {
            id: $id,
            section_id: $section,
            title_key: $title,
            keywords: &$keywords,
            scope: $scope,
        }
    };
}

pub const SEARCH_ENTRIES: &[SettingSearchEntry] = &[
    setting!(
        "appearance.theme",
        "general",
        "settings.search.appearance.theme",
        ["theme", "dark", "light", "system", "暗色", "亮色", "系统", "主题"],
        "global"
    ),
    setting!(
        "appearance.language",
        "general",
        "settings.search.appearance.language",
        ["language", "locale", "中文", "english", "语言"],
        "global"
    ),
    setting!(
        "appearance.uiFontFamily",
        "general",
        "settings.search.appearance.uiFontFamily",
        ["font", "ui", "字体", "界面"],
        "global"
    ),
    setting!(
        "appearance.uiFontSize",
        "general",
        "settings.search.appearance.uiFontSize",
        ["font", "size", "ui", "字号"],
        "global"
    ),
    setting!(
        "appearance.editorFontFamily",
        "editor",
        "settings.search.appearance.editorFontFamily",
        ["font", "editor", "字体", "编辑器"],
        "global"
    ),
    setting!(
        "appearance.editorFontSize",
        "editor",
        "settings.search.appearance.editorFontSize",
        ["font", "size", "editor", "字号"],
        "global"
    ),
    setting!(
        "updates.checkOnLaunch",
        "updates",
        "settings.search.updates.checkOnLaunch",
        ["update", "auto", "更新", "自动", "启动"],
        "global"
    ),
    setting!(
        "updates.autoDownload",
        "updates",
        "settings.search.updates.autoDownload",
        ["update", "download", "自动下载", "更新"],
        "global"
    ),
    setting!(
        "updates.channel",
        "updates",
        "settings.search.updates.channel",
        ["update", "channel", "stable", "beta", "alpha", "通道", "更新"],
        "global"
    ),
    setting!(
        "startup.behavior",
        "general",
        "settings.search.startup.behavior",
        ["startup", "launch", "启动", "恢复", "welcome", "特定"],
        "global"
    ),
    setting!(
        "git.useSystemGit",
        "git",
        "settings.search.git.useSystemGit",
        ["git", "system", "binary", "bundled", "系统"],
        "global"
    ),
    setting!(
        "editor.autoSaveMs",
        "editor",
        "settings.search.editor.autoSaveMs",
        ["autosave", "save", "debounce", "自动保存"],
        "vault"
    ),
    setting!(
        "editor.defaultPageTemplate",
        "editor",
        "settings.search.editor.defaultPageTemplate",
        ["template", "模板", "默认", "new"],
        "vault"
    ),
    setting!(
        "editor.bindFileNameToTitle",
        "editor",
        "settings.search.editor.bindFileNameToTitle",
        ["title", "bind", "h1", "标题", "联动"],
        "vault"
    ),
    setting!(
        "editor.vimMode",
        "editor",
        "settings.search.editor.vimMode",
        ["vim", "编辑器", "模态"],
        "vault"
    ),
    setting!(
        "editor.codeTheme",
        "editor",
        "settings.search.editor.codeTheme",
        ["code", "theme", "syntax", "代码", "高亮"],
        "vault"
    ),
    setting!(
        "git.autoCommit",
        "git",
        "settings.search.git.autoCommit",
        ["git", "auto", "commit", "自动提交"],
        "vault"
    ),
    setting!(
        "git.autoCommitIntervalMs",
        "git",
        "settings.search.git.autoCommitIntervalMs",
        ["git", "interval", "间隔", "提交"],
        "vault"
    ),
    setting!(
        "git.commitMessageTemplate",
        "git",
        "settings.search.git.commitMessageTemplate",
        ["git", "message", "template", "提交", "模板"],
        "vault"
    ),
    setting!(
        "git.defaultBranch",
        "git",
        "settings.search.git.defaultBranch",
        ["git", "branch", "default", "分支"],
        "vault"
    ),
    setting!(
        "shortcuts.list",
        "shortcuts",
        "settings.search.shortcuts.list",
        ["keyboard", "shortcut", "热键", "快捷键"],
        "global"
    ),
    setting!(
        "shortcuts.import",
        "shortcuts",
        "settings.search.shortcuts.import",
        ["import", "导入"],
        "global"
    ),
    setting!(
        "shortcuts.export",
        "shortcuts",
        "settings.search.shortcuts.export",
        ["export", "导出"],
        "global"
    ),
    setting!(
        "ai.section",
        "ai",
        "settings.search.ai.section",
        ["ai", "model", "api", "人工智能", "模型", "profile", "设置"],
        "domain"
    ),
    setting!(
        "plugins.section",
        "plugins",
        "settings.search.plugins.section",
        ["plugin", "extension", "插件", "扩展"],
        "domain"
    ),
    setting!(
        "skills.section",
        "skills",
        "settings.search.skills.section",
        ["skill", "检索", "召回", "技能"],
        "domain"
    ),
    setting!(
        "about.version",
        "about",
        "settings.search.about.version",
        ["version", "about", "版本", "关于"],
        "global"
    ),
    setting!(
        "network.mode",
        "network",
        "settings.search.network.mode",
        ["network", "proxy", "代理", "system", "跟随系统", "网络"],
        "global"
    ),
    setting!(
        "network.applyToGit",
        "network",
        "settings.search.network.applyToGit",
        ["network", "git", "proxy", "代理", "网络"],
        "global"
    ),
    setting!(
        "network.aiProxy",
        "network",
        "settings.search.network.aiProxy",
        ["network", "ai", "proxy", "独立", "代理", "人工智能"],
        "global"
    ),
    setting!(
        "network.gitProxy",
        "network",
        "settings.search.network.gitProxy",
        ["network", "git", "proxy", "独立", "代理", "网络"],
        "global"
    ),
    setting!(
        "network.host",
        "network",
        "settings.search.network.host",
        ["network", "host", "port", "proxy", "主机", "端口", "代理"],
        "global"
    ),
    setting!(
        "network.bypass",
        "network",
        "settings.search.network.bypass",
        ["network", "bypass", "proxy", "绕过", "直连", "代理"],
        "global"
    ),
    setting!(
        "ai.translationTargetLanguage",
        "general",
        "settings.search.ai.translationTargetLanguage",
        ["ai", "translation", "翻译", "目标语言", "语言"],
        "domain"
    ),
    setting!(
        "git.binaryUntrack",
        "git",
        "settings.search.git.binaryUntrack",
        [
            "git",
            "binary",
            "docx",
            "xlsx",
            "xmind",
            "gitignore",
            "跟踪",
            "二进制"
        ],
        "vault"
    ),
    setting!(
        "binary.maxConcurrentTabs",
        "editor",
        "settings.search.binary.maxConcurrentTabs",
        [
            "binary",
            "docx",
            "xlsx",
            "xmind",
            "tab",
            "并发",
            "编辑器",
            "DEV-074"
        ],
        "vault"
    ),
];

const TITLE_ZH: &[(&str, &str)] = &[
    ("settings.search.appearance.theme", "主题"),
    ("settings.search.appearance.language", "语言"),
    ("settings.search.appearance.uiFontFamily", "UI 字体"),
    ("settings.search.appearance.uiFontSize", "UI 字号"),
    ("settings.search.appearance.editorFontFamily", "编辑器字体"),
    ("settings.search.appearance.editorFontSize", "编辑器字号"),
    ("settings.search.updates.checkOnLaunch", "启动时检查更新"),
    ("settings.search.updates.autoDownload", "自动下载更新"),
    ("settings.search.updates.channel", "更新通道"),
    ("settings.search.startup.behavior", "启动行为"),
    ("settings.search.git.useSystemGit", "使用系统 Git"),
    ("settings.search.editor.autoSaveMs", "自动保存间隔"),
    (
        "settings.search.editor.defaultPageTemplate",
        "默认新页面模板",
    ),
    (
        "settings.search.editor.bindFileNameToTitle",
        "文件名与标题联动",
    ),
    ("settings.search.editor.vimMode", "Vim 模式"),
    ("settings.search.editor.codeTheme", "代码块主题"),
    ("settings.search.git.autoCommit", "自动提交"),
    ("settings.search.git.autoCommitIntervalMs", "自动提交间隔"),
    (
        "settings.search.git.commitMessageTemplate",
        "自动提交消息模板",
    ),
    ("settings.search.git.defaultBranch", "默认分支名"),
    ("settings.search.shortcuts.list", "快捷键"),
    ("settings.search.shortcuts.import", "导入快捷键"),
    ("settings.search.shortcuts.export", "导出快捷键"),
    ("settings.search.ai.section", "AI 设置"),
    ("settings.search.plugins.section", "插件"),
    ("settings.search.skills.section", "检索 Skill"),
    ("settings.search.about.version", "版本信息"),
    ("settings.search.network.mode", "网络模式"),
    ("settings.search.network.applyToGit", "代理 Git 操作"),
    ("settings.search.network.aiProxy", "AI 独立代理"),
    ("settings.search.network.gitProxy", "Git 独立代理"),
    ("settings.search.network.host", "代理主机与端口"),
    ("settings.search.network.bypass", "绕过主机"),
    (
        "settings.search.ai.translationTargetLanguage",
        "翻译默认目标语言",
    ),
    (
        "settings.search.git.binaryUntrack",
        "二进制文档不随 Git 跟踪",
    ),
    (
        "settings.search.binary.maxConcurrentTabs",
        "二进制文档编辑器并发上限",
    ),
];

const TITLE_EN: &[(&str, &str)] = &[
    ("settings.search.appearance.theme", "Theme"),
    ("settings.search.appearance.language", "Language"),
    ("settings.search.appearance.uiFontFamily", "UI font"),
    ("settings.search.appearance.uiFontSize", "UI font size"),
    ("settings.search.appearance.editorFontFamily", "Editor font"),
    (
        "settings.search.appearance.editorFontSize",
        "Editor font size",
    ),
    (
        "settings.search.updates.checkOnLaunch",
        "Check for updates on launch",
    ),
    (
        "settings.search.updates.autoDownload",
        "Download updates automatically",
    ),
    ("settings.search.updates.channel", "Update channel"),
    ("settings.search.startup.behavior", "Startup behavior"),
    ("settings.search.git.useSystemGit", "Use system Git"),
    ("settings.search.editor.autoSaveMs", "Auto-save interval"),
    (
        "settings.search.editor.defaultPageTemplate",
        "Default new page template",
    ),
    (
        "settings.search.editor.bindFileNameToTitle",
        "Keep file name and title in sync",
    ),
    ("settings.search.editor.vimMode", "Vim mode"),
    ("settings.search.editor.codeTheme", "Code block theme"),
    ("settings.search.git.autoCommit", "Auto commit"),
    (
        "settings.search.git.autoCommitIntervalMs",
        "Auto-commit interval",
    ),
    (
        "settings.search.git.commitMessageTemplate",
        "Auto-commit message template",
    ),
    ("settings.search.git.defaultBranch", "Default branch name"),
    ("settings.search.shortcuts.list", "Keyboard shortcuts"),
    ("settings.search.shortcuts.import", "Import shortcuts"),
    ("settings.search.shortcuts.export", "Export shortcuts"),
    ("settings.search.ai.section", "AI settings"),
    ("settings.search.plugins.section", "Plugins"),
    ("settings.search.skills.section", "Retrieval skills"),
    ("settings.search.about.version", "Version"),
    ("settings.search.network.mode", "Network mode"),
    ("settings.search.network.applyToGit", "Proxy Git operations"),
    ("settings.search.network.aiProxy", "Separate proxy for AI"),
    ("settings.search.network.gitProxy", "Separate proxy for Git"),
    ("settings.search.network.host", "Proxy host and port"),
    ("settings.search.network.bypass", "Bypass hosts"),
    (
        "settings.search.ai.translationTargetLanguage",
        "Default translation target language",
    ),
    (
        "settings.search.git.binaryUntrack",
        "Keep binary documents out of Git",
    ),
    (
        "settings.search.binary.maxConcurrentTabs",
        "Concurrent binary document editors",
    ),
];

pub fn search(query: &str) -> Vec<&'static SettingSearchEntry> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    SEARCH_ENTRIES
        .iter()
        .filter(|entry| searchable_text(entry).contains(&query))
        .collect()
}

fn searchable_text(entry: &SettingSearchEntry) -> String {
    let zh = title(TITLE_ZH, entry.title_key);
    let en = title(TITLE_EN, entry.title_key);
    format!("{} {} {} {}", entry.id, entry.keywords.join(" "), zh, en).to_lowercase()
}

fn title<'a>(catalog: &'a [(&'a str, &'a str)], key: &'a str) -> &'a str {
    catalog
        .iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, title)| *title)
        .unwrap_or(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_ids_keywords_and_both_catalog_languages() {
        assert!(search("appearance.theme")
            .iter()
            .any(|e| e.id == "appearance.theme"));
        assert!(search("主题").iter().any(|e| e.id == "appearance.theme"));
        assert!(search("editor font")
            .iter()
            .any(|e| e.id == "appearance.editorFontFamily"));
        assert!(search("代理").iter().any(|e| e.id == "network.mode"));
    }

    #[test]
    fn blank_queries_return_no_entries() {
        assert!(search("   ").is_empty());
    }
}
