// 标签筛选——MOB-005
import 'package:flutter/material.dart';

import '../../reader/link_graph.dart';
import '../app_services.dart';
import 'page_reader_page.dart';
import '../../l10n/app_localizations.dart';

/// 按标签列出页面（只读导航）
class TagsPage extends StatefulWidget {
  const TagsPage({super.key});

  @override
  State<TagsPage> createState() => _TagsPageState();
}

class _TagsPageState extends State<TagsPage> {
  late LinkGraph _graph = LinkGraph.build(appServices.vaultRepository);

  void _refresh() {
    setState(() {
      _graph = LinkGraph.build(appServices.vaultRepository);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final tags = _graph.tagIndex();
    final entries = tags.keys.toList()..sort();
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.tagsTitle),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
        ],
      ),
      body: entries.isEmpty
          ? Center(child: Text(l10n.tagsEmpty))
          : ListView(
              children: [
                for (final tag in entries)
                  ExpansionTile(
                    title: Text(tag),
                    subtitle: Text(l10n.tagsPageCount(tags[tag]!.length)),
                    children: [
                      for (final path in (tags[tag]!.toList()..sort()))
                        ListTile(
                          dense: true,
                          leading: const Icon(Icons.description_outlined),
                          title: Text(_titleOf(path)),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => PageReaderPage(path: path),
                            ),
                          ),
                        ),
                    ],
                  ),
              ],
            ),
    );
  }

  String _titleOf(String path) {
    for (final page in _graph.pages) {
      if (page.path == path) return page.title;
    }
    return path;
  }
}
