import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../core/constants.dart';
import '../../core/models.dart';
import '../../git/device_git_service.dart';
import '../../git/git_types.dart';
import '../app_services.dart';

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

  /// 验收用测试远端：优先 dart-define，其次 debug 预填本机 fixture
  static const _spikeRemoteOverride =
      String.fromEnvironment('NEXNOTE_SPIKE_REMOTE');

  static String get _spikeRemoteDefault => _spikeRemoteOverride.isNotEmpty
      ? _spikeRemoteOverride
      : (kDebugMode
          ? 'file:///Users/aiden/dev/aiden/nexnote/.scratch/nexnote-mobile/fixture/remote.git'
          : '');

  final _remoteController =
      TextEditingController(text: _spikeRemoteDefault);

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _remoteController.dispose();
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
                          await git.clone(
                            url: _remoteController.text.trim(),
                            name: 'NexNote Mobile',
                            email: 'mobile@nexnote.local',
                          );
                          git.setRemoteOrigin(_remoteController.text.trim());
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
