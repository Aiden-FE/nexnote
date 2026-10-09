// 界面文案翻译——把服务层的语言中性错误码与状态枚举成文（ADR-0023 / ADR-0024）。
//
// 服务层只返回错误码与底层诊断 detail，不含面向用户的中文；
// 写入知识库的数据（页面正文、提交摘要、AI 提示词）不经过这里。
library;

import '../core/constants.dart';
import '../git/device_git_service.dart';
import '../git/git_types.dart';
import '../l10n/app_localizations.dart';

/// 同步消息种类
String describeSyncMessage(AppLocalizations l10n, SyncMessageKind kind) {
  return switch (kind) {
    SyncMessageKind.inProgress => l10n.syncInProgress,
    SyncMessageKind.fetching => l10n.syncFetching,
    SyncMessageKind.rebasing => l10n.syncRebasing,
    SyncMessageKind.pushing => l10n.syncPushing,
    SyncMessageKind.done => l10n.syncDone,
    SyncMessageKind.upToDate => l10n.syncUpToDate,
    SyncMessageKind.nothingToPush => l10n.syncNothingToPush,
    SyncMessageKind.dirtyRejected => l10n.syncDirtyRejected,
  };
}

/// 同步状态
String describeSyncState(AppLocalizations l10n, SyncState state) {
  return switch (state) {
    SyncState.idle => l10n.syncStateIdle,
    SyncState.running => l10n.syncStateRunning,
    SyncState.upToDate => l10n.syncStateUpToDate,
    SyncState.ahead => l10n.syncStateAhead,
    SyncState.conflict => l10n.syncStateConflict,
    SyncState.error => l10n.syncStateError,
  };
}

/// Git 状态摘要；服务层只提供结构化字段。
String describeGitStatusSummary(AppLocalizations l10n, VaultStatus status) {
  if (!status.initialized) return l10n.gitNotInitialized;
  if (status.conflict) return l10n.gitConflictSummary;
  return l10n.gitStatusSummary(
    status.branch,
    status.changed.length,
    status.ahead,
    status.behind,
  );
}

/// Git 错误码；有底层诊断 detail 时作为诊断信息附在成文之后。
String describeGitError(AppLocalizations l10n, GitServiceError error) {
  final text = switch (error.code) {
    GitErrorCode.notInitialized => l10n.gitErrNotInitialized,
    GitErrorCode.vaultNotEmpty => l10n.gitErrVaultNotEmpty,
    GitErrorCode.noChanges => l10n.gitErrNoChanges,
    GitErrorCode.conflictBlocked => l10n.gitErrConflictBlocked,
    GitErrorCode.credentialsMissing => l10n.gitErrCredentialsMissing,
    GitErrorCode.networkFailed => l10n.gitErrNetwork,
    GitErrorCode.authenticationFailed => l10n.gitErrAuth,
    GitErrorCode.certificateRejected => l10n.gitErrCertificate,
    GitErrorCode.remoteRejected => l10n.gitErrRemoteRejected,
    GitErrorCode.gitOperationFailed => l10n.gitErrOperation,
  };
  final detail = error.detail?.trim();
  if (detail == null || detail.isEmpty) return text;
  return l10n.messageWithDetail(text, detail);
}
