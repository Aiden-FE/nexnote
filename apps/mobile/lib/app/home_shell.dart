import 'package:flutter/material.dart';

import 'pages/ai_page.dart';
import 'pages/capture_page.dart';
import 'pages/search_page.dart';
import 'pages/settings_page.dart';
import 'pages/vault_tree_page.dart';

/// 底部导航：库 / 搜索 / 捕获 / AI / 设置
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final destinations = const [
      NavigationDestination(icon: Icon(Icons.folder_outlined), label: '库'),
      NavigationDestination(icon: Icon(Icons.search_outlined), label: '搜索'),
      NavigationDestination(icon: Icon(Icons.add_circle_outline), label: '捕获'),
      NavigationDestination(icon: Icon(Icons.forum_outlined), label: 'AI'),
      NavigationDestination(icon: Icon(Icons.settings_outlined), label: '设置'),
    ];
    final pages = const [
      VaultTreePage(),
      SearchPage(),
      CapturePage(),
      AiPage(),
      SettingsPage(),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: destinations,
      ),
    );
  }
}
