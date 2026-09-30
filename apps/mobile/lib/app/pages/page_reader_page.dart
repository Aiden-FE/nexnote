import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../reader/link_graph.dart';
import '../../reader/markdown_view.dart';
import '../../vault/link_extractor.dart';
import '../app_services.dart';
import 'edit/source_editor_page.dart';
import 'graph_page.dart';

/// 页面阅读：渲染 + 目录 + 回链 + 时间线 + 双链跳转
class PageReaderPage extends StatelessWidget {
  final String path;

  const PageReaderPage({super.key, required this.path});

  @override
  Widget build(BuildContext context) {
    final repo = appServices.vaultRepository;
    final page = repo.readPage(path);
    if (page == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: Text('页面不存在')),
      );
    }
    final fm = page.frontmatter;
    final graph = LinkGraph.build(repo);
    final backlinks = graph.backlinksFor(path);
    final headings = extractHeadings(page.body);

    Future<void> openTarget(String target) async {
      final resolved = graph.resolve(target);
      if (resolved == null) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('目标页面不存在：$target')),
        );
        return;
      }
      if (!context.mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => PageReaderPage(path: resolved)),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(page.title),
        actions: [
          if (headings.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.list),
              tooltip: '标题目录',
              onPressed: () => _showHeadings(context, headings, page.body),
            ),
          IconButton(
            icon: const Icon(Icons.call_split),
            tooltip: '反向链接',
            onPressed: () => _showBacklinks(context, backlinks, graph),
          ),
          IconButton(
            icon: const Icon(Icons.history),
            tooltip: '版本时间线',
            onPressed: () => _showTimeline(context, path),
          ),
          IconButton(
            icon: const Icon(Icons.hub_outlined),
            tooltip: '图谱',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const GraphPage()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: '编辑',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SourceEditorPage(path: path),
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _FrontmatterBar(frontmatter: fm),
          const SizedBox(height: 8),
          MarkdownView(
            markdown: page.body,
            imageBaseDir: path.contains('/') ? path.substring(0, path.lastIndexOf('/')) : '',
            resolveImage: (relative) {
              try {
                return appServices.vaultStore.resolve(relative);
              } on Object {
                return null;
              }
            },
            onWikiLink: openTarget,
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () => _showBacklinks(context, backlinks, graph),
            icon: const Icon(Icons.call_split),
            label: Text('反向链接（${backlinks.length}）'),
          ),
        ],
      ),
    );
  }

  void _showHeadings(
    BuildContext context,
    List<HeadingEntry> headings,
    String body,
  ) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final heading in headings)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.only(left: 16.0 + heading.level * 12, right: 16),
                title: Text(heading.text),
                onTap: () => Navigator.of(sheetContext).pop(),
              ),
          ],
        ),
      ),
    );
  }

  void _showBacklinks(
    BuildContext context,
    List<LinkEdge> backlinks,
    LinkGraph graph,
  ) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: backlinks.isEmpty
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Text('暂无反向链接'),
              )
            : ListView(
                shrinkWrap: true,
                children: [
                  for (final edge in backlinks)
                    ListTile(
                      title: Text(_titleOf(edge.fromPath, graph)),
                      subtitle: Text(edge.context),
                      onTap: () {
                        Navigator.of(sheetContext).pop();
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => PageReaderPage(path: edge.fromPath),
                          ),
                        );
                      },
                    ),
                ],
              ),
      ),
    );
  }

  void _showTimeline(BuildContext context, String path) {
    final git = appServices.gitService;
    final records = git.isRepoInitialized ? git.timeline(limit: 50) : const <CommitRecord>[];
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: records.isEmpty
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Text('暂无提交记录'),
              )
            : ListView(
                shrinkWrap: true,
                children: [
                  for (final record in records)
                    ListTile(
                      dense: true,
                      leading: Icon(record.isHead ? Icons.arrow_right : Icons.history),
                      title: Text(record.message, maxLines: 2, overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        '${record.hash.substring(0, 7)} · ${record.author} · ${record.kind.name}',
                      ),
                    ),
                ],
              ),
      ),
    );
  }

  static String _titleOf(String path, LinkGraph graph) {
    for (final page in graph.pages) {
      if (page.path == path) return page.title;
    }
    return path;
  }
}

class _FrontmatterBar extends StatelessWidget {
  final Frontmatter? frontmatter;
  const _FrontmatterBar({required this.frontmatter});

  @override
  Widget build(BuildContext context) {
    final fm = frontmatter;
    if (fm == null) return const SizedBox.shrink();
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: [
        for (final tag in fm.tags) Chip(label: Text(tag)),
        if (fm.type != null) Chip(label: Text('类型 ${fm.type}')),
        if (fm.created != null) Chip(label: Text('创建 ${fm.created}')),
        if (fm.updated != null) Chip(label: Text('更新 ${fm.updated}')),
        if (fm.aliases.isNotEmpty) Chip(label: Text('别名 ${fm.aliases.join('、')}')),
        if (fm.confidence != null) Chip(label: Text('置信度 ${fm.confidence}')),
      ],
    );
  }
}
