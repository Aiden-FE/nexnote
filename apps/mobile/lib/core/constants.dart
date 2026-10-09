// 应用级常量与领域约定
library;

/// 提交消息前缀——与桌面端行为语义一致（桌面 `GitService` 约定）
abstract final class CommitPrefix {
  static const auto = 'nexnote:auto:';
  static const manual = 'nexnote:manual:';
  static const initial = 'nexnote:init:';
}

/// 同步消息种类（语言中性）；由 UI 层翻译为当前界面语言（ADR-0023）。
/// 与桌面端 `git.autoSync` 状态广播语义对齐。
enum SyncMessageKind {
  inProgress,
  fetching,
  rebasing,
  pushing,
  done,
  upToDate,
  nothingToPush,
  dirtyRejected,
}

/// 兼容过渡：旧调用点的字符串常量改为对应枚举。
abstract final class SyncMessages {
  static const starting = SyncMessageKind.inProgress;
  static const fetching = SyncMessageKind.fetching;
  static const rebasing = SyncMessageKind.rebasing;
  static const pushing = SyncMessageKind.pushing;
  static const done = SyncMessageKind.done;
  static const doneUpToDate = SyncMessageKind.upToDate;
  static const nothingToPush = SyncMessageKind.nothingToPush;
  static const dirtyRejected = SyncMessageKind.dirtyRejected;
}

/// 同步状态
enum SyncState { idle, running, upToDate, ahead, conflict, error }

/// 提交类型（り与桌面端 `kind` 对齐）
enum CommitKind { initial, auto, manual, restore, unknown }

///Git 错误分类
enum GitErrorKind { network, auth, hostKey, remoteRejected, conflict, unknown }
