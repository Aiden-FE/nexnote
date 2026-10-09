import 'package:flutter/material.dart';

import '../../core/constants.dart';
import '../../core/models.dart';
import '../../git/device_git_service.dart';
import '../../git/git_types.dart';
import '../../ai/secret_vault.dart';
import '../../vault/backup_exclusion.dart';
import '../app_services.dart';
import '../message_descriptions.dart';
import 'settings/ai_profile_editor.dart';
import '../../l10n/app_localizations.dart';

/// 设置与诊断：设备知识库信息、Git 状态、同步与 M1 验收动作
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  VaultStatus? _status;
  List<CommitRecord> _timeline = const [];
  final _log = <String>[];
  bool _busy = false;

  /// 测试远端地址：由集成测试用 --dart-define=NEXNOTE_SPIKE_REMOTE 注入。
  /// 留空则该字段为空（手动粘贴 https:// 或 file:// 地址即可）。
  static const _spikeRemoteOverride =
      String.fromEnvironment('NEXNOTE_SPIKE_REMOTE');

  static String get _spikeRemoteDefault => _spikeRemoteOverride;

  final _remoteController =
      TextEditingController(text: _spikeRemoteDefault);

  final _captureDirController =
      TextEditingController(text: appServices.settings.captureDirectory);

  /// 密钥存取：真机走 Keychain
  final SecretVault _secrets = KeychainSecretVault();

  @override
  void initState() {
    super.initState();
    _refresh();
    _ensureBackupExcluded();
  }

  @override
  void dispose() {
    _remoteController.dispose();
    _captureDirController.dispose();
    super.dispose();
  }

  void _append(String line) {
    setState(() {
      _log.insert(0, '${DateTime.now().toIso8601String().substring(11, 19)} $line');
      if (_log.length > 40) _log.removeLast();
    });
  }

  void _refresh() {
    final git = appServices.gitService;
    setState(() {
      _status = git.status();
      _timeline = git.isRepoInitialized ? git.timeline(limit: 10) : const [];
    });
  }

  Future<void> _ensureBackupExcluded() async {
    final ok = await appServices.vaultStore.ensureExcludedFromBackup();
    if (!ok && mounted) {
      _append(AppLocalizations.of(context)!.settingsBackupExcludeFailed);
    }
  }

  Future<void> _run(String label, Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      if (!mounted) return;
      _append(AppLocalizations.of(context)!.settingsActionDone(label));
    } on GitServiceError catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      _append(
        l10n.settingsActionFailed(label, describeGitError(l10n, e)),
      );
    } on Object catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      _append(
        l10n.settingsActionFailed(label, l10n.errUnexpected(e.toString())),
      );
    } finally {
      setState(() => _busy = false);
      _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final git = appServices.gitService;
    final status = _status;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.settingsTitle),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.settingsDeviceVault,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(l10n.settingsPath(appServices.vaultStore.rootPath)),
                  Text(l10n.settingsPageCount(
                      appServices.vaultRepository.listPagePaths().length)),
                  Text(appServices.backupExcluded
                      ? l10n.settingsBackupOn
                      : l10n.settingsBackupOff),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.settingsLanguage,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: SegmentedButton<String>(
                      segments: [
                        ButtonSegment(
                          value: 'system',
                          label: Text(l10n.settingsLanguageSystem),
                        ),
                        ButtonSegment(
                          value: 'zh',
                          label: Text(l10n.settingsLanguageZh),
                        ),
                        ButtonSegment(
                          value: 'en',
                          label: Text(l10n.settingsLanguageEn),
                        ),
                      ],
                      selected: {
                        appServices.localeOverride.value?.languageCode ??
                            'system'
                      },
                      onSelectionChanged: (values) {
                        final code = values.first;
                        appServices.setLanguageOverride(
                          code == 'system' ? null : Locale(code),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          if ((status?.unpushed ?? 0) > 0)
            Card(
              color: Theme.of(context).colorScheme.tertiaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  l10n.settingsUnpushed(status!.unpushed),
                ),
              ),
            ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.settingsGitStatus,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(status == null
                      ? l10n.settingsReading
                      : describeGitStatusSummary(l10n, status)),
                  if (status?.remoteUrl != null)
                    Text(l10n.settingsRemote(status!.remoteUrl!)),
                  if (status?.conflict ?? false)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.errorContainer,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(l10n.settingsConflictBanner),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _remoteController,
            decoration: InputDecoration(
              labelText: l10n.settingsRemoteLabel,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: _busy
                    ? null
                    : () => _run(l10n.settingsCloneLabel, () async {
                          await appServices.cloneVault(
                            url: _remoteController.text.trim(),
                            name: 'NexNote Mobile',
                            email: 'mobile@nexnote.local',
                          );
                        }),
                icon: const Icon(Icons.download),
                label: Text(l10n.settingsClone),
              ),
              FilledButton.tonalIcon(
                onPressed: _busy
                    ? null
                    : () => _run(l10n.settingsWriteAndCommit, () async {
                          final stamp = DateTime.now()
                              .toIso8601String()
                              .replaceAll(':', '-')
                              .substring(0, 19);
                          appServices.vaultRepository.createPage(
                            'notes/spike-$stamp.md',
                            '---\ntitle: 手机端 spike $stamp\ntags:\n  - spike\ncreated: $stamp\ntype: note\n---\n\n'
                                '由 iOS 设备端写入并提交。\n',
                          );
                          final sha = git.commitAll(
                            message: '${CommitPrefix.manual} 手机端 spike $stamp',
                          );
                          _append(AppLocalizations.of(context)!
                              .settingsCommitAppend(sha ?? l10n.settingsNoChange));
                        }),
                icon: const Icon(Icons.edit_note),
                label: Text(l10n.settingsWriteAndCommit),
              ),
              FilledButton.tonalIcon(
                onPressed: _busy ? null : () => _run(l10n.settingsSyncNow, () async {
                      final result = await git.sync();
                      _append(l10n.settingsSyncResult(
                          describeSyncState(l10n, result.state),
                          describeSyncMessage(l10n, result.message)));
                    }),
                icon: const Icon(Icons.sync),
                label: Text(l10n.settingsSyncNow),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(l10n.settingsTimeline, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_timeline.isEmpty)
            Text(l10n.settingsNoCommits)
          else
            for (final record in _timeline)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Icon(record.isHead
                    ? Icons.arrow_right
                    : Icons.history),
                title: Text(record.message,
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                    '${record.hash.substring(0, 7)} · ${record.author} · ${record.kind.name}'),
              ),
          const SizedBox(height: 16),
          Text(l10n.settingsCaptureDir,
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _captureDirController,
                  decoration: InputDecoration(
                    labelText: l10n.settingsCapturePathLabel,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () {
                  final settings = appServices.settings;
                  settings.captureDirectory = _captureDirController.text.trim();
                  appServices.settingsStore.save(settings);
                  _append(l10n.settingsCaptureUpdated(settings.captureDirectory));
                  setState(() {});
                },
                child: Text(l10n.settingsSave),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(l10n.settingsAiProfiles,
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final profile in appServices.profileStore.list())
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.cloud_outlined),
              title: Text(profile.name),
              subtitle: Text(
                '${profile.baseUrl} · ${profile.defaultModel} · '
                '${profile.hasKey ? l10n.settingsKeyConfigured : l10n.settingsKeyMissing}',
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () => showAiProfileEditor(
                      context,
                      store: appServices.profileStore,
                      secrets: _secrets,
                      existing: profile,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      await appServices.profileStore.remove(profile.id);
                      setState(() {});
                    },
                  ),
                ],
              ),
            ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => showAiProfileEditor(
                context,
                store: appServices.profileStore,
                secrets: _secrets,
              ),
              icon: const Icon(Icons.add),
              label: Text(l10n.settingsAddProfile),
            ),
          ),
          const SizedBox(height: 16),
          Text(l10n.settingsDiagnosticLog,
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_log.isEmpty)
            Text(l10n.settingsNoLog)
          else
            for (final line in _log)
              SelectableText(line,
                  style: const TextStyle(fontFamily: 'Menlo', fontSize: 12)),
        ],
      ),
    );
  }
}
