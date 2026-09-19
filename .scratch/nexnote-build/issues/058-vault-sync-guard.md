# DEV-058 Vault Sync Guard — 知识库同步护栏完整实现

Ticket: DEV-058 · Branch: dev/DEV-058 · ADR: docs/adr/0003-vault-gitignore-policy.md
Status: implemented, evidence captured locally (六门禁全绿)

## 行为

1. `isVaultSyncGuardedPath` 在 normalize 之后比较 OS 元数据与 `.nexnote/`，allowlist 仅保留 `config.json` 与 `layout.json`。`\` 在 Git 中是合法字符，禁止再当目录分隔符。
2. `GitService.commit` 改为：使用 NUL 分隔的 `ls-files --cached --others --exclude-standard` 列举，剔除护栏路径后调用 `stageLiteralPaths` 走 `--pathspec-from-file` + `--literal-pathspecs`，避免目录压缩、pathspec magic、argv 溢出。空 allowed 集合也要继续执行迁移 untrack，因此不再用 `if (allowed.length === 0) return;` 短路。
3. 提交走「临时索引」：先 `untrackGuardedArtifacts` 把 `--force` 添加的违规 staged blob 移除，再用 `GIT_INDEX_FILE` 指向临时索引从 HEAD `read-tree`，加入 allowed 路径并把 HEAD 中的违规路径 `--rm --cached` 后 commit。用户预先手工 staged 的文件既不被吸收进 NexNote 提交也不被丢失（commit 后再 `add -A allowed` 把允许路径写入真实索引）。全程不使用 `reset`，违规文件始终保留在磁盘。
4. `untrackGuardedArtifacts` 同样走 `stageLiteralPaths` + `--ignore-unmatch`，重复运行幂等；只对护栏命中文件执行 `rm --cached -f`，工作区不变。
5. `writeDefaultGitignore` 用 `O_NOFOLLOW` 打开并 `fstat` 检查：硬链接（`nlink > 1`）与符号链接都拒绝（`INVALID_PATH`）。模板整体前置追加，原文件字节逐字保留；二次调用会做模板前缀匹配，避免重复写入。
6. `ensureSyncGuard` 在 `vault:getState` 仅当 `restoreLast` 真正回填时执行，`vault:open`、`vault:create`、`vault:clone`、`vault:initGit`、`GitService.initialize`（共用同一入口）共五条 binding/restoring 路径都覆盖；常规 `git:getState` 状态查询不再触发写盘。
7. 日志只输出数量：`[git] sync guard skipped: N`、`[git] sync guard untracked: N`，不写路径或字节内容。

## 验收测试

`pnpm exec vitest run packages/main/tests/git-service.test.ts`（定向），关键用例：

- `ensureSyncGuard 后 manual/auto 提交实际迁移 HEAD，保留磁盘` —— 不是 initialize 提交；通过 `commitManual/Auto` 真实把违规路径从 HEAD 移除，磁盘 `.DS_Store`、`.nexnote/index/legacy.db` 完整保留。
- `目录压缩、仅违规文件和 pathspec magic 都不会进入提交` —— `notes/.DS_Store` 不会被一起添加，`:evil.md` 这种字面冒号路径正常进入 HEAD。
- `预暂存允许文件不会泄漏，预暂存违规文件会作为迁移删除提交` —— 用户预先 `git add -f` 的 `staged.md` 留在 staged 不被吸收，预暂存的 `.DS_Store` 在本次 commit 中被移除。
- `删除 .gitignore 后手动提交仍不会暂存同步护栏路径` —— 即使用户改坏模板，应用层仍兜底。
- `ensureSyncGuard 保留用户规则字节、幂等且不泛屏蔽用户数据库` —— 用户尾部 `.gitignore` 字节逐字保留；多次调用结果相同；不写入 `*.db` 或 `*.sqlite` 之类通用屏蔽。
- `ensureSyncGuard 拒绝 .gitignore symlink，不写入知识库外部` —— symlink 链接到外部文件时抛 `INVALID_PATH`，外部文件字节不变。
- `空库 initialize 共用护栏并生成可识别的初始提交` —— 空仓库共用 `ensureSyncGuard → commit`，timeline 含 `kind: 'initial'`。
- 既有的 `initialize 升级旧仓库时 untrack 本地产物和 OS 元数据但保留 config/layout` 与 `同步护栏识别 OS 元数据和 .nexnote 运行时产物，但保留 allowlist` 继续通过。

## 行为证据（六门禁）

| 门禁 | 命令 | 退出码 | 关键输出 | 绝对日志路径 |
| --- | --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | 0 | 6/6 workspace 通过 | `/tmp/nexnote-DEV-058-gates/typecheck.log` |
| test | `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | 0 | `Test Files 156 passed \| 1 skipped (157)` `Tests 1413 passed \| 2 skipped (1415)`；首次运行命中既有 watch-service 时序偶发失败，单文件复验和完整重跑均通过 | `/tmp/nexnote-DEV-058-gates/test.log`（最终）`/tmp/DEV-058-watch-retry.log`（复验） |
| lint | `pnpm lint` | 0 | `✖ 4 problems (0 errors, 4 warnings)`（仅既有警告） | `/tmp/nexnote-DEV-058-gates/lint.log` |
| build | `pnpm build` | 0 | `✓ built in 4.28s` | `/tmp/nexnote-DEV-058-gates/build.log` |
| changed-format | `scripts/check-changed-format.sh` 经手动等价的 diff against `4feefdd`（共同祖先；远端历史不可达时回退到本地） | 0 | `All matched files use Prettier code style!` | `/tmp/nexnote-DEV-058-gates/format.log` |
| diff check | `git diff --check` | 0 | 无空白问题 | `/tmp/nexnote-DEV-058-gates/diff.log` |

定向额外证据：`/tmp/DEV-058-focused-all.log` 显示 `git-service.test.ts` 与 `ipc-registrar.test.ts` 共 53 / 53 passed（含迁移、压缩、预暂存、literal、幂等、用户规则保留、空库、symlink）。

## 独立双轴复审 FAIL 历史与修复（5521675 后续）

独立双轴复审对候选 `5521675` 判定 **Standards FAIL / Spec FAIL**。以下问题均已修复并补回归：

1. **High — vault 根/祖先 symlink 逃逸**：`writeDefaultGitignore` 写入前调用 `assertNoSymlinkComponent`；同时 `validateVaultRoot` 将该校验提升为所有 create/open/restore 入口的共同前置条件，`cloneInto` 在调用 Git 前验证目标全部现存组件。覆盖 vault 根 symlink、祖先 symlink、clone 外部目录不落盘。
2. **create initGit=false 缺护栏**：`vault:create` 无论 `initGit` 都调用模板修复；false 分支只执行无 Git 依赖的 `writeDefaultGitignore`，true 分支继续走 `initialize → ensureSyncGuard`。
3. **跳过计数恒为 0**：allowed staging 继续用 `--exclude-standard` 尊重用户规则；独立的计数枚举使用 `git ls-files --others -z`（不带 standard excludes），再由 `isVaultSyncGuardedPath` 过滤，仅输出数字。
4. **UTF-8 BOM 语义破坏**：读取后分离 BOM，输出顺序固定为 `BOM + template + userRulesWithoutBom`；回归使用真实 `git check-ignore secret.txt` 验证前后语义。
5. **“仅违规文件”判别力不足**：拆成纯场景并建立已删除 `.gitignore` 的 baseline。只创建 `notes/.DS_Store` 后提交，断言 HEAD 不变、cached diff 为空、`ls-files --error-unmatch` 失败且磁盘文件存在。

复审修复定向日志：`/tmp/DEV-058-r2-focused.log`（4 files / 85 tests passed）。

## 复审修复后六门禁

| 门禁 | 结果 | 绝对日志路径 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `/tmp/nexnote-DEV-058-r2-gates/typecheck.log` |
| `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | PASS（156 files passed / 1 skipped；1420 tests passed / 2 skipped）；前两次完整运行命中既有 watch-service 时序偶发失败，单文件复验通过，第三次完整重跑通过 | `/tmp/nexnote-DEV-058-r2-gates/test.log`（最终）`/tmp/DEV-058-r2-watch-retry.log`（复验） |
| `pnpm lint` | PASS（0 errors；4 个既有 warnings） | `/tmp/nexnote-DEV-058-r2-gates/lint.log` |
| `pnpm build` | PASS | `/tmp/nexnote-DEV-058-r2-gates/build.log` |
| changed-format（共同祖先 `4feefdd` + 未提交修复） | PASS | `/tmp/nexnote-DEV-058-r2-gates/format.log` |
| `git diff --check` | PASS | `/tmp/nexnote-DEV-058-r2-gates/diff.log` |

## 独立双轴复审 FAIL 历史与修复（00f554b 后续）

独立双轴复审对候选 `00f554b` 判定 **Standards FAIL / Spec FAIL**。上一轮 BOM / 跳过日志 / initGit=false / 纯违规测试均通过，新增以下修复：

1. **P1 High — 文件→目录递归绕过**：`git diff --name-only` 会返回“旧文件现为目录”的名字，按名字 `git add` 会递归吸入目录内容。修复：叶子 staging 只从 tracked index 派生删除（缺失/变目录即视为删除），添加仅接受当前 lstat 为普通文件的工作树路径；目录永远不作为 add 入口。孤立索引提交前对 `ls-files --cached` 全集执行 guarded 校验，任一违规路径即抛 `SYNC_GUARD_VIOLATION` 中止提交。真实反例 `notes` 文件 → `notes/` 目录 + `.DS_Store` 已验证：HEAD 删除旧 `notes`、不含 `notes/.DS_Store`、磁盘保留。
2. **P2 High — `..` 折叠绕过 symlink**：`assertNoSymlinkComponent` 先 `path.resolve`，`/safe/link/../vault` 会在 lstat 前折叠掉 `link`，但 Git 仍用原始 root。修复：归一化前拒绝任何原始 `..`/`.` 段；`validateVaultRoot` 改为返回 canonical 安全路径，create/open/clone/restore/initialize/模板写入的后续 Git cwd 与文件写入全部绑定该返回值。`/safe/link/../vault` 与中间组件回归已验证外部仓库 `.gitignore` 不被写入。
3. **S1 测试缺口**：拆分“不泛屏蔽用户数据库”。无用户规则时 `user.db` 提交并留在 HEAD 与磁盘；保留用户 `*.db` 规则保留测试。

## 00f554b 复审修复门禁（绑定新候选 SHA）

- **candidateSha**: `bcc2ff1b4f86b7bf9137795fe9df9cc1b8490dec`
- **evidence commit**: `fix(git): bind DEV-058 review evidence`（后附）

| 门禁 | 结果 | 绝对日志路径 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `/tmp/nexnote-DEV-058-r3-gates/typecheck.log` |
| `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | PASS（156 files passed / 1 skipped；1424 tests passed / 2 skipped） | `/tmp/nexnote-DEV-058-r3-gates/test.log` |
| `pnpm lint` | PASS（0 errors；4 个既有 warnings） | `/tmp/nexnote-DEV-058-r3-gates/lint.log` |
| `pnpm build` | PASS | `/tmp/nexnote-DEV-058-r3-gates/build.log` |
| changed-format（共同祖先 `4feefdd`） | PASS | `/tmp/nexnote-DEV-058-r3-gates/format.log` |
| `git diff --check` | PASS | `/tmp/nexnote-DEV-058-r3-gates/diff.log` |

定向复验：`/tmp/DEV-058-r3-focused.log`（4 files / 89 tests passed）。

## 独立双轴复审 FAIL 历史与修复（bcc2ff1 后续）

独立双轴复审对候选 `bcc2ff1` 判定 **Standards FAIL / Spec FAIL**。前几轮修复保留，新增以下修复：

1. **S1 P1 — 合法路径误拒**：删除 `trustedRoot + path.sep` 的字符串前缀判断；新增 `isWithinPathRoot`，只依据 `path.relative` 返回值判定边界（空串为同目录，`..` / `../` / `..\\` 为越界）。不在 temp/home 的 POSIX 外置卷和 Windows 其他盘符回退到自身文件系统根逐段 lstat，不再误拒。新增 POSIX `/Volumes/Notes/vault` 与 Windows `D:`/`E:` 纯函数 fixture。
2. **S2 P2 — Windows 混合分隔符**：原始路径在 resolve 前按 `/[\\/]/` 拆分，Windows `/`、`\\` 和混合分隔符中的 `.`/`..` 均拒绝；Git 返回路径分类仍维持 Git `/` 规则，不混用。
3. **S3 P2 — startup restore 失败事务**：restore guard/status 失败时清空 Git root，`VaultSession.close()` 回滚 current/last/broadcast，并重置 `restoreAttempted=false` 后重新抛错；后续 `vault:getState` 只能重新恢复或进入 onboarding，不会跳过修复返回 ready。集成测试使用真实 Git 仓库和 `.gitignore` symlink 验证两次查询。
4. **P1 Spec — 预暂存删除丢数据**：`stagedBefore` 与 worktree diff 都使用 `--no-renames`，源/目标 rename 分别受保护；普通 add/delete 的 `allowed` 与 `removed` 均排除 stagedBefore，guarded migration 仍单独处理。新增 staged-v2 后删除、staged 后文件→目录、staged rename 三个真实 index/OID/porcelain 回归。
5. **Canonical 路径一致性**：`validateVaultRoot` 返回值在 `restoreLast`、open、clone、clonePreflight、initGit 中均被继续用于 Git cwd 与写入路径，未再丢弃。

## bcc2ff1 后续复审修复门禁（绑定新候选 SHA）

- **candidateSha**: `17eac3956b71561bbe028866665156ad41800300`
- **evidence commit**: `docs(DEV-058): bind final review evidence`（后附）

| 门禁 | 结果 | 绝对日志路径 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `/tmp/nexnote-DEV-058-r4-gates/typecheck.log` |
| `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | PASS（156 files passed / 1 skipped；1430 tests passed / 2 skipped） | `/tmp/nexnote-DEV-058-r4-gates/test.log` |
| `pnpm lint` | PASS（0 errors；4 个既有 warnings） | `/tmp/nexnote-DEV-058-r4-gates/lint.log` |
| `pnpm build` | PASS | `/tmp/nexnote-DEV-058-r4-gates/build.log` |
| changed-format（共同祖先 `4feefdd`） | PASS | `/tmp/nexnote-DEV-058-r4-gates/format.log` |
| `git diff --check` | PASS | `/tmp/nexnote-DEV-058-r4-gates/diff.log` |

定向复验：`/tmp/DEV-058-r4-focused.log`（4 files / 95 tests passed）。

## 独立双轴复审 FAIL 历史与修复（17eac39 后续）

独立双轴复审对候选 `17eac39` 判定 **Standards FAIL / Spec FAIL**。前几轮修复保留，新增以下修复：

1. **F1/P1 — Windows 跨盘**：`isWithinRelativePath` 现在使用与 `relative` 相同的 `pathApi.isAbsolute`；`path.win32.relative('C:\\Users\\me', 'D:\\Vault') === 'D:\\Vault'` 会判定为跨盘，不再误当 within。`selectSafeRoot` 回退到目标自身 filesystem root（`D:\\`），后续逐组件 lstat 从目标盘开始。测试使用真实 `path.win32.relative/isAbsolute/parse`，不再伪造返回值。
2. **F2/P1 — restore 重入**：`VaultSession.open/restoreLast` 新增提交前 async preflight；startup guard 在 current/last/broadcast 之前运行。`vault:getState` 以单个 `restoreInFlight` Promise 合并并发查询；guard pending 时 session 始终不可见，两个查询一起等待同一恢复并在成功后同时 ready。guard 失败时清 Git root、lastVault、重置恢复状态且不会广播 ready。
3. **F3/P1 — staged 文件→目录**：普通 add/delete 候选按 Git `/` 段判定 stagedBefore 的祖先/后代 namespace 冲突；`a.md` staged 时 `a.md/inner.md` 被排除。真实测试先 stage `a.md=v2`，再把工作树替换成目录，断言 HEAD 保留 v1、真实 index OID 保留 v2、porcelain 不变且 inner 未跟踪。

## 17eac39 后续复审修复门禁（绑定新候选 SHA）

- **candidateSha**: `[AWS_SECRET_KEY_REDACTED]`
- **evidence commit**: `docs(DEV-058): bind fifth review evidence`（后附）

| 门禁 | 结果 | 绝对日志路径 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `/tmp/nexnote-DEV-058-r5-gates/typecheck.log` |
| `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | PASS（156 files passed / 1 skipped；1431 tests passed / 2 skipped） | `/tmp/nexnote-DEV-058-r5-gates/test.log` |
| `pnpm lint` | PASS（0 errors；4 个既有 warnings） | `/tmp/nexnote-DEV-058-r5-gates/lint.log` |
| `pnpm build` | PASS | `/tmp/nexnote-DEV-058-r5-gates/build.log` |
| changed-format（共同祖先 `4feefdd`） | PASS | `/tmp/nexnote-DEV-058-r5-gates/format.log` |
| `git diff --check` | PASS | `/tmp/nexnote-DEV-058-r5-gates/diff.log` |

定向复验：`/tmp/DEV-058-r5-focused.log`（4 files / 96 tests passed）。

## 独立双轴复审结果与修复（87ea911 后续）

独立双轴复审对候选 `87ea911` 判定 **Standards PASS / Spec FAIL**，仅剩两项，现已修复：

1. **P1 — `.gitignore` 非 UTF-8 字节与模板位置**：`writeDefaultGitignore` 全程读取/写入 Buffer；按 `EF BB BF` 字节识别 BOM；用户规则保持原始 Buffer，不经 UTF-8 replacement decode。模板检测仅对规范化解码做 prefix 判断，必须 `startsWith(template)`；用户规则之后出现完整模板仍会重排为 `BOM + templateBytes + originalUserBytes`。测试覆盖 `23 20 FF 0A` 字节逐字保留、不出现 `EF BF BD`、尾部完整模板重排以及真实 `git check-ignore` 语义。
2. **P2 — 普通 cached deletion 证据**：新增真实测试：HEAD `a.md=v1`，删除工作树文件并执行 `git add -u -- a.md`，记录 HEAD/cached diff/porcelain；`commitManual` 后 HEAD 未变化、cached deletion 与 porcelain 均逐字保持。

## 87ea911 后续复审修复门禁（绑定新候选 SHA）

- **candidateSha**: `[AWS_SECRET_KEY_REDACTED]`
- **evidence commit**: `docs(DEV-058): bind sixth review evidence`（后附）

| 门禁 | 结果 | 绝对日志路径 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `/tmp/nexnote-DEV-058-r6-gates/typecheck.log` |
| `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | PASS（156 files passed / 1 skipped；1434 tests passed / 2 skipped） | `/tmp/nexnote-DEV-058-r6-gates/test.log` |
| `pnpm lint` | PASS（0 errors；4 个既有 warnings） | `/tmp/nexnote-DEV-058-r6-gates/lint.log` |
| `pnpm build` | PASS | `/tmp/nexnote-DEV-058-r6-gates/build.log` |
| changed-format（共同祖先 `4feefdd`） | PASS | `/tmp/nexnote-DEV-058-r6-gates/format.log` |
| `git diff --check` | PASS | `/tmp/nexnote-DEV-058-r6-gates/diff.log` |

定向复验：`/tmp/DEV-058-r6-focused.log`（4 files / 99 tests passed）。

## 独立双轴复审结果与修复（de184a8 后续）

独立双轴复审对候选 `de184a8` 判定 **Standards PASS / Spec FAIL**，仅剩模板后置重复一项，现已修复：

1. **canonical template block 字节级移动**：识别 LF/CRLF 两种完整 canonical block，仅在行边界匹配；若模板已作为唯一 LF 前缀则幂等返回。若模板位于中间/尾部，从原始用户 Buffer 删除全部完整 block 及一个紧邻换行分隔，再输出 `BOM + canonical LF template + remaining original user bytes`。用户内容全程只切片/拼接，不 decode/re-encode，非 UTF-8 字节与 BOM 均保真。
2. **用户规则优先级**：真实 `git check-ignore` 测试覆盖 `!/.DS_Store` 在模板前、完整模板在后；修复后模板只出现一次、`.DS_Store` ignore 行只出现一次、用户反转规则位于模板之后并生效（NOT_IGNORED）。
3. **中间 CRLF 模板**：中间 canonical CRLF block 被移除并转换为唯一前置 LF block，前后用户原始字节保留。

## de184a8 后续复审修复门禁（绑定新候选 SHA）

- **candidateSha**: `[AWS_SECRET_KEY_REDACTED]`
- **evidence commit**: `docs(DEV-058): bind seventh review evidence`（后附）

| 门禁 | 结果 | 绝对日志路径 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `/tmp/nexnote-DEV-058-r7-gates/typecheck.log` |
| `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | PASS（156 files passed / 1 skipped；1435 tests passed / 2 skipped） | `/tmp/nexnote-DEV-058-r7-gates/test.log` |
| `pnpm lint` | PASS（0 errors；4 个既有 warnings） | `/tmp/nexnote-DEV-058-r7-gates/lint.log` |
| `pnpm build` | PASS | `/tmp/nexnote-DEV-058-r7-gates/build.log` |
| changed-format（共同祖先 `4feefdd`） | PASS | `/tmp/nexnote-DEV-058-r7-gates/format.log` |
| `git diff --check` | PASS | `/tmp/nexnote-DEV-058-r7-gates/diff.log` |

定向复验：`/tmp/DEV-058-r7-focused.log`（4 files / 100 tests passed）。

## 独立双轴复审结果与修复（a2b1903 后续）

独立双轴复审对候选 `a2b1903` 判定 **Standards PASS / Spec FAIL**，仅剩两项，现已修复：

1. **P1 — 删除模板前换行粘连**：模板定位函数只返回模板本体范围；移除阶段只删除模板自身字节，绝不回退删除前一用户行终止符，也不吞后一用户行边界。LF/CRLF 参数化测试精确断言 remaining user Buffer 为 `!/.DS_Store<EOL># tail<EOL>`，真实 `git check-ignore .DS_Store` 返回 NOT_IGNORED。
2. **P2 — 非行首伪匹配遮蔽**：每个 variant 使用持续推进 search offset 的纯 Buffer 扫描函数；inline 非行首命中会跳过并继续搜索后续合法行首 block。多个 variant 每轮选择最早合法 block。LF/CRLF 参数化测试覆盖 `# inline ` + 伪模板 + 用户反转规则 + 合法模板：仅合法模板被删除，inline 字节逐字保留，前置 canonical 仅一次，反转规则最终生效。
3. **既有保证**：BOM、非 UTF-8、多模板和幂等测试继续通过。

## a2b1903 后续复审修复门禁（绑定新候选 SHA）

- **candidateSha**: `[AWS_SECRET_KEY_REDACTED]`
- **evidence commit**: `docs(DEV-058): bind eighth review evidence`（后附）

| 门禁 | 结果 | 绝对日志路径 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `/tmp/nexnote-DEV-058-r8-gates/typecheck.log` |
| `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | PASS（156 files passed / 1 skipped；1438 tests passed / 2 skipped） | `/tmp/nexnote-DEV-058-r8-gates/test.log` |
| `pnpm lint` | PASS（0 errors；4 个既有 warnings） | `/tmp/nexnote-DEV-058-r8-gates/lint.log` |
| `pnpm build` | PASS | `/tmp/nexnote-DEV-058-r8-gates/build.log` |
| changed-format（共同祖先 `4feefdd`） | PASS | `/tmp/nexnote-DEV-058-r8-gates/format.log` |
| `git diff --check` | PASS | `/tmp/nexnote-DEV-058-r8-gates/diff.log` |

定向复验：`/tmp/DEV-058-r8-focused.log`（4 files / 103 tests passed）。

## 未改动范围

- `master` / 其他分支 / 全局台账均未触碰。
- `restoreFile` 仍走 `git checkout` + `commit --only -- path`，不受本次 staging 改写影响。
- `confidenceHistory`、`timeline`、`rawStatusPorcelain` 等只读出口维持原状。
