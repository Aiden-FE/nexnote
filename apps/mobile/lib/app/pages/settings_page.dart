import 'package:flutter/material.dart';

import '../../core/constants.dart';
import '../../core/models.dart';
import '../../git/device_git_service.dart';
import '../../git/git_types.dart';
import '../../ai/secret_vault.dart';
import '../../vault/backup_exclusion.dart';
import '../app_services.dart';
import 'settings/ai_profile_editor.dart';

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
      _append('备份排除标记写入失败，请检查系统设置');
    }
  }

  Future<void> _run(String label, Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      _append('$label：完成');
    } on GitServiceError catch (e) {
      _append('$label：失败 ${e.kind.name} — ${e.message}');
    } on Object catch (e) {
      _append('$label：失败 $e');
    } finally {
      setState(() => _busy = false);
      _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final git = appServices.gitService;
    final status = _status;
    return Scaffold(
      appBar: AppBar(
        title: const Text('设置'),
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
                  Text('设备知识库',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text('路径：${appServices.vaultStore.rootPath}'),
                  Text('页面数：${appServices.vaultRepository.listPagePaths().length}'),
                  Text('iCloud 备份排除：'
                      '${appServices.backupExcluded ? '已生效' : '未确认'}'),
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
                  '有 ${status!.unpushed} 个未推送提交。'
                  '设备端是这些提交的唯一副本，请尽快同步。',
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
                  Text('Git 状态',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(status?.summary ?? '读取中…'),
                  if (status?.remoteUrl != null)
                    Text('远端：${status!.remoteUrl}'),
                  if (status?.conflict ?? false)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.errorContainer,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text('同步冲突：手机端已禁写，请在桌面端处理'),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _remoteController,
            decoration: const InputDecoration(
              labelText: '测试远端（file:// 或 https://）',
              border: OutlineInputBorder(),
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
                    : () => _run('克隆', () async {
                          await appServices.cloneVault(
                            url: _remoteController.text.trim(),
                            name: 'NexNote Mobile',
                            email: 'mobile@nexnote.local',
                          );
                        }),
                icon: const Icon(Icons.download),
                label: const Text('克隆远端'),
              ),
              FilledButton.tonalIcon(
                onPressed: _busy
                    ? null
                    : () => _run('写页面并提交', () async {
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
                          _append('提交 ${sha ?? '（无变更）'}');
                        }),
                icon: const Icon(Icons.edit_note),
                label: const Text('写页面并提交'),
              ),
              FilledButton.tonalIcon(
                onPressed: _busy ? null : () => _run('同步', () async {
                      final result = await git.sync();
                      _append('同步 ${result.state.name}：${result.message}');
                    }),
                icon: const Icon(Icons.sync),
                label: const Text('立即同步'),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text('版本时间线', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_timeline.isEmpty)
            const Text('（暂无提交）')
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
          Text('快速捕获目录',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _captureDirController,
                  decoration: const InputDecoration(
                    labelText: '知识库内相对路径',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () {
                  final settings = appServices.settings;
                  settings.captureDirectory = _captureDirController.text.trim();
                  appServices.settingsStore.save(settings);
                  _append('捕获目录已更新为 ${settings.captureDirectory}');
                  setState(() {});
                },
                child: const Text('保存'),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text('AI 供应商 Profile',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final profile in appServices.profileStore.list())
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.cloud_outlined),
              title: Text(profile.name),
              subtitle: Text(
                '${profile.baseUrl} · ${profile.defaultModel} · '
                '${profile.hasKey ? '已配置密钥' : '未配置密钥'}',
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
              label: const Text('新增 Profile'),
            ),
          ),
          const SizedBox(height: 16),
          Text('诊断日志', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_log.isEmpty)
            const Text('（暂无日志）')
          else
            for (final line in _log)
              SelectableText(line,
                  style: const TextStyle(fontFamily: 'Menlo', fontSize: 12)),
        ],
      ),
    );
  }
}
