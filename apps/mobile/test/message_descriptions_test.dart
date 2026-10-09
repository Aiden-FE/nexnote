// 错误码化契约：服务层只产出语言中性码，界面层按语言成文（ADR-0023 / ADR-0024）。
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/app/message_descriptions.dart';
import 'package:nexnote_mobile/core/constants.dart';
import 'package:nexnote_mobile/git/device_git_service.dart';
import 'package:nexnote_mobile/l10n/app_localizations.dart';

void main() {
  late AppLocalizations zh;
  late AppLocalizations en;

  setUp(() async {
    zh = await AppLocalizations.delegate.load(const Locale('zh'));
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  test('同步状态与消息按语言成文，不暴露枚举名', () {
    for (final state in SyncState.values) {
      expect(describeSyncState(zh, state), isNotEmpty);
      expect(describeSyncState(en, state), isNotEmpty);
    }
    for (final kind in SyncMessageKind.values) {
      for (final l10n in [zh, en]) {
        expect(describeSyncMessage(l10n, kind), isNotEmpty);
        expect(describeSyncMessage(l10n, kind), isNot(equals(kind.name)));
      }
    }
  });

  test('Git 错误码全部可成文；带 detail 时附加诊断', () {
    const codes = GitErrorCode.values;
    expect(codes.length, greaterThanOrEqualTo(10));
    for (final code in codes) {
      final error = GitServiceError(GitErrorKind.unknown, code);
      final zhText = describeGitError(zh, error);
      final enText = describeGitError(en, error);
      expect(zhText, isNotEmpty);
      expect(enText, isNotEmpty);
      expect(zhText, isNot(enText));
      expect(zhText, isNot(contains(code.name)));
    }

    const withDetail = GitServiceError(
      GitErrorKind.network,
      GitErrorCode.networkFailed,
      detail: 'connection refused',
    );
    expect(describeGitError(zh, withDetail), contains('connection refused'));
    expect(describeGitError(en, withDetail), contains('connection refused'));
  });

  test('应用自带的 Git 错误不携带面向用户的中文', () {
    for (final error in <GitServiceError>[
      const GitServiceError(GitErrorKind.unknown, GitErrorCode.notInitialized),
      const GitServiceError(GitErrorKind.unknown, GitErrorCode.vaultNotEmpty),
      const GitServiceError(GitErrorKind.unknown, GitErrorCode.noChanges),
      const GitServiceError(GitErrorKind.conflict, GitErrorCode.conflictBlocked),
      const GitServiceError(
          GitErrorKind.auth, GitErrorCode.credentialsMissing),
    ]) {
      expect(error.detail, isNull);
      final enText = describeGitError(en, error);
      expect(enText.contains(RegExp(r'[\u4e00-\u9fff]')), isFalse);
    }
  });
}
