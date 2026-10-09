import 'package:flutter/material.dart';

import '../app_services.dart';
import 'page_reader_page.dart';
import 'tags_page.dart';
import '../../l10n/app_localizations.dart';

/// 库：页面树（相对路径分组展示）
class VaultTreePage extends StatefulWidget {
  const VaultTreePage({super.key});

  @override
  State<VaultTreePage> createState() => _VaultTreePageState();
}

class _VaultTreePageState extends State<VaultTreePage> {
  List<String> _paths = const [];

  @override
  void initState() {
    super.initState();
    _refresh();
    // 克隆/初始化/写入后自动刷新，避免回到本页仍显示旧列表
    appServices.vaultRevision.addListener(_refresh);
  }

  @override
  void dispose() {
    appServices.vaultRevision.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (!mounted) return;
    setState(() {
      _paths = appServices.vaultRepository.listPagePaths();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.vaultTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.label_outline),
            tooltip: l10n.vaultTagFilterTooltip,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const TagsPage()),
            ),
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
        ],
      ),
      body: _paths.isEmpty
          ? Center(
              child: Text(l10n.vaultEmpty),
            )
          : ListView.builder(
              itemCount: _paths.length,
              itemBuilder: (context, index) {
                final path = _paths[index];
                final page = appServices.vaultRepository.readPage(path);
                final title = page?.title ?? path;
                final dir = path.contains('/') ? path.split('/').first : l10n.vaultRootDir;
                return ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: Text(title),
                  subtitle: Text('$dir · ${page?.frontmatter?.type ?? l10n.vaultUncategorized}'),
                  onTap: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => PageReaderPage(path: path),
                      ),
                    );
                    _refresh();
                  },
                );
              },
            ),
    );
  }
}
