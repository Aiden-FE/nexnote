// 应用级常量与领域约定
library;

/// 提交消息前缀——与桌面端行为语义一致（桌面 `GitService` 约定）
abstract final class CommitPrefix {
  static const auto = 'nexnote:auto:';
  static const manual = 'nexnote:manual:';
  static const initial = 'nexnote:init:';
}

/// 同步消息，与桌面端 `git.autoSync` 状态广播语义对齐
abstract final class SyncMessages {
  static const starting = '开始同步…';
  static const fetching = '拉取远端…';
  static const rebasing = '整合远端变更…';
  static const pushing = '推送本地变更…';
  static const done = '同步完成';
  static const doneUpToDate = '已是最新';
  static const nothingToPush = '本地无新提交';
  static const dirtyRejected = '工作区有未提交变更，已跳过自动同步';
}

/// 同步状态
enum SyncState { idle, running, upToDate, ahead, conflict, error }

/// 提交类型（り与桌面端 `kind` 对齐）
enum CommitKind { initial, auto, manual, restore, unknown }

///Git 错误分类
enum GitErrorKind { network, auth, hostKey, remoteRejected, conflict, unknown }
