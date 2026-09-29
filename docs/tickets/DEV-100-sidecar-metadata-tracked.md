# DEV-100 文档 sidecar 元数据纳入 git 跟踪（修复跨设备 format 误判）

状态：done（2026-09-28，my-wiki 实测迁移生效）

## 问题

块文档 / Markdown 源码文档的区分**唯一**依据是 sidecar
（`.nexnote/metadata/<base64url(path)>.json` 的 `format` 字段）。
ADR-0016/DEV-083 把 `.nexnote/` 整目录 gitignore → sidecar 不跨设备同步 →
任何 sidecar 缺失场景（另一台设备、重新克隆、.nexnote 被清）都会落回默认
`native-block`：MD 文档被当块文档打开/显示块徽标；一旦以块编辑器保存，内容按块
序列化重写并经同步推回，转换被固化。用户报「同步了几次后 MD 文档也变成块文档了」。

## 决策（用户确认方案 A）

- gitignore 模板改为：`.nexnote/*` + `!.nexnote/metadata/` + `.nexnote/metadata/*.tmp-*`
  （运行时产物仍忽略；sidecar 随仓库同步；tmp 写盘产物仍忽略）。
- `isVaultSyncGuardedPath`：`.nexnote/metadata/**` 不再护栏（自动提交可暂存），
  其 `*.tmp-*` 产物仍护栏。
- 迁移：旧 ADR-0016 整目录 ignore 块与 ADR-0003 残留块加入
  `writeDefaultGitignore` 的模板块匹配列表，绑定时幂等替换为新模板，
  避免旧 `.nexnote/` 规则作为用户规则后置覆盖新例外。
- sidecar 冲突不自动收敛（内容非模板代数）；冲突时按常规人工/同步面板处理。

## 验收

- 单测：initialize 后 sidecar 被跟踪、index/config 仍不跟踪；旧模板迁移幂等；
  tmp 产物仍护栏；git-service 69/69。
- 实测 my-wiki：绑定后 .gitignore 重写为新模板；
  `git check-ignore` 对 metadata json 退出 1（不忽略）、对 index 退出 0（忽略）；
  `git ls-files --others --exclude-standard` 列出 sidecar（自动提交将暂存）。
