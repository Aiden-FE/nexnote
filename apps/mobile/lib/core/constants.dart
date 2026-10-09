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

/// 同步状态
enum SyncState { idle, running, upToDate, ahead, conflict, error }

/// 语言中性的 Git 错误码；UI 层据此成文，detail 只承载底层诊断。
enum GitErrorCode {
  notInitialized,
  vaultNotEmpty,
  noChanges,
  conflictBlocked,
  credentialsMissing,
  networkFailed,
  authenticationFailed,
  certificateRejected,
  remoteRejected,
  gitOperationFailed,
}

/// 提交类型（与桌面端 `kind` 对齐）
enum CommitKind { initial, auto, manual, restore, unknown }

/// Git 错误分类
enum GitErrorKind { network, auth, hostKey, remoteRejected, conflict, unknown }
