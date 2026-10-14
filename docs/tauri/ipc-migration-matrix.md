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
| agent:approval:respond | 已接通：审批表按 tool/run 校验、TTL 过期、取消即拒绝（`agent_service.rs`） | — |
| agent:run:* | agent 语义已全部迁移：SSE 流、取消与 TTL、工具环、审批横幅、权限模式与作用域护栏、场景 prompt 模板、skills 上下文与 `context` 事件、params 注入、无工具降级重试、翻译 reasoning 过滤（`agent_tools.rs` / `agent_scenario.rs` / `reasoning_filter.rs` / `product.rs`） | 无 |
| binary:editorCommand | load/theme/language 直投；flush 经一次性 token 往返等待编辑器真实落盘（`binary:host:flushAck`） | macOS 实测后确认收发完整（DEV-123） |

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
| fs:listTree | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::list_tree` | vault | ported |
| fs:readTextFile | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::read_text` | vault | ported |
| fs:writeTextFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::write_text` | vault | ported |
| fs:createTextFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::create_text` | vault | ported |
| fs:createNote | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::create_note` | vault | ported |
| fs:importBinaryFile | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::import_binary` | vault | ported |
| fs:exists | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::exists` | vault | ported |
| fs:stat | vault | no | no | yes | no | `fs-handlers.ts` | `vault_fs::stat` | vault | ported |
| fs:mkdir | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::mkdir` | vault | ported |
| fs:rename | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::rename` | vault | ported |
| fs:renameLinked | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::rename_linked` | vault | ported |
| fs:delete | vault | yes | no | yes | no | `fs-handlers.ts` | `vault_fs::delete` | vault | ported |
| fs:revealInFinder | host | no | no | no | no | `fs-handlers.ts` | `product::reveal_item` | vault | ported |
| fs:scanTags | vault | no | no | yes | no | `fs-handlers.ts` | `index::scan_tags` | vault | ported |
| document:getMetadata | vault | no | no | yes | no | `document-handlers.ts` | `vault_fs::get_metadata` | vault | ported |

## Git

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| git:ping | host | no | no | no | no | `git-handlers.ts` | `git::ping` | git | ported |
| git:getStatus | vault | no | no | yes | yes | `git-handlers.ts` | `git::status` | git | ported |
| git:getTimeline | vault | no | no | yes | yes | `git-handlers.ts` | `git::timeline` | git | ported |
| git:recordAutoCommit | vault | yes | no | yes | yes | `git-handlers.ts` | `git::record_auto_commit` | git | ported |
| git:commit | vault | yes | no | yes | yes | `git-handlers.ts` | `git::commit` | git | ported |
| git:addRemote | vault | yes | no | yes | no | `git-handlers.ts` | `git::add_remote` | git | ported |
| git:listRemotes | vault | no | no | yes | yes | `git-handlers.ts` | `git::list_remotes` | git | ported |
| git:pull | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::pull` | git | ported |
| git:push | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::push` | git | ported |
| git:sync | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::sync` | git | ported |
| git:configureAutoSync | app-state | yes | no | no | no | `git-handlers.ts` | `git::configure_auto_sync` | git | ported |
| git:previewRestore | vault | no | no | yes | yes | `git-handlers.ts` | `git::preview_restore` | git | ported |
| git:restoreFile | vault | yes | no | yes | yes | `git-handlers.ts` | `git::restore_file` | git | ported |
| git:setUseSystemGit | app-state | yes | no | no | no | `git-handlers.ts` | `git::set_use_system` | git | ported |
| git:getAutoCommitDebounce | app-state | yes | no | no | no | `git-handlers.ts` | `git::get_debounce` | git | ported |
| git:setAutoCommitDebounce | app-state | yes | no | no | no | `git-handlers.ts` | `git::set_debounce` | git | ported |
| git:doctor:diagnose | vault | no | no | yes | yes | `git-handlers.ts` | `git::doctor_diagnose` | git | ported |
| git:doctor:repairPrepare | vault | no | no | yes | yes | `git-handlers.ts` | `git::doctor_prepare` | git | ported |
| git:doctor:repairExecute | vault | yes | yes | yes | yes | `git-handlers.ts` | `git::doctor_execute` | git | ported |
| git:doctor:dismiss | app-state | yes | no | no | no | `git-handlers.ts` | `git::doctor_dismiss` | git | ported |

## Index

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| index:status | sqlite | no | no | yes | no | `index-handlers.ts` | `index::status` | vault | ported |
| index:rebuild | sqlite | yes | no | yes | no | `index-handlers.ts` | `index::rebuild` | vault | ported |
| index:backlinks | sqlite | no | no | yes | no | `index-handlers.ts` | `index::backlinks` | vault | ported |
| index:search | sqlite | no | no | yes | no | `index-handlers.ts` | `index::search` | vault | ported |
| index:jumpTo | sqlite | no | no | yes | no | `index-handlers.ts` | `index::jump_to` | vault | ported |
| index:tags | sqlite | no | no | yes | no | `index-handlers.ts` | `index::tags` | vault | ported |
| index:tagPages | sqlite | no | no | yes | no | `index-handlers.ts` | `index::tag_pages` | vault | ported |
| index:pageSummary | sqlite | no | no | yes | no | `index-handlers.ts` | `index::page_summary` | vault | ported |
| index:pageSummaries | sqlite | no | no | yes | no | `index-handlers.ts` | `index::page_summaries` | vault | ported |
| index:graph | sqlite | no | no | yes | no | `index-handlers.ts` | `index::graph` | vault | ported |
| index:confidence | sqlite | yes | no | yes | no | `index-handlers.ts` | `index::confidence` | vault | ported |
| index:confidenceSettings | vault | yes | no | yes | no | `index-handlers.ts` | `index::confidence_settings` | vault | ported |
| index:setConfidenceFrontmatter | vault | yes | no | yes | no | `index-handlers.ts` | `index::set_confidence_fm` | vault | ported |

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
| agent:run:chat | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_chat` | ai | ported |
| agent:run:writing | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_writing` | ai | ported |
| agent:run:debug | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_debug` | ai | ported |
| agent:run:translation | remote-provider | no | yes | yes | no | `agent-handlers.ts` | `agent::run_translation` | ai | ported |
| agent:cancel | app-state | no | no | no | no | `agent-handlers.ts` | `agent::cancel` | ai | ported |
| agent:approval:respond | app-state | no | no | no | no | `agent-handlers.ts` | `agent::approval_respond` | ai | ported |
| binary:host:flushAck | app-state | no | no | no | no | Tauri-only（Electron 用 executeJavaScript 取回值） | `binary::host_flush_ack` | binary | ported |

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
| plugins:listCommands | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::list_commands` | plugin | ported |
| plugins:listContributions | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::list_contribs` | plugin | ported |
| plugins:pickSource | host | no | no | no | no | `plugin-handlers.ts` | `plugin::pick_source` | plugin | ported |
| plugins:installPreview | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::install_preview` | plugin | ported |
| plugins:confirmInstall | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::confirm_install` | plugin | ported |
| plugins:uninstall | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::uninstall` | plugin | ported |
| plugins:setEnabled | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::set_enabled` | plugin | ported |
| plugins:listAuditLog | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::audit_log` | plugin | ported |
| plugins:revokePermission | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::revoke_perm` | plugin | ported |
| plugins:runCommand | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::run_command` | plugin | ported |
| plugins:beginSession | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::begin_session` | plugin | ported |
| plugins:closeSession | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::close_session` | plugin | ported |
| plugins:getRuntimeSource | plugin | no | no | yes | no | `plugin-handlers.ts` | `plugin::runtime_source` | plugin | ported |
| plugins:reportCrash | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::report_crash` | plugin | ported |
| plugins:beginAuthChallenge | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::auth_challenge` | plugin | ported |
| plugins:rejectAuthChallenge | plugin | no | no | no | no | `plugin-handlers.ts` | `plugin::reject_auth` | plugin | ported |
| plugins:grantPermission | plugin | yes | no | yes | no | `plugin-handlers.ts` | `plugin::grant_perm` | plugin | ported |
| plugins:rpc | plugin | no | no | yes | no | `plugin-handlers.ts` | `plugin::rpc` | plugin | ported |

## Skills

| Channel | 所有权 | persist | net | fs | proc | Electron handler | Tauri target | batch | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skills:ping | host | no | no | no | no | `skill-handlers.ts` | `skill::ping` | ai | ported |
| skills:list | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::list` | ai | ported |
| skills:retrieve | sqlite | no | no | yes | no | `skill-handlers.ts` | `retrieval::skill_search` | ai | ported |
| skills:setEnabled | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_enabled` | ai | ported |
| skills:setOrder | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_order` | ai | ported |
| skills:setParams | plugin | yes | no | yes | no | `skill-handlers.ts` | `skill::set_params` | ai | ported |

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
| binary:host:open | host | no | no | no | no | `binary-handlers.ts` | `binary_host::open` | binary-print | pending（每文档 borderless 子窗口；macOS 实测待做） |
| binary:host:close | host | no | no | no | no | `binary-handlers.ts` | `binary_host::close` | binary-print | pending（销毁窗口；flush 往返未实现） |
| binary:host:setActive | host | no | no | no | no | `binary-handlers.ts` | `binary_host::set_active` | binary-print | pending（激活显示/隐藏；并发上限未验证） |
| binary:host:setBounds | host | no | no | no | no | `binary-handlers.ts` | `binary_host::set_bounds` | binary-print | pending（按占位矩形定位；主窗口 resize 时会 clamp 重定位） |
| binary:host:flush | host | no | no | yes | no | `binary-handlers.ts` | `binary_host::flush` | binary-print | pending（仅投递 flush 命令；未等待写盘往返） |
| binary:host:ready | host | no | no | no | no | `binary-handlers.ts` | `binary_host::ready` | binary-print | pending（pull 模型返回队列；多宿主并发时 sender 识别待修正） |
| binary:editorTheme | host | no | no | no | no | `binary-handlers.ts` | `binary_host::editor_theme` | binary-print | ported |
| binary:mindmapTheme:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::mindmap_theme` | binary-print | ported |
| binary:mindmapStructure:set | vault | yes | no | yes | no | `binary-handlers.ts` | `binary::mindmap_structure` | binary-print | ported |
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
| skills:changed | plugin | skill service | `webContents.send` | `skill::changed_event` | ai | ported |
| index:statusChanged | sqlite | index service | `webContents.send` | `index::status_event` | vault | ported |
| index:confidenceChanged | sqlite | confidence service | `webContents.send` | `index::confidence_event` | vault | ported |
| settings:changed | app-state | settings service | `webContents.send` | `product::settings_event` | foundation | ported |
| binary:editorCommand | host | binary editor host | `webContents.send` | `binary_host::editor_command` | binary-print | pending（load/theme/flush 已投递；DEV-123 实测待做） |
| menu:action | host | native menu | `webContents.send` | `window_menu::action` | foundation | ported |
