import 'package:flutter/material.dart';

import '../../index/search_index.dart';
import '../app_services.dart';
import 'page_reader_page.dart';

/// 搜索：设备本地索引 + 中文分词（离线可用）
class SearchPage extends StatefulWidget {
  const SearchPage({super.key});

  @override
  State<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends State<SearchPage> {
  final _controller = TextEditingController();
  List<SearchHit> _hits = const [];
  bool _searched = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _run(String query) {
    setState(() {
      _hits = appServices.searchIndex.search(query);
      _searched = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('搜索')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _controller,
              textInputAction: TextInputAction.search,
              onSubmitted: _run,
              decoration: InputDecoration(
                hintText: '搜索页面内容（支持中文子串）',
                prefixIcon: const Icon(Icons.search),
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.arrow_forward),
                  onPressed: () => _run(_controller.text),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text(
                  _searched ? '命中 ${_hits.length} 个页面' : '输入关键词开始搜索',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: () {
                    appServices.rebuildSearchIndex();
                    _run(_controller.text);
                  },
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('重建索引'),
                ),
              ],
            ),
          ),
          Expanded(
            child: _hits.isEmpty
                ? const Center(child: Text('没有命中结果'))
                : ListView.builder(
                    itemCount: _hits.length,
                    itemBuilder: (context, index) {
                      final hit = _hits[index];
                      return ListTile(
                        title: Text(hit.title),
                        subtitle: Text(
                          hit.snippet.isEmpty ? hit.path : hit.snippet,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => PageReaderPage(path: hit.path),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
