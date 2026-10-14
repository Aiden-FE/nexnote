# Tauri 迁移契约矩阵（DEV-115）

> 生成日期：2026-10-14 · 覆盖 `IPC_CHANNELS`（154 条）与 `IPC_EVENT_CHANNELS`（16 条）。

本矩阵是 DEV-ARCH-002 全面迁移的单一事实源：每个 channel/event 都有唯一条目，记录数据所有权、副作用、Electron handler 位置、Tauri 目标模块、迁移批次和当前状态。后续子票按批次推进，Rust 实现完成后将对应状态从 `pending` 改为 `ported`。

## 列说明

| 列 | 含义 |
| --- | --- |
| 所有权 | 数据/状态的权威持有者：app-state（应用级状态）、vault（vault 内文件/配置）、sqlite（index.db）、remote-provider（远端 AI 服务）、plugin（插件快照/RPC）、host（窗口/系统交互） |
| persist | 是否持久化到磁盘 |
| net | 是否触发网络请求 |
| fs | 是否访问文件系统 |
| proc | 是否启动外部进程 |
| Electron handler | 当前实现位置 |
| Tauri target | Rust 目标模块/命令 |
| batch | 迁移批次（foundation / vault / git / ai / plugin / binary-print / updater / retire） |
| status | pending（未迁移） / ported（已迁移） / explicitly-unsupported（明确不支持） / electron-only（仅 Electron 可用） |

## App

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| app:getInfo | app-state | no | no | no | no | `app-handlers.ts` | `product::app_info` | foundation | pending |
| app:checkForUpdates | remote-provider | no | yes | no | no | `app-handlers.ts` | `updater::check` | updater | pending |
| app:downloadUpdate | remote-provider | yes | yes | yes | no | `app-handlers.ts` | `updater::download` | updater | pending |
| app:installUpdate | host | yes | no | yes | yes | `app-handlers.ts` | `updater::install` | updater | pending |
| app:setUpdateChannel | app-state | yes | no | yes | no | `app-handlers.ts` | `product::set_update_channel` | foundation | pending |
| app:getUpdateSettings | app-state | yes | no | yes | no | `app-handlers.ts` | `product::get_update_settings` | foundation | pending |
| app:setUpdateSettings | app-state | yes | no | yes | no | `app-handlers.ts` | `product::set_update_settings` | foundation | pending |

## Vault

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vault:getState | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_get_state` | foundation | pending |
| vault:pickDirectory | host | no | no | no | no | `vault-handlers.ts` | `product::vault_pick_dir` | foundation | pending |
| vault:create | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_create` | vault | pending |
| vault:open | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_open` | vault | pending |
| vault:clone | vault | yes | yes | yes | yes | `vault-handlers.ts` | `vault::clone` | git | pending |
| vault:initGit | vault | yes | no | yes | yes | `vault-handlers.ts` | `git::init` | git | pending |
| vault:inspect | vault | no | no | yes | no | `vault-handlers.ts` | `product::vault_inspect` | vault | pending |
| vault:clonePreflight | remote-provider | no | yes | no | no | `vault-handlers.ts` | `git::clone_preflight` | git | pending |
| vault:cancelOperation | app-state | no | no | no | no | `vault-handlers.ts` | `vault::cancel_op` | vault | pending |
| vault:close | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_close` | foundation | pending |
| vault:listRecent | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_list_recent` | foundation | pending |
| vault:removeRecent | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_remove_recent` | foundation | pending |
| vault:getLayout | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_get_layout` | vault | pending |
| vault:saveLayout | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_save_layout` | vault | pending |
| vault:reveal | host | no | no | no | no | `vault-handlers.ts` | `product::vault_reveal` | vault | pending |

## FS / Document

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fs:listDir | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::list_dir` | vault | pending |
| fs:listTree | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::list_tree` | vault | pending |
| fs:readTextFile | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::read_text` | vault | pending |
| fs:writeTextFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::write_text` | vault | pending |
| fs:createTextFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::create_text` | vault | pending |
| fs:createNote | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::create_note` | vault | pending |
| fs:importBinaryFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::import_binary` | vault | pending |
| fs:exists | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::exists` | vault | pending |
| fs:stat | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::stat` | vault | pending |
| fs:mkdir | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::mkdir` | vault | pending |
| fs:rename | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::rename` | vault | pending |
| fs:renameLinked | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::rename_linked` | vault | pending |
| fs:delete | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::delete` | vault | pending |
| fs:revealInFinder | host | no | no | no | no | `fs-handlers.ts` | `product::reveal_item` | vault | pending |
| fs:scanTags | vault | no | no | yes | no | `fs-handlers.ts` | `index::scan_tags` | vault | pending |
| document:getMetadata | vault | no | no | yes | no | `document-handlers.ts` | `vault_fs::get_metadata` | vault | pending |

## Git

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| git:ping | host | no | no | no | no | `git-handlers.ts` | `git::ping` | git | pending |
| git:getStatus | vault | no | no | yes | yes | `git-handlers.ts` | `git::status` | git | pending |
| git:getTimeline | vault | no | no | yes | yes | `git-handlers.ts` | `git::timeline` | git | pending |
| git:recordAutoCommit | vault | yes | no | yes | yes | `git-handlers.ts` | `git::record_auto_commit` | git | pending |
| git:commit | vault | yes | no | yes | yes | `git-handlers.ts` | `git::commit` | git | pending |
| git:addRemote | vault | yes | no | yes | no | `git-handlers.ts` | `git::add_remote` | git | pending |
| git:listRemotes | vault | no | no | yes | yes | `git-handlers.ts` | `git::list_remotes` | git | pending |
| git:pull | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::pull` | git | pending |
| git:push | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::push` | git | pending |
| git:sync | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::sync` | git | pending |
| git:configureAutoSync | app-state | yes | no | no | no | `git-handlers.ts` | `git::configure_auto_sync` | git | pending |
| git:previewRestore | vault | no | no | yes | yes | `git-handlers.ts` | `git::preview_restore` | git | pending |
| git:restoreFile | vault | yes | no | yes | yes | `git-handlers.ts` | `git::restore_file` | git | pending |
| git:setUseSystemGit | app-state | yes | no | no | no | `git-handlers.ts` | `git::set_use_system` | git | pending |
| git:getAutoCommitDebounce | app-state | yes | no | no | no | `git-handlers.ts` | `git::get_debounce` | git | pending |
| git:setAutoCommitDebounce | app-state | yes | no | no | no | `git-handlers.ts` | `git::set_debounce` | git | pending |
| git:doctor:diagnose | vault | no | no | yes | yes | `git-handlers.ts` | `git::doctor_diagnose` | git | pending |
| git:doctor:repairPrepare | vault | no | no | yes | yes | `git-handlers.ts` | `git::doctor_prepare` | git | pending |
| git:doctor:repairExecute | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::doctor_execute` | git | pending |
| git:doctor:dismiss | app-state | yes | no | no | no | `git-handlers.ts` | `git::doctor_dismiss` | git | pending |

## Index

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| index:status | sqlite | no | no | yes | no | `index-handlers.ts` | `index::status` | vault | pending |
| index:rebuild | sqlite | yes | no | yes | no | `index-handlers.ts` | `index::rebuild` | vault | pending |
| index:backlinks | sqlite | no | no | yes | no | `index-handlers.ts` | `index::backlinks` | vault | pending |
| index:search | sqlite | no | no | yes | no | `index-handlers.ts` | `index::search` | vault | pending |
| index:jumpTo | sqlite | no | no | yes | no | `index-handlers.ts` | `index::jump_to` | vault | pending |
| index:tags | sqlite | no | no | yes | no | `index-handlers.ts` | `index::tags` | vault | pending |
| index:tagPages | sqlite | no | no | yes | no | `index-handlers.ts` | `index::tag_pages` | vault | pending |
| index:pageSummary | sqlite | no | no | yes | no | `index-handlers.ts` | `index::page_summary` | vault | pending |
| index:pageSummaries | sqlite | no | no | yes | no | `index-handlers.ts` | `index::page_summaries` | vault | pending |
| index:graph | sqlite | no | no | yes | no | `index-handlers.ts` | `index::graph` | vault | pending |
| index:confidence | sqlite | yes | no | yes | no | `index-handlers.ts` | `index::confidence` | vault | pending |
| index:confidenceSettings | vault | yes | no | yes | no | `index-handlers.ts` | `index::confidence_settings` | vault | pending |
| index:setConfidenceFrontmatter | vault | yes | no | yes | no | `index-handlers.ts` | `index::set_confidence_fm` | vault | pending |

## Settings

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| settings:getAll | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_get_all` | foundation | pending |
| settings:getVault | vault | yes | no | yes | no | `settings-handlers.ts` | `product::settings_get_vault` | foundation | pending |
| settings:setGlobal | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_set_global` | foundation | pending |
| settings:setVault | vault | yes | no | yes | no | `settings-handlers.ts` | `product::settings_set_vault` | foundation | pending |
| settings:setShortcuts | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_set_shortcuts` | foundation | pending |
| settings:exportShortcuts | host | yes | no | yes | no | `settings-handlers.ts` | `product::settings_export` | foundation | pending |
| settings:importShortcuts | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_import` | foundation | pending |
| settings:search | host | no | no | no | no | `settings-handlers.ts` | `product::settings_search` | foundation | pending |
| settings:pickImportFile | host | no | no | no | no | `settings-handlers.ts` | `product::settings_pick_file` | foundation | pending |
| settings:saveExportFile | host | yes | no | yes | no | `settings-handlers.ts` | `product::settings_save_file` | foundation | pending |

## AI

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ai:ping | host | no | no | no | no | `ai-handlers.ts` | `ai::ping` | ai | pending |
| ai:getState | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::get_state` | ai | pending |
| ai:credential:submit | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::credential_submit` | ai | pending |
| ai:profile:save | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::profile_save` | ai | pending |
| ai:profile:delete | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::profile_delete` | ai | pending |
| ai:profile:setDefault | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::profile_set_default` | ai | pending |
| ai:features:set | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::features_set` | ai | pending |
| ai:translation:setTargetLanguage | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::set_target_language` | ai | pending |
| ai:setupPrompt:dismiss | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::setup_dismiss` | ai | pending |
| ai:testConnection | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::test_connection` | ai | pending |
| ai:listModels | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::list_models` | ai | pending |
| ai:embed | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::embed` | ai | pending |
| ai:embedWithMetadata | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::embed_meta` | ai | pending |
| ai:retrieve | sqlite | no | no | yes | no | `ai-handlers.ts` | `retrieval::retrieve` | ai | pending |
| ai:export | app-state | no | no | no | no | `ai-handlers.ts` | `ai::export_profiles` | ai | pending |
| ai:import | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::import_profiles` | ai | pending |

## Agent

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agent:run:chat | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_chat` | ai | pending |
| agent:run:writing | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_writing` | ai | pending |
| agent:run:debug | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_debug` | ai | pending |
| agent:run:translation | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_translation` | ai | pending |
| agent:cancel | app-state | no | no | no | no | `agent-handlers.ts` | `agent::cancel` | ai | pending |
| agent:approval:respond | app-state | no | no | no | no | `agent-handlers.ts` | `agent::approval_respond` | ai | pending |

## Chat

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chat:list | vault | no | no | yes | no | `chat-handlers.ts` | `chat::list` | vault | pending |
| chat:get | vault | no | no | yes | no | `chat-handlers.ts` | `chat::get` | vault | pending |
| chat:new | app-state | no | no | no | no | `chat-handlers.ts` | `chat::new` | vault | pending |
| chat:save | vault | yes | no | yes | no | `chat-handlers.ts` | `chat::save` | vault | pending |
| chat:saveAsDoc | vault | yes | no | yes | no | `chat-handlers.ts` | `chat::save_as_doc` | vault | pending |

## Plugins

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plugins:ping | host | no | no | no | no | `plugin-handlers.ts` | `plugin::ping` | plugin | pending |
| plugins:list | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::list` | plugin | pending |
| plugins:listCommands | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::list_commands` | plugin | pending |
| plugins:listContributions | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::list_contribs` | plugin | pending |
| plugins:pickSource | host | no | no | no | no | `plugin-handlers.ts` | `plugin::pick_source` | plugin | pending |
| plugins:installPreview | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::install_preview` | plugin | pending |
| plugins:confirmInstall | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::confirm_install` | plugin | pending |
| plugins:uninstall | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::uninstall` | plugin | pending |
| plugins:setEnabled | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::set_enabled` | plugin | pending |
| plugins:listAuditLog | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::audit_log` | plugin | pending |
| plugins:revokePermission | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::revoke_perm` | plugin | pending |
| plugins:runCommand | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::run_command` | plugin | pending |
| plugins:beginSession | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::begin_session` | plugin | pending |
| plugins:closeSession | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::close_session` | plugin | pending |
| plugins:getRuntimeSource | plugin | no | no | yes | no | `plugin-handlers.ts` | `plugin::runtime_source` | plugin | pending |
| plugins:reportCrash | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::report_crash` | plugin | pending |
| plugins:beginAuthChallenge | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::auth_challenge` | plugin | pending |
| plugins:rejectAuthChallenge | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::reject_auth` | plugin | pending |
| plugins:grantPermission | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::grant_perm` | plugin | pending |
| plugins:rpc | plugin | no | no | yes | no | `plugin-handlers.ts` | `plugin::rpc` | plugin | pending |

## Skills

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skills:ping | host | no | no | no | no | `skill-handlers.ts` | `skill::ping` | ai | pending |
| skills:list | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::list` | ai | pending |
| skills:retrieve | sqlite | no | no | yes | no | `skill-handlers.ts` | `retrieval::skill_search` | ai | pending |
| skills:setEnabled | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_enabled` | ai | pending |
| skills:setOrder | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_order` | ai | pending |
| skills:setParams | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_params` | ai | pending |

## DOCX

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docx:import | vault | yes | no | yes | no | `docx-handlers.ts` | `docx::import` | binary-print | pending |
| docx:export | vault | yes | no | yes | no | `docx-handlers.ts` | `docx::export` | binary-print | pending |

## Binary

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| binary:ping | host | no | no | no | no | `binary-handlers.ts` | `binary::ping` | binary-print | pending |
| binary:import | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::import` | binary-print | pending |
| binary:create | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::create` | binary-print | pending |
| binary:read | vault | no | no | yes | no | `binary-handlers.ts` | `binary::read` | binary-print | pending |
| binary:save | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::save` | binary-print | pending |
| binary:host:open | host | no | no | no | no | `binary-handlers.ts` | `binary_host::open` | binary-print | pending |
| binary:host:close | host | no | no | no | no | `binary-handlers.ts` | `binary_host::close` | binary-print | pending |
| binary:host:setActive | host | no | no | no | no | `binary-handlers.ts` | `binary_host::set_active` | binary-print | pending |
| binary:host:setBounds | host | no | no | no | no | `binary-handlers.ts` | `binary_host::set_bounds` | binary-print | pending |
| binary:host:flush | host | no | no | yes | no | `binary-handlers.ts` | `binary_host::flush` | binary-print | pending |
| binary:host:ready | host | no | no | no | no | `binary-handlers.ts` | `binary_host::ready` | binary-print | pending |
| binary:editorTheme | host | no | no | no | no | `binary-handlers.ts` | `binary_host::editor_theme` | binary-print | pending |
| binary:mindmapTheme:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::mindmap_theme` | binary-print | pending |
| binary:mindmapStructure:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::mindmap_structure` | binary-print | pending |
| binary:gitignore:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::gitignore_set` | binary-print | pending |
| binary:gitignore:get | vault | no | no | yes | no | `binary-handlers.ts` | `binary::gitignore_get` | binary-print | pending |

## Print

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| print:document | host | no | no | yes | no | `print-handlers.ts` | `print::document` | binary-print | pending |

## Editor

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| editor:ping | host | no | no | no | no | `app-handlers.ts` | `product::ping_editor` | foundation | pending |

## Events

| Event | 所有权 | 触发来源 | Electron sender | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- |
| vault:changed | app-state | Rust product core | `webContents.send` | `product::emit_vault_changed` | foundation | pending |
| fs:changed | vault | file watcher | `webContents.send` | `vault_fs::watch_event` | vault | pending |
| app:updateStatus | remote-provider | updater | `webContents.send` | `updater::status_event` | updater | pending |
| agent:runEvent | remote-provider | agent gateway | `webContents.send` | `agent::run_event` | ai | pending |
| ai:streamEvent | remote-provider | AI adapter | `webContents.send` | `agent::stream_event` | ai | pending |
| ai:retrievalStatus | sqlite | retrieval service | `webContents.send` | `retrieval::status_event` | ai | pending |
| ai:configChanged | app-state | AI store | `webContents.send` | `ai::config_changed` | ai | pending |
| git:statusChanged | vault | git service | `webContents.send` | `git::status_event` | git | pending |
| git:syncProgress | vault | git service | `webContents.send` | `git::sync_progress` | git | pending |
| plugins:changed | plugin | plugin service | `webContents.send` | `plugin::changed_event` | plugin | pending |
| skills:changed | plugin | skill service | `webContents.send` | `skill::changed_event` | ai | pending |
| index:statusChanged | sqlite | index service | `webContents.send` | `index::status_event` | vault | pending |
| index:confidenceChanged | sqlite | confidence service | `webContents.send` | `index::confidence_event` | vault | pending |
| settings:changed | app-state | settings service | `webContents.send` | `product::settings_event` | foundation | pending |
| binary:editorCommand | host | binary editor host | `webContents.send` | `binary_host::editor_command` | binary-print | pending |
| menu:action | host | native menu | `webContents.send` | `window_menu::action` | foundation | pending |
