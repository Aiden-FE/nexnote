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

> 状态说明：已接线但语义不完整的通道保持 `pending`，并在下方「已知未完成」中列出，
> 不用 `ported` 掩盖差距。

## 已知未完成（保持 pending）

| Channel | 现状 | 剩余工作 |
| --- | --- | --- |
| agent:cancel / agent:approval:respond | 返回 `{cancelled:false}` 占位 | 迁移 Electron agent gateway 的取消与工具审批语义（DEV-121） |
| skills:retrieve | 以 index_service FTS 结果代替 Skill 召回 | 迁移 DEV-014 Skill 召回/重排链路（DEV-121） |
| agent:run:* | SSE 文本流已接通，但无工具审批/权限模式 | 迁移工具调用与权限模式（DEV-121） |
| skills:list / skills:setEnabled / skills:setOrder / skills:setParams | 硬编码 builtin 列表或返回空占位，无持久化 Skill 配置 | 建立 Skill 配置存储与启停/排序/参数持久化（DEV-121） |
| index:confidenceChanged | 无重算触发点（`index:confidence` 只读） | 置信度重算落地后触发事件（DEV-119） |
| binary:editorCommand / menu:action | 未迁移 | 多 WebView 编辑器宿主与原生菜单（DEV-123 / DEV-124） |

## App

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| app:getInfo | app-state | no | no | no | no | `app-handlers.ts` | `product::app_info` | foundation | ported |
| app:checkForUpdates | remote-provider | no | yes | no | no | `app-handlers.ts` | `updater::check` | updater | ported |
| app:downloadUpdate | remote-provider | yes | yes | yes | no | `app-handlers.ts` | `updater::download` | updater | ported |
| app:installUpdate | host | yes | no | yes | yes | `app-handlers.ts` | `updater::install` | updater | ported |
| app:setUpdateChannel | app-state | yes | no | yes | no | `app-handlers.ts` | `product::set_update_channel` | foundation | ported |
| app:getUpdateSettings | app-state | yes | no | yes | no | `app-handlers.ts` | `product::get_update_settings` | foundation | ported |
| app:setUpdateSettings | app-state | yes | no | yes | no | `app-handlers.ts` | `product::set_update_settings` | foundation | ported |

## Vault

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vault:getState | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_get_state` | foundation | ported |
| vault:pickDirectory | host | no | no | no | no | `vault-handlers.ts` | `product::vault_pick_dir` | foundation | ported |
| vault:create | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_create` | vault | ported |
| vault:open | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_open` | vault | ported |
| vault:clone | vault | yes | yes | yes | yes | `vault-handlers.ts` | `vault::clone` | git | ported |
| vault:initGit | vault | yes | no | yes | yes | `vault-handlers.ts` | `git::init` | git | ported |
| vault:inspect | vault | no | no | yes | no | `vault-handlers.ts` | `product::vault_inspect` | vault | ported |
| vault:clonePreflight | remote-provider | no | yes | no | no | `vault-handlers.ts` | `git::clone_preflight` | git | ported |
| vault:cancelOperation | app-state | no | no | no | no | `vault-handlers.ts` | `vault::cancel_op` | vault | ported |
| vault:close | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_close` | foundation | ported |
| vault:listRecent | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_list_recent` | foundation | ported |
| vault:removeRecent | app-state | yes | no | yes | no | `vault-handlers.ts` | `product::vault_remove_recent` | foundation | ported |
| vault:getLayout | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_get_layout` | vault | ported |
| vault:saveLayout | vault | yes | no | yes | no | `vault-handlers.ts` | `product::vault_save_layout` | vault | ported |
| vault:reveal | host | no | no | no | no | `vault-handlers.ts` | `product::vault_reveal` | vault | ported |

## FS / Document

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fs:listDir | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::list_dir` | vault | ported |
| fs:listTree | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::list_tree` | vault | pending |
| fs:readTextFile | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::read_text` | vault | ported |
| fs:writeTextFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::write_text` | vault | ported |
| fs:createTextFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::create_text` | vault | pending |
| fs:createNote | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::create_note` | vault | pending |
| fs:importBinaryFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::import_binary` | vault | pending |
| fs:exists | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::exists` | vault | pending |
| fs:stat | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::stat` | vault | pending |
| fs:mkdir | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::mkdir` | vault | pending |
| fs:rename | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::rename` | vault | pending |
| fs:renameLinked | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::rename_linked` | vault | ported |
| fs:delete | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::delete` | vault | pending |
| fs:revealInFinder | host | no | no | no | no | `fs-handlers.ts` | `product::reveal_item` | vault | pending |
| fs:scanTags | vault | no | no | yes | no | `fs-handlers.ts` | `index::scan_tags` | vault | pending |
| document:getMetadata | vault | no | no | yes | no | `document-handlers.ts` | `vault_fs::get_metadata` | vault | pending |

## Git

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| git:ping | host | no | no | no | no | `git-handlers.ts` | `git::ping` | git | ported |
| git:getStatus | vault | no | no | yes | yes | `git-handlers.ts` | `git::status` | git | ported |
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
| index:status | sqlite | no | no | yes | no | `index-handlers.ts` | `index::status` | vault | ported |
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
| settings:getAll | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_get_all` | foundation | ported |
| settings:getVault | vault | yes | no | yes | no | `settings-handlers.ts` | `product::settings_get_vault` | foundation | ported |
| settings:setGlobal | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_set_global` | foundation | ported |
| settings:setVault | vault | yes | no | yes | no | `settings-handlers.ts` | `product::settings_set_vault` | foundation | ported |
| settings:setShortcuts | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_set_shortcuts` | foundation | ported |
| settings:exportShortcuts | host | yes | no | yes | no | `settings-handlers.ts` | `product::settings_export` | foundation | ported |
| settings:importShortcuts | app-state | yes | no | yes | no | `settings-handlers.ts` | `product::settings_import` | foundation | ported |
| settings:search | host | no | no | no | no | `settings-handlers.ts` | `product::settings_search` | foundation | ported |
| settings:pickImportFile | host | no | no | no | no | `settings-handlers.ts` | `product::settings_pick_file` | foundation | ported |
| settings:saveExportFile | host | yes | no | yes | no | `settings-handlers.ts` | `product::settings_save_file` | foundation | ported |

## AI

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ai:ping | host | no | no | no | no | `ai-handlers.ts` | `ai::ping` | ai | ported |
| ai:getState | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::get_state` | ai | ported |
| ai:credential:submit | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::credential_submit` | ai | ported |
| ai:profile:save | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::profile_save` | ai | ported |
| ai:profile:delete | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::profile_delete` | ai | ported |
| ai:profile:setDefault | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::profile_set_default` | ai | ported |
| ai:features:set | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::features_set` | ai | ported |
| ai:translation:setTargetLanguage | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::set_target_language` | ai | ported |
| ai:setupPrompt:dismiss | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::setup_dismiss` | ai | ported |
| ai:testConnection | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::test_connection` | ai | ported |
| ai:listModels | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::list_models` | ai | ported |
| ai:embed | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::embed` | ai | ported |
| ai:embedWithMetadata | remote-provider | no | yes | no | no | `ai-handlers.ts` | `ai::embed_meta` | ai | ported |
| ai:retrieve | sqlite | no | no | yes | no | `ai-handlers.ts` | `retrieval::retrieve` | ai | ported |
| ai:builtInEmbedding:status | app-state | no | no | yes | no | —（Tauri 新增） | `embedding::status` | ai | ported |
| ai:builtInEmbedding:download | app-state | yes | yes | yes | no | —（Tauri 新增，ADR-0027） | `embedding::download` | ai | ported |
| ai:builtInEmbedding:delete | app-state | yes | no | yes | no | —（Tauri 新增，ADR-0027） | `embedding::delete` | ai | ported |
| ai:export | app-state | no | no | no | no | `ai-handlers.ts` | `ai::export_profiles` | ai | ported |
| ai:import | app-state | yes | no | yes | no | `ai-handlers.ts` | `ai::import_profiles` | ai | ported |

## Agent

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agent:run:chat | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_chat` | ai | pending（SSE 文本流已接；工具审批/权限模式未迁移） |
| agent:run:writing | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_writing` | ai | pending（SSE 文本流已接；工具审批/权限模式未迁移） |
| agent:run:debug | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_debug` | ai | pending（SSE 文本流已接；工具审批/权限模式未迁移） |
| agent:run:translation | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_translation` | ai | pending（SSE 文本流已接；工具审批/权限模式未迁移） |
| agent:cancel | app-state | no | no | no | no | `agent-handlers.ts` | `agent::cancel` | ai | pending（返回占位；取消语义未迁移） |
| agent:approval:respond | app-state | no | no | no | no | `agent-handlers.ts` | `agent::approval_respond` | ai | pending（返回占位；工具审批语义未迁移） |

## Chat

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chat:list | vault | no | no | yes | no | `chat-handlers.ts` | `chat::list` | vault | ported |
| chat:get | vault | no | no | yes | no | `chat-handlers.ts` | `chat::get` | vault | ported |
| chat:new | app-state | no | no | no | no | `chat-handlers.ts` | `chat::new` | vault | ported |
| chat:save | vault | yes | no | yes | no | `chat-handlers.ts` | `chat::save` | vault | ported |
| chat:saveAsDoc | vault | yes | no | yes | no | `chat-handlers.ts` | `chat::save_as_doc` | vault | ported |

## Plugins

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plugins:ping | host | no | no | no | no | `plugin-handlers.ts` | `plugin::ping` | plugin | ported |
| plugins:list | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::list` | plugin | ported |
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
| skills:ping | host | no | no | no | no | `skill-handlers.ts` | `skill::ping` | ai | ported |
| skills:list | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::list` | ai | pending（返回硬编码 builtin 列表；不反映持久化状态） |
| skills:retrieve | sqlite | no | no | yes | no | `skill-handlers.ts` | `retrieval::skill_search` | ai | pending（以 FTS 代替 Skill 召回；重排链路未迁移） |
| skills:setEnabled | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_enabled` | ai | pending（返回空占位；无持久化 Skill 配置存储） |
| skills:setOrder | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_order` | ai | pending |
| skills:setParams | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_params` | ai | pending |

## DOCX

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docx:import | vault | yes | no | yes | no | `docx-handlers.ts` | `docx::import` | binary-print | ported |
| docx:export | vault | yes | no | yes | no | `docx-handlers.ts` | `docx::export` | binary-print | ported |

## Binary

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| binary:ping | host | no | no | no | no | `binary-handlers.ts` | `binary::ping` | binary-print | ported |
| binary:import | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::import` | binary-print | ported |
| binary:create | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::create` | binary-print | ported |
| binary:read | vault | no | no | yes | no | `binary-handlers.ts` | `binary::read` | binary-print | ported |
| binary:save | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::save` | binary-print | ported |
| binary:host:open | host | no | no | no | no | `binary-handlers.ts` | `binary_host::open` | binary-print | pending |
| binary:host:close | host | no | no | no | no | `binary-handlers.ts` | `binary_host::close` | binary-print | pending |
| binary:host:setActive | host | no | no | no | no | `binary-handlers.ts` | `binary_host::set_active` | binary-print | pending |
| binary:host:setBounds | host | no | no | no | no | `binary-handlers.ts` | `binary_host::set_bounds` | binary-print | pending |
| binary:host:flush | host | no | no | yes | no | `binary-handlers.ts` | `binary_host::flush` | binary-print | pending |
| binary:host:ready | host | no | no | no | no | `binary-handlers.ts` | `binary_host::ready` | binary-print | pending |
| binary:editorTheme | host | no | no | no | no | `binary-handlers.ts` | `binary_host::editor_theme` | binary-print | pending |
| binary:mindmapTheme:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::mindmap_theme` | binary-print | pending |
| binary:mindmapStructure:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::mindmap_structure` | binary-print | pending |
| binary:gitignore:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::gitignore_set` | binary-print | ported |
| binary:gitignore:get | vault | no | no | yes | no | `binary-handlers.ts` | `binary::gitignore_get` | binary-print | ported |

## Print

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| print:document | host | no | no | yes | no | `print-handlers.ts` | `print::document` | binary-print | ported |

## Editor

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| editor:ping | host | no | no | no | no | `app-handlers.ts` | `product::ping_editor` | foundation | ported |

## Events

| Event | 所有权 | 触发来源 | Electron sender | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- |
| vault:changed | app-state | Rust product core | `webContents.send` | `product::emit_vault_changed` | foundation | ported |
| fs:changed | vault | file watcher | `webContents.send` | `vault_fs::watch_event` | vault | ported |
| app:updateStatus | remote-provider | updater | `webContents.send` | `updater::status_event` | updater | ported |
| agent:runEvent | remote-provider | agent gateway | `webContents.send` | `agent::run_event` | ai | ported |
| ai:streamEvent | remote-provider | AI adapter | `webContents.send` | `agent::stream_event` | ai | explicitly-unsupported（共享契约已标 @deprecated 并从渲染层 allowlist 排除） |
| ai:retrievalStatus | sqlite | retrieval service | `webContents.send` | `retrieval::status_event` | ai | ported |
| ai:configChanged | app-state | AI store | `webContents.send` | `ai::config_changed` | ai | ported |
| git:statusChanged | vault | git service | `webContents.send` | `git::status_event` | git | ported |
| git:syncProgress | vault | git service | `webContents.send` | `git::sync_progress` | git | ported |
| plugins:changed | plugin | plugin service | `webContents.send` | `plugin::changed_event` | plugin | ported |
| skills:changed | plugin | skill service | `webContents.send` | `skill::changed_event` | ai | pending（无持久化 Skill 配置存储） |
| index:statusChanged | sqlite | index service | `webContents.send` | `index::status_event` | vault | ported |
| index:confidenceChanged | sqlite | confidence service | `webContents.send` | `index::confidence_event` | vault | pending（index:confidence 只读不重算，无触发点） |
| settings:changed | app-state | settings service | `webContents.send` | `product::settings_event` | foundation | ported |
| binary:editorCommand | host | binary editor host | `webContents.send` | `binary_host::editor_command` | binary-print | pending（多 WebView 编辑器宿主未迁移，DEV-123） |
| menu:action | host | native menu | `webContents.send` | `window_menu::action` | foundation | pending（原生菜单未迁移，DEV-124） |
