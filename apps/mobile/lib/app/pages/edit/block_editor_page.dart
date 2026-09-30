// 简化块编辑——MOB-007 / MOB-008
//
// 可编辑块：段落 / 标题 / 无序·有序·任务列表 / 引用 / 代码 / 图片
// 只读块：表格 / 公式 / HTML（原样保留，只能经源码模式编辑，禁止静默改写）
import 'package:flutter/material.dart';

import '../../../editor/block_model.dart';
import '../../../git/device_git_service.dart';
import '../../../reader/markdown_view.dart';
import '../../../vault/frontmatter.dart';
import '../../app_services.dart';
import 'source_editor_page.dart';

class BlockEditorPage extends StatefulWidget {
  final String path;
  const BlockEditorPage({super.key, required this.path});

  @override
  State<BlockEditorPage> createState() => _BlockEditorPageState();
}

class _BlockEditorPageState extends State<BlockEditorPage> {
  late BlockDocument _document;
  String? _frontmatter;
  final _controllers = <Block, TextEditingController>{};
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final content = appServices.vaultRepository.readText(widget.path);
    final parsed = parseMarkdown(content);
    _frontmatter = parsed.rawFrontmatter;
    _document = parseBlocks(parsed.body);
    _controllers.clear();
    for (final block in _document.blocks) {
      if (!block.editable) continue;
      final controller = TextEditingController(text: block.content);
      controller.addListener(() {
        if (block.content != controller.text) {
          block.content = controller.text;
          setState(() => _dirty = true);
        }
      });
      _controllers[block] = controller;
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  bool get _blocked => appServices.gitService.blockedByConflict;

  void _save() {
    try {
      final body = _document.serialize();
      final content = (_frontmatter ?? '') + body;
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

  void _switchToSource() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => SourceEditorPage(path: widget.path),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('块编辑'),
        actions: [
          IconButton(
            icon: const Icon(Icons.code),
            tooltip: '切换到源码模式',
            onPressed: _blocked ? null : _switchToSource,
          ),
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
              child: Text(
                '元数据头（只读）\n${_frontmatter!.trimRight()}',
                style: const TextStyle(fontFamily: 'Menlo', fontSize: 12),
              ),
            ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                for (final block in _document.blocks) _buildBlock(block),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBlock(Block block) {
    switch (block.type) {
      case BlockType.blank:
        return const SizedBox(height: 8);
      case BlockType.table || BlockType.math || BlockType.html:
        return _ReadOnlyBlock(block: block);
      case BlockType.taskItem:
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              value: block.checked ?? false,
              onChanged: _blocked
                  ? null
                  : (value) => setState(() {
                        block.checked = value ?? false;
                        _dirty = true;
                      }),
            ),
            Expanded(child: _field(block, singleLine: false)),
          ],
        );
      case BlockType.heading:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _levelSelector(block),
              const SizedBox(width: 6),
              Expanded(child: _field(block, singleLine: true, bold: true)),
            ],
          ),
        );
      case BlockType.quote:
        return Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.only(left: 10),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(
                width: 3,
                color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.6),
              ),
            ),
          ),
          child: _field(block, singleLine: false),
        );
      case BlockType.code:
        return Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '代码块${block.language == null ? '' : ' · ${block.language}'}',
                style: Theme.of(context).textTheme.labelSmall,
              ),
              _field(block, singleLine: false, monospace: true),
            ],
          ),
        );
      case BlockType.unorderedItem:
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 12, right: 6),
              child: Text('•'),
            ),
            Expanded(child: _field(block, singleLine: false)),
          ],
        );
      case BlockType.orderedItem:
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 12, right: 6),
              child: Text('${block.ordinal ?? 1}.'),
            ),
            Expanded(child: _field(block, singleLine: false)),
          ],
        );
      case BlockType.image:
        return Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            border: Border.all(color: Theme.of(context).dividerColor),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.image_outlined, size: 16),
                  const SizedBox(width: 4),
                  Text('图片', style: Theme.of(context).textTheme.labelSmall),
                ],
              ),
              _field(block, singleLine: true, monospace: true),
            ],
          ),
        );
      case BlockType.paragraph:
        return _field(block, singleLine: false);
    }
  }

  Widget _field(
    Block block, {
    required bool singleLine,
    bool bold = false,
    bool monospace = false,
  }) {
    final controller = _controllers[block];
    if (controller == null) return const SizedBox.shrink();
    return TextField(
      controller: controller,
      readOnly: _blocked,
      maxLines: singleLine ? 1 : null,
      style: TextStyle(
        fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
        fontFamily: monospace ? 'Menlo' : null,
        fontSize: monospace ? 13 : 15,
        height: 1.5,
      ),
      decoration: const InputDecoration(
        isDense: true,
        border: InputBorder.none,
        contentPadding: EdgeInsets.symmetric(vertical: 8),
      ),
    );
  }

  Widget _levelSelector(Block block) {
    return DropdownButton<int>(
      value: block.level,
      underline: const SizedBox.shrink(),
      items: [
        for (var level = 1; level <= 6; level++)
          DropdownMenuItem(value: level, child: Text('H$level')),
      ],
      onChanged: _blocked
          ? null
          : (value) => setState(() {
                block.level = value ?? block.level;
                _dirty = true;
              }),
    );
  }
}

/// 块模式只读结构：原样呈现，并提示去源码模式编辑
class _ReadOnlyBlock extends StatelessWidget {
  final Block block;
  const _ReadOnlyBlock({required this.block});

  @override
  Widget build(BuildContext context) {
    final label = switch (block.type) {
      BlockType.table => '表格（只读）',
      BlockType.math => '公式（只读）',
      _ => 'HTML（只读）',
    };
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.lock_outline,
                  size: 14, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 4),
              Text(label, style: Theme.of(context).textTheme.labelSmall),
              const Spacer(),
              Text(
                '源码模式可编辑',
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
          const SizedBox(height: 6),
          MarkdownView(markdown: block.raw),
        ],
      ),
    );
  }
}
