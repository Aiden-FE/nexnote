import 'package:flutter/material.dart';

import '../app_services.dart';

/// 页面阅读：标题 + 元数据头摘要 + 正文
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
    return Scaffold(
      appBar: AppBar(title: Text(page.title)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (fm != null) ...[
            Wrap(
              spacing: 8,
              children: [
                for (final tag in fm.tags) Chip(label: Text(tag)),
                if (fm.type != null) Chip(label: Text('类型: ${fm.type}')),
                if (fm.created != null) Chip(label: Text('创建: ${fm.created}')),
              ],
            ),
            const SizedBox(height: 12),
          ],
          SelectableText(
            page.body,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(height: 1.6),
          ),
        ],
      ),
    );
  }
}
