// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'NexNote';

  @override
  String get navVault => 'Vault';

  @override
  String get navSearch => 'Search';

  @override
  String get navCapture => 'Capture';

  @override
  String get navAi => 'AI';

  @override
  String get navSettings => 'Settings';

  @override
  String get vaultTitle => 'Vault';

  @override
  String get vaultTagFilterTooltip => 'Filter by tag';

  @override
  String get vaultEmpty =>
      'The device vault is empty. Clone or initialize it from Settings.';

  @override
  String get vaultRootDir => 'root';

  @override
  String get vaultUncategorized => 'uncategorized';

  @override
  String get searchTitle => 'Search';

  @override
  String get searchHint => 'Search page content (Chinese substrings supported)';

  @override
  String searchResultCount(int count) {
    return '$count matching pages';
  }

  @override
  String get searchInitial => 'Type a keyword to search';

  @override
  String get searchRebuild => 'Rebuild index';

  @override
  String get searchNoResults => 'No matching results';

  @override
  String get captureTitle => 'Capture';

  @override
  String captureDirectory(String directory) {
    return 'Saves to: $directory';
  }

  @override
  String get captureHint =>
      'Jot something down; the first line becomes the title';

  @override
  String get captureAction => 'Capture';

  @override
  String captureSuccess(String title) {
    return 'Captured: $title';
  }

  @override
  String get captureOpenLast => 'Open the page just captured';

  @override
  String get aiTitle => 'AI Chat';

  @override
  String get aiClearTooltip => 'Clear';

  @override
  String get aiNoProfile => 'No provider profile configured (read-only chat)';

  @override
  String aiReadOnlySession(String name, String model) {
    return 'Read-only · $name · $model';
  }

  @override
  String get aiEmptyHint =>
      'Questions run a two-stage recall first (keywords + link expansion)';

  @override
  String get aiInputHint => 'Ask something…';

  @override
  String get aiThinking => 'Thinking…';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsDeviceVault => 'Device Vault';

  @override
  String settingsPath(String path) {
    return 'Path: $path';
  }

  @override
  String settingsPageCount(int count) {
    return 'Pages: $count';
  }

  @override
  String get settingsBackupOn => 'Excluded from iCloud backup: active';

  @override
  String get settingsBackupOff => 'Excluded from iCloud backup: unconfirmed';

  @override
  String settingsUnpushed(int count) {
    return '$count unpushed commits. This device is their only copy — sync soon.';
  }

  @override
  String get settingsGitStatus => 'Git Status';

  @override
  String get settingsReading => 'Loading…';

  @override
  String settingsRemote(String url) {
    return 'Remote: $url';
  }

  @override
  String get settingsConflictBanner =>
      'Sync conflict: writes are disabled on mobile; resolve on desktop';

  @override
  String get settingsRemoteLabel => 'Test remote (file:// or https://)';

  @override
  String get settingsClone => 'Clone remote';

  @override
  String get settingsWriteAndCommit => 'Write page and commit';

  @override
  String get settingsSyncNow => 'Sync now';

  @override
  String get settingsTimeline => 'Version timeline';

  @override
  String get settingsNoCommits => '(no commits yet)';

  @override
  String get settingsCaptureDir => 'Quick capture folder';

  @override
  String get settingsCapturePathLabel => 'Relative path inside the vault';

  @override
  String get settingsSave => 'Save';

  @override
  String get settingsAiProfiles => 'AI Provider Profiles';

  @override
  String get settingsKeyConfigured => 'key configured';

  @override
  String get settingsKeyMissing => 'no key';

  @override
  String get settingsAddProfile => 'Add profile';

  @override
  String get settingsDiagnosticLog => 'Diagnostic log';

  @override
  String get settingsNoLog => '(no log yet)';

  @override
  String get settingsBackupExcludeFailed =>
      'Failed to write the backup-exclusion marker; check system settings';

  @override
  String settingsActionDone(String label) {
    return '$label: done';
  }

  @override
  String settingsActionFailed(String label, String detail) {
    return '$label: failed $detail';
  }

  @override
  String get settingsCloneLabel => 'Clone';

  @override
  String settingsCommitAppend(String sha) {
    return 'Commit $sha';
  }

  @override
  String get settingsNoChange => '(no changes)';

  @override
  String settingsSyncResult(String state, String message) {
    return 'Sync $state: $message';
  }

  @override
  String settingsCaptureUpdated(String dir) {
    return 'Capture folder updated to $dir';
  }

  @override
  String get tagsTitle => 'Tags';

  @override
  String get tagsEmpty => 'No tags yet';

  @override
  String tagsPageCount(int count) {
    return '$count pages';
  }

  @override
  String get graphTitle => 'Graph';

  @override
  String graphSummary(int nodes, int edges, int unresolved) {
    return '$nodes nodes · $edges edges · $unresolved unresolved (tap a node to open; read-only)';
  }

  @override
  String get readerMissing => 'Page not found';

  @override
  String readerTargetMissing(String target) {
    return 'Target page not found: $target';
  }

  @override
  String get readerOutlineTooltip => 'Outline';

  @override
  String get readerBacklinksTooltip => 'Backlinks';

  @override
  String get readerTimelineTooltip => 'Version timeline';

  @override
  String get readerGraphTooltip => 'Graph';

  @override
  String get readerEditTooltip => 'Edit';

  @override
  String readerBacklinksButton(int count) {
    return 'Backlinks ($count)';
  }

  @override
  String get readerNoBacklinks => 'No backlinks yet';

  @override
  String get readerNoCommits => 'No commits yet';

  @override
  String readerType(String value) {
    return 'type $value';
  }

  @override
  String readerCreated(String value) {
    return 'created $value';
  }

  @override
  String readerUpdated(String value) {
    return 'updated $value';
  }

  @override
  String readerAliases(String value) {
    return 'aliases $value';
  }

  @override
  String readerConfidence(String value) {
    return 'confidence $value';
  }

  @override
  String get blockTitle => 'Block Editor';

  @override
  String get blockSwitchToSource => 'Switch to source mode';

  @override
  String get blockSave => 'Save';

  @override
  String get blockConflict =>
      'Writes disabled by sync conflict: resolve it on desktop, then retry';

  @override
  String blockFrontmatter(String content) {
    return 'Frontmatter (read-only)\n$content';
  }

  @override
  String blockCode(String language) {
    return 'code$language';
  }

  @override
  String get blockImage => 'image';

  @override
  String get blockTable => 'table (read-only)';

  @override
  String get blockMath => 'math (read-only)';

  @override
  String get blockHtml => 'HTML (read-only)';

  @override
  String get blockEditableInSource => 'Editable in source mode';

  @override
  String get sourceTitle => 'Source Editor';

  @override
  String get sourceSwitchToBlock => 'Switch to block editor';

  @override
  String get sourceSave => 'Save';

  @override
  String get sourceConflict =>
      'Writes disabled by sync conflict: resolve it on desktop, then retry';

  @override
  String get sourceFrontmatter => 'Frontmatter (read-only)';

  @override
  String get saveAutoCommit => 'Saved; it will be committed automatically';

  @override
  String get saveNoChange => 'No content changes';

  @override
  String saveFailed(String message) {
    return 'Save failed: $message';
  }

  @override
  String get mdMathReadonly => 'math (read-only)';

  @override
  String get mdImageAlt => 'image';

  @override
  String mdImageMissing(String alt, String src) {
    return 'image: $alt ($src)';
  }

  @override
  String get mdImagePlaceholder => '[image]';

  @override
  String mdImagePlaceholderAlt(String alt) {
    return '[image:$alt]';
  }

  @override
  String get profileRequired => 'Name and base-url are required';

  @override
  String get profileAdd => 'Add profile';

  @override
  String get profileEdit => 'Edit profile';

  @override
  String get profileName => 'Name';

  @override
  String get profileModel => 'Model';

  @override
  String get profileApiKey => 'API Key';

  @override
  String get profileApiKeyKeep =>
      'API Key (leave blank to keep the current key)';

  @override
  String get profileCancel => 'Cancel';

  @override
  String get profileSave => 'Save';

  @override
  String get errNoProfile =>
      'No provider profile configured. Add one in Settings.';

  @override
  String get errNoApiKey => 'This profile has no API key configured';

  @override
  String errProvider(String detail) {
    return 'Provider request failed: $detail';
  }

  @override
  String get syncInProgress => 'Syncing…';

  @override
  String get syncFetching => 'Fetching from remote…';

  @override
  String get syncRebasing => 'Rebasing onto remote…';

  @override
  String get syncPushing => 'Pushing local changes…';

  @override
  String get syncDone => 'Sync complete';

  @override
  String get syncUpToDate => 'Already up to date';

  @override
  String get syncNothingToPush => 'Nothing new to push';

  @override
  String get syncDirtyRejected =>
      'Uncommitted changes present; auto-sync skipped';

  @override
  String get gitNotInitialized => 'Git not initialized';

  @override
  String get gitConflictSummary =>
      'Sync conflict: resolve it on desktop, then sync again';

  @override
  String gitStatusSummary(String branch, int changed, int ahead, int behind) {
    return '$branch · $changed changed · $ahead ahead · $behind behind';
  }

  @override
  String get recallKeyword => 'keywords';

  @override
  String get recallLinks => 'link expansion';

  @override
  String get captureEmpty => 'Content is empty';

  @override
  String get captureUntitled => 'Untitled capture';

  @override
  String get settingsLanguage => 'Interface language';

  @override
  String get settingsLanguageSystem => 'Match system';

  @override
  String get settingsLanguageZh => '简体中文';

  @override
  String get settingsLanguageEn => 'English';
}
