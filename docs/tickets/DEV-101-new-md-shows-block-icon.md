# DEV-101 新建 Markdown 文档页面树仍显示块图标

状态：done（2026-09-29，my-wiki 实测新建即显示 MD 徽标）

## 问题

新建 Markdown（源码模式）文档后，页面树条目显示「块编辑文档」图标 + 块 徽标，
而非「Markdown 源码文档」。sidecar 已正确写入 `format: "markdown"`，全量
`fs:listTree`（刷新/重开）也能读到并显示 MD；只有**创建当次的增量路径**丢格式。

根因（增量路径的两处缺口）：

1. `createNoteIn` 创建后**不**做乐观树插入，完全依赖 chokidar `add` 事件回流；
   事件到达前/到达窗口内条目可能以无 format 落入（或尚未落入），首屏图标错。
2. `applyFsChangeEvent` 的去重守卫对「已存在条目」直接 `return entries`，
   后到的、携带 `format` 的 `add` 事件被整体丢弃，无法纠正先落的无 format 条目。

两者叠加：创建当次条目以无 format 落定，之后带 format 的事件被去重吞掉，
图标停留在块；直到手动刷新（全量读 sidecar）才恢复。

## 修复

- `ops.createNoteIn`：`fs:createNote` 返回后立即
  `applyEvent({ kind: 'add', path, format })` 乐观插入（创建路径已知 format），
  保证首屏图标即时正确；稍后 watcher 的 add 经去重/合并不重复、不覆盖。
- `tree-utils.applyFsChangeEvent`：条目已存在且后到 `add` 事件带不同 `format` 时
  **合并 format**（自愈），而非直接丢弃；format 相同或缺失时仍返回原引用（去重不变）。

## 验收

- 单测：watch-service 集成（createNote format=markdown/native-block → add 事件带 format）；
  tree-utils 去重合并 format 自愈 + 同 format 去重保持引用；全量 1422 通过
  （watch-service 单例 13/13；并发下 chokidar 抖动为已知 baseline flake）。
- 实测 my-wiki（电脑控制）：新建 Markdown 后树条目即时显示
  「Markdown 源码文档」图标 + MD 徽标，无需刷新；历史 markdown sidecar 条目
  （Personal/验收反馈.md）刷新后亦显示 MD；无 sidecar 的 legacy 文档保持块徽标。
