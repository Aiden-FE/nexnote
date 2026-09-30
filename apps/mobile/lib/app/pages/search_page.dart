import 'package:flutter/material.dart';

/// 搜索——MOB-006（设备本地索引 + 中文分词）实现时启用
class SearchPage extends StatelessWidget {
  const SearchPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('搜索')),
      body: const Center(
        child: Text('搜索待 MOB-006 索引层就绪后启用'),
      ),
    );
  }
}
