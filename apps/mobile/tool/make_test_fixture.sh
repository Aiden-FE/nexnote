#!/usr/bin/env bash
# 生成手机端集成测试用的本地 Git 远端（fixture）。
#
# 产物是纯本地产物（内含 .git 的嵌套仓库），不入版本库：
#   apps/mobile/.test-fixture/vault/        工作树（含 4 个验收页面）
#   apps/mobile/.test-fixture/remote.git/   bare 远端
#
# 幂等：每次执行都从干净基线重建，可重复运行。
# 用法：./tool/make_test_fixture.sh          # 重建并打印 file:// 远端地址
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$MOBILE_DIR/.test-fixture"
VAULT_DIR="$FIXTURE_DIR/vault"
REMOTE_DIR="$FIXTURE_DIR/remote.git"

command -v git >/dev/null || { echo "需要 git" >&2; exit 1; }

# 幂等重建：先清空 fixture 目录（含嵌套 .git）。
# 路径守卫：只允许清理本脚本自己的 .test-fixture 目录。
case "$FIXTURE_DIR" in
  */apps/mobile/.test-fixture) ;;
  *) echo "拒绝清理非预期路径: $FIXTURE_DIR" >&2; exit 1 ;;
esac
rm -rf "$FIXTURE_DIR"
mkdir -p "$VAULT_DIR/notes" "$VAULT_DIR/refs"

# 干净基线：覆盖标题/元数据头/双链/标签/中文分词/表格公式代码块/引用/任务列表
cat > "$VAULT_DIR/index.md" <<'EOF'
---
title: NexNote 移动端验收库
tags:
  - fixture
  - index
aliases:
  - 验收库
  - 根页面
created: 2026-09-01 09:00
type: note
---

# NexNote 移动端验收库

这是 [[设备端同步]] 与 [[基础编辑]] 的验收知识库，用于手机端各里程碑的真机验证。

## 关键词

搜索基准、基准测试、索引分词、往返保真 —— 这些词用于验证中文子串搜索。

## 关系

- 上级：[[根页面]]
- 相关：[[移动端计划]]
EOF

cat > "$VAULT_DIR/notes/设备端同步.md" <<'EOF'
---
title: 设备端同步
tags:
  - git
  - fixture
created: 2026-09-02 10:30
type: note
---

# 设备端同步

手机端直接对 Git 远程执行窄口径同步。参见 [[NexNote 移动端验收库]]。

## 提交节奏

- 防抖 30 秒
- 最小间隔 2 秒
EOF

cat > "$VAULT_DIR/notes/基础编辑.md" <<'EOF'
---
title: 基础编辑
tags:
  - editor
  - fixture
created: 2026-09-03 14:20
type: note
---

# 基础编辑

包含源码编辑与简化块编辑两种模式。

## 不支持结构样例

| 块类型 | 状态 | 说明 |
| --- | --- | --- |
| 表格 | 只读 | 块模式占位 |
| 公式 | 只读 | 块模式占位 |

行内公式：$E = mc^2$ 与块级公式：

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

```dart
void main() {
  print('代码块保真');
}
```
EOF

cat > "$VAULT_DIR/refs/移动端计划.md" <<'EOF'
---
title: 移动端计划
tags:
  - fixture
created: 2026-09-04 08:00
type: note
---

# 移动端计划

里程碑：M1 Git、M2 阅读搜索、M3 编辑、M4 捕获与 AI。

关联 [[设备端同步]]。
EOF

git -C "$VAULT_DIR" init -q -b main
git -C "$VAULT_DIR" config user.name "NexNote Fixture"
git -C "$VAULT_DIR" config user.email "fixture@nexnote.local"
git -C "$VAULT_DIR" add -A
git -C "$VAULT_DIR" commit -q -m "nexnote:init: 移动端验收知识库（干净基线）"
git clone -q --bare "$VAULT_DIR" "$REMOTE_DIR"

echo "fixture 已生成："
echo "  工作树: $VAULT_DIR"
echo "  远端  : $REMOTE_DIR"
echo "file://$REMOTE_DIR"
