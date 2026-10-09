// 源码编辑——MOB-007（基础编辑 · 源码模式）
//
// 规则：元数据头只读展示、不参与编辑；正文以原文编辑，保存逐字节保真；
// 写入统一经 PageWriter（索引增量 + 自动提交 + 冲突禁写）。
import 'package:flutter/material.dart';

import '../../../git/device_git_service.dart';
import '../../../vault/frontmatter.dart';
import '../../app_services.dart';
import 'block_editor_page.dart';
import '../../../l10n/app_localizations.dart';

class SourceEditorPage extends StatefulWidget {
  final String path;
  const SourceEditorPage({super.key, required this.path});

  @override
  State<SourceEditorPage> createState() => _SourceEditorPageState();
}

class _SourceEditorPageState extends State<SourceEditorPage> {
  late final TextEditingController _controller;
  String? _frontmatter;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    final content = appServices.vaultRepository.readText(widget.path);
    final parsed = parseMarkdown(content);
    _frontmatter = parsed.rawFrontmatter;
    _controller = TextEditingController(text: parsed.body)
      ..addListener(() {
        if (!_dirty) setState(() => _dirty = true);
      });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _blocked => appServices.gitService.blockedByConflict;

  void _save() {
    final l10n = AppLocalizations.of(context)!;
    try {
      final content = (_frontmatter ?? '') + _controller.text;
      final changed = appServices.pageWriter.writePage(
        widget.path,
        content,
        summary: '保存页面',
      );
      setState(() => _dirty = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(changed ? l10n.saveAutoCommit : l10n.saveNoChange),
        ),
      );
    } on GitServiceError catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.saveFailed(e.message))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.sourceTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.view_agenda_outlined),
            tooltip: l10n.sourceSwitchToBlock,
            onPressed: _blocked
                ? null
                : () => Navigator.of(context).pushReplacement(
                      MaterialPageRoute<void>(
                        builder: (_) => BlockEditorPage(path: widget.path),
                      ),
                    ),
          ),
          TextButton(
            onPressed: _blocked || !_dirty ? null : _save,
            child: Text(l10n.sourceSave),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_blocked)
            Container(
              width: double.infinity,
              color: Theme.of(context).colorScheme.errorContainer,
              padding: const EdgeInsets.all(12),
              child: Text(l10n.sourceConflict),
            ),
          if (_frontmatter != null)
            Container(
              width: double.infinity,
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.lock_outline, size: 14),
                      const SizedBox(width: 4),
                      Text(
                        l10n.sourceFrontmatter,
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  SelectableText(
                    _frontmatter!.trimRight(),
                    style: const TextStyle(fontFamily: 'Menlo', fontSize: 12),
                  ),
                ],
              ),
            ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                controller: _controller,
                maxLines: null,
                expands: true,
                textAlignVertical: TextAlignVertical.top,
                readOnly: _blocked,
                style: const TextStyle(fontFamily: 'Menlo', fontSize: 13, height: 1.5),
                decoration: const InputDecoration(border: InputBorder.none),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
