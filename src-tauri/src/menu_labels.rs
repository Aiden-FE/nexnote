//! Native application menu labels (DEV-124).
//!
//! The strings mirror `app.menu.*` in `packages/shared/src/i18n/message-catalog.ts`.
//! The native menu is built by the OS, not the renderer, so it cannot read the
//! renderer's catalog: the labels live here and are rebuilt when the persisted
//! language changes.

use serde_json::Value;

/// UI languages the app ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiLanguage {
    ZhCn,
    En,
}

impl UiLanguage {
    /// Parses the persisted `appearance.language`; anything unknown falls back
    /// to Simplified Chinese, matching the renderer default.
    pub fn parse(value: &str) -> Self {
        match value {
            "en" | "en-US" => Self::En,
            _ => Self::ZhCn,
        }
    }
}

/// One app-specific menu entry: id, localized label, accelerator, action.
struct MenuEntry {
    id: &'static str,
    zh: &'static str,
    en: &'static str,
    accelerator: &'static str,
    action: Value,
}

impl MenuEntry {
    fn label(&self, language: UiLanguage) -> &'static str {
        match language {
            UiLanguage::ZhCn => self.zh,
            UiLanguage::En => self.en,
        }
    }
}

/// The File submenu, grouped: new note / new binary / import / print.
fn file_entries() -> Vec<MenuEntry> {
    vec![
        MenuEntry {
            id: "menu-new-block",
            zh: "新建文档（块编辑）",
            en: "New document (block editing)",
            accelerator: "CmdOrCtrl+N",
            action: serde_json::json!({ "type": "createNote", "format": "native-block" }),
        },
        MenuEntry {
            id: "menu-new-md",
            zh: "新建 Markdown（源码模式）",
            en: "New Markdown (source mode)",
            accelerator: "CmdOrCtrl+Shift+N",
            action: serde_json::json!({ "type": "createNote", "format": "markdown" }),
        },
        MenuEntry {
            id: "menu-new-xlsx",
            zh: "新建空白 XLSX",
            en: "New blank XLSX",
            accelerator: "",
            action: serde_json::json!({ "type": "createBlankBinary", "kind": "xlsx" }),
        },
        MenuEntry {
            id: "menu-new-xmind",
            zh: "新建空白 XMind",
            en: "New blank XMind",
            accelerator: "",
            action: serde_json::json!({ "type": "createBlankBinary", "kind": "xmind" }),
        },
        MenuEntry {
            id: "menu-import-docx",
            zh: "导入 Word 文档（转为块文档）…",
            en: "Import Word document (convert to block document)…",
            accelerator: "",
            action: serde_json::json!({ "type": "importDocx" }),
        },
        MenuEntry {
            id: "menu-import-xlsx",
            zh: "导入 XLSX…",
            en: "Import XLSX…",
            accelerator: "",
            action: serde_json::json!({ "type": "importXlsx" }),
        },
        MenuEntry {
            id: "menu-import-xmind",
            zh: "导入 XMind…",
            en: "Import XMind…",
            accelerator: "",
            action: serde_json::json!({ "type": "importXmind" }),
        },
        MenuEntry {
            id: "menu-print",
            zh: "打印当前文档…",
            en: "Print current document…",
            accelerator: "CmdOrCtrl+P",
            action: serde_json::json!({ "type": "printDocument" }),
        },
    ]
}

/// Separator positions within the File submenu, matching the reference
/// grouping (new note / new binary / import / print).
const FILE_SEPARATORS_AFTER: [usize; 3] = [1, 3, 6];

/// One rendered menu item.
pub struct MenuItemSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub accelerator: &'static str,
    /// `true` when a separator follows this item.
    pub separator_after: bool,
}

/// The full menu spec for a language: File items plus their dispatched actions.
pub struct MenuSpec {
    pub file_items: Vec<MenuItemSpec>,
    pub file_title: &'static str,
    pub edit_title: &'static str,
    /// Menu id to `menu:action` payload.
    pub actions: Vec<(&'static str, Value)>,
}

/// Builds the menu for a language.
pub fn menu_spec(language: UiLanguage) -> MenuSpec {
    let entries = file_entries();
    let file_items = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| MenuItemSpec {
            id: entry.id,
            label: entry.label(language),
            accelerator: entry.accelerator,
            separator_after: FILE_SEPARATORS_AFTER.contains(&index),
        })
        .collect();
    let (file_title, edit_title) = match language {
        UiLanguage::ZhCn => ("文件", "编辑"),
        UiLanguage::En => ("File", "Edit"),
    };
    MenuSpec {
        file_items,
        file_title,
        edit_title,
        actions: entries
            .into_iter()
            .map(|entry| (entry.id, entry.action))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_parsing_falls_back_to_simplified_chinese() {
        assert_eq!(UiLanguage::parse("en"), UiLanguage::En);
        assert_eq!(UiLanguage::parse("en-US"), UiLanguage::En);
        assert_eq!(UiLanguage::parse("zh-CN"), UiLanguage::ZhCn);
        assert_eq!(UiLanguage::parse("nonsense"), UiLanguage::ZhCn);
    }

    #[test]
    fn every_entry_is_localized_in_both_languages() {
        let entries = file_entries();
        assert_eq!(entries.len(), 8, "the reference File submenu has 8 actions");
        for entry in &entries {
            assert!(!entry.zh.is_empty(), "{} missing zh-CN", entry.id);
            assert!(!entry.en.is_empty(), "{} missing en", entry.id);
            assert_ne!(entry.zh, entry.en, "{} is untranslated", entry.id);
        }
    }

    #[test]
    fn menu_spec_pairs_labels_with_actions() {
        let spec = menu_spec(UiLanguage::En);
        assert_eq!(spec.file_items.len(), 8);
        assert_eq!(spec.actions.len(), 8);
        // Every rendered item must have a matching dispatched action.
        for item in &spec.file_items {
            assert!(
                spec.actions.iter().any(|(id, _)| *id == item.id),
                "{} has no dispatched action",
                item.id
            );
        }
        assert_eq!(spec.file_items[0].label, "New document (block editing)");
        assert_eq!(spec.file_title, "File");
        assert_eq!(spec.edit_title, "Edit");
    }

    #[test]
    fn chinese_labels_match_the_shared_catalog() {
        let spec = menu_spec(UiLanguage::ZhCn);
        assert_eq!(spec.file_items[0].label, "新建文档（块编辑）");
        assert_eq!(spec.file_items[4].label, "导入 Word 文档（转为块文档）…");
        assert_eq!(spec.file_title, "文件");
    }

    #[test]
    fn print_and_new_note_keep_their_accelerators() {
        let spec = menu_spec(UiLanguage::ZhCn);
        assert_eq!(spec.file_items[0].accelerator, "CmdOrCtrl+N");
        assert_eq!(spec.file_items[1].accelerator, "CmdOrCtrl+Shift+N");
        assert_eq!(spec.file_items[7].accelerator, "CmdOrCtrl+P");
        // Binary/import entries intentionally have no accelerator.
        assert_eq!(spec.file_items[2].accelerator, "");
    }

    #[test]
    fn separators_group_new_note_binary_import_and_print() {
        let spec = menu_spec(UiLanguage::En);
        let grouped: Vec<&str> = spec
            .file_items
            .iter()
            .filter(|item| item.separator_after)
            .map(|item| item.id)
            .collect();
        assert_eq!(
            grouped,
            vec!["menu-new-md", "menu-new-xmind", "menu-import-xmind"]
        );
    }
}
