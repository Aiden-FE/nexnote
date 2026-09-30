import 'package:flutter/material.dart';

import '../app_services.dart';
import 'page_reader_page.dart';
import 'tags_page.dart';

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
  }

  void _refresh() {
    setState(() {
      _paths = appServices.vaultRepository.listPagePaths();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('库'),
        actions: [
          IconButton(
            icon: const Icon(Icons.label_outline),
            tooltip: '标签筛选',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const TagsPage()),
            ),
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
        ],
      ),
      body: _paths.isEmpty
          ? const Center(
              child: Text('设备知识库为空，先在「设置」里克隆或初始化。'),
            )
          : ListView.builder(
              itemCount: _paths.length,
              itemBuilder: (context, index) {
                final path = _paths[index];
                final page = appServices.vaultRepository.readPage(path);
                final title = page?.title ?? path;
                final dir = path.contains('/') ? path.split('/').first : '根目录';
                return ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: Text(title),
                  subtitle: Text('$dir · ${page?.frontmatter?.type ?? '未分类'}'),
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
