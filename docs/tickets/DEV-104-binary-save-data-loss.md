# DEV-104 表格保存整表写空 + 同步链路丢弃待提交（P0 数据丢失）

状态：done（2026-10-08）
分类：bug
优先级：**P0**（不可恢复的数据丢失）
范围：packages/main（保存/同步链路）、packages/renderer（二进制宿主会话）
关联：DEV-074、DEV-076、DEV-082、DEV-088、DEV-100、ADR-0015
来源：用户反馈 2026-10-08（`my-wiki` 知识库：「表格内容在某次同步后被置空了」；
另一台设备打开即提示同步冲突）

## 取证（用户仓库 `my-wiki`，非推测）

- `Personal/test.xlsx` 在 Git 里的 **7 个历史版本全部是空工作簿**：`xl/worksheets/sheet1.xml`
  为 `<sheetData/>`、`dimension ref="A1:A1"`、无 `sharedStrings.xml`；只有工作表名从
  `Sheet1` 变成 `AI Coding 支出` 被保留下来。游离对象、stash、reflog、远端分支里都没有
  带单元格的版本——**内容从未落盘**，不是"某次同步清掉的"。
- 用仓库真实代码复现：磁盘模型（`celldata`）保存后 4 个单元格；编辑器运行态（`data`）保存后 **0 个**。
- 真实 `<Workbook>` 组件在 happy-dom 中挂载即触发 `onChange`（2 次），首帧载荷字段为
  `name,id,status,data` —— `celldata` 已被 fortune-sheet 自己删除。

## 根因

1. **保存链路只认 `celldata`**（`packages/main/src/binary/xlsx-convert.ts`）：`@fortune-sheet/react`
   的 `onChange` 回传的是运行态——库在载入时把 `celldata` 展开成 `data[r][c]` 并 delete 掉它。
   写盘侧读不到 `celldata` 就按空表重建，于是每次保存都把整张表写空（表名照抄 `sheet.name` 所以存活）。
2. **打开即写盘**：宿主把编辑器初始化时的首次 `onChange` 当成用户编辑，1.2s 防抖后立即覆盖磁盘。
3. **关系合并正则在 Id 冲突时产出损坏 XML**（`zip-preserve.ts` 的 `mergeRelationships`）：
   `Id="rId1|rId2|rId3"` 这种拼接正则既无法表达候选集合，又会从 `Relationship` 之外开始吞字符。
   原包缺少 `sharedStrings` 时（空表模板正是如此）必然冲突，产物 rels 被撕碎、整份工作簿无法解析。
   该缺陷此前被根因 1 掩盖：重建端从来没有字符串，就从来不会冲突。
4. **同步链路丢弃待提交**：`sync()`/`pull()` 入口只调 `cancelAutoCommit()`，把防抖窗口里的
   "待提交"直接扔掉；紧接着的 `WORKTREE_DIRTY` 守卫又把本次同步挡回去，且没有任何机制重新排队
   ——工作区就此长期 dirty，每次打开都弹同步冲突（用户第二台设备的现场）。
5. **自动同步退避失效**：`setInterval(..., interval * backoff)` 的周期在创建时求值一次，backoff 永远不生效。
6. **sidecar 写路径不调度提交**：`binary:mindmapTheme:set` / `binary:mindmapStructure:set` 直接写
   `.nexnote/metadata/*.json`，未跟踪 sidecar 长期留在工作区，持续触发第 4 条的守卫。
7. **关窗不 flush 待提交**：主窗口 `close` 只等二进制编辑器写盘，30s 防抖窗口内的 Git 提交被丢在磁盘外。
8. **rebase/merge 暂停期仍允许写盘**：`binary:save` 不检查进行中的 rebase，冲突现场被继续改写。

## 修复

| # | 修复 | 位置 |
|---|---|---|
| 1 | 写盘侧兼容两种形态：`celldata` 或运行态 `data[r][c]`（`readSheetCells`） | `xlsx-convert.ts` |
| 2 | 编辑器初始化回调不算编辑：`markUserInteraction` 门槛（pointerdown/keydown/输入法/粘贴） | `binary-host/session.ts`、`binary-host/main.tsx` |
| 3 | 关系合并重写：重建端关系永不删除，冲突时改号并同步改写 owner part 的 `r:id`；原包关系仅在目标部件存在且未被重建端覆盖时补回（幂等） | `zip-preserve.ts` |
| 3' | 无内容变化的保存短路：忽略 docProps 时间戳后逐条目比较包内容，等价则不写盘 | `binary-service.ts`、`zip-preserve.ts` |
| 4 | `sync()`/`pull()` 先 `flushPendingAutoCommit()` 再走守卫；`commitAuto` 在 rebase/冲突时重新排队而不是丢弃 | `git-service.ts` |
| 5 | 自动同步改为 `setTimeout` 链，退避（1→4×）真正生效 | `git-service.ts` |
| 6 | 两个 sidecar 写入口补 `recordWrite`（调度自动提交 + 广播状态） | `ipc/binary-handlers.ts` |
| 7 | 关窗时同时 flush 待提交（失败不阻止退出，写盘失败仍阻止） | `index.ts` |
| 8 | rebase/merge 暂停期 `binary:save` 返回 `BINARY_SAVE_BLOCKED`，宿主保留内存编辑并自动重试 | `ipc/binary-handlers.ts`、`git-service.ts` |

## 验收证据

- 单测：`packages/main/tests/binary-xlsx-editor-payload.test.ts`（真实编辑器载荷 fixture：
  单元格保留、包等价短路、重复保存不重写）、`git-service.test.ts`（flush 落地、sync 不再自伤、
  rebase 重排队、退避 2×）、`packages/renderer/tests/binary-host-session.test.ts`（交互门槛）。
- 端测：打包冒烟新增 xlsx 往返检查（create → save(运行态载荷) → read → 重复 save）。
- 门禁：`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm verify:release-config` 全绿。

## Out of scope

- 已丢失表格内容的恢复：取证结论是数据从未落盘（Git 对象、索引、会话、工作区都没有），
  本票只修"不再丢"。
- 跨设备冲突 UX 的进一步改造（doctor 引导已存在）。
