// Git 层公开类型——MOB-004
library;

import '../core/constants.dart';

/// 知识库 Git 状态快照
class VaultStatus {
  /// 是否已初始化 Git 仓库
  final bool initialized;

  /// 当前分支名
  final String branch;

  /// 工作区变更（已按护栏过滤）
  final List<String> changed;

  /// 相对上游的领先提交数
  final int ahead;

  /// 相对上游的落后提交数
  final int behind;

  /// 是否处于冲突/未完成操作状态（rebase/merge 等）
  final bool conflict;

  /// 远端地址（已脱敏）
  final String? remoteUrl;

  /// 最近一次同步结果文案
  final String? lastSyncMessage;

  const VaultStatus({
    required this.initialized,
    required this.branch,
    required this.changed,
    required this.ahead,
    required this.behind,
    required this.conflict,
    this.remoteUrl,
    this.lastSyncMessage,
  });

  /// 未推送提交数（设备端是这些提交的唯一副本）
  int get unpushed => ahead;

  bool get dirty => changed.isNotEmpty;

  /// 是否允许写入（冲突禁写）
  bool get writable => !conflict;

  /// 状态摘要文案
  String get summary {
    if (!initialized) return '尚未初始化 Git';
    if (conflict) return '同步冲突：请在桌面端处理后重新同步';
    return '$branch · 变更 ${changed.length} · 领先 $ahead · 落后 $behind';
  }
}

/// 一次同步的结果
class SyncResult {
  final SyncState state;
  final String message;
  final int ahead;
  final int behind;
  final int pushed;

  const SyncResult({
    required this.state,
    required this.message,
    this.ahead = 0,
    this.behind = 0,
    this.pushed = 0,
  });

  bool get ok => state != SyncState.error && state != SyncState.conflict;
}
