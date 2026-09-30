// 源码编辑——MOB-007（基础编辑 · 源码模式）
//
// 规则：元数据头只读展示、不参与编辑；正文以原文编辑，保存逐字节保真；
// 写入统一经 PageWriter（索引增量 + 自动提交 + 冲突禁写）。
import 'package:flutter/material.dart';

import '../../../git/device_git_service.dart';
import '../../../vault/frontmatter.dart';
import '../../app_services.dart';

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
    try {
      final content = (_frontmatter ?? '') + _controller.text;
      final changed = appServices.pageWriter.writePage(
        widget.path,
        content,
        summary: '保存页面',
      );
      setState(() => _dirty = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(changed ? '已保存，将自动提交' : '内容未变化')),
      );
    } on GitServiceError catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('保存失败：${e.message}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('源码编辑'),
        actions: [
          TextButton(
            onPressed: _blocked || !_dirty ? null : _save,
            child: const Text('保存'),
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
              child: const Text('同步冲突禁写中：请在桌面端解决冲突后重试'),
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
                        '元数据头（只读）',
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
