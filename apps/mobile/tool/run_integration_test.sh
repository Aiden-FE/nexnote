#!/usr/bin/env bash
# 一键跑手机端集成测试：先生成 fixture，再把远端地址注入测试。
#
# 用法：
#   ./tool/run_integration_test.sh                 # 跑全部集成测试文件
#   ./tool/run_integration_test.sh git_spike_test  # 只跑指定文件（去 .dart）
#   SIM=<udid> ./tool/run_integration_test.sh      # 指定模拟器
#
# 兼容 macOS 自带 bash 3.2：不用 mapfile / gawk match 第三参数 / 关联数组。
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REMOTE_URL="$("$SCRIPT_DIR/make_test_fixture.sh" | tail -1)"
cd "$MOBILE_DIR"

# 未指定模拟器时取已启动的第一个 iOS 模拟器（grep -oE，macOS/BSD 可用）
if [ -z "${SIM:-}" ]; then
  SIM="$(xcrun simctl list devices booted \
    | awk '/-- iOS/ {seen=1} seen && /\(Booted\)/ {print; exit}' \
    | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
fi
if [ -z "${SIM:-}" ]; then
  echo "没有已启动的 iOS 模拟器。先启动一个，或用 SIM=<udid> 指定。" >&2
  exit 1
fi
echo "模拟器: $SIM"

RUN_LIST=""
if [ $# -gt 0 ]; then
  RUN_LIST="$*"
else
  for f in integration_test/*.dart; do
    base="$(basename "$f" .dart)"
    if [ -z "$RUN_LIST" ]; then RUN_LIST="$base"; else RUN_LIST="$RUN_LIST $base"; fi
  done
fi

for name in $RUN_LIST; do
  echo "=== $name ==="
  flutter test "integration_test/$name.dart" -d "$SIM" \
    --dart-define=NEXNOTE_SPIKE_REMOTE="$REMOTE_URL"
done
