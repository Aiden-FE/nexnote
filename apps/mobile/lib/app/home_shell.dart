import 'package:flutter/material.dart';

import 'pages/ai_page.dart';
import 'pages/capture_page.dart';
import 'pages/search_page.dart';
import 'pages/settings_page.dart';
import 'pages/vault_tree_page.dart';
import '../l10n/app_localizations.dart';

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
    final l10n = AppLocalizations.of(context)!;
    final destinations = [
      NavigationDestination(icon: const Icon(Icons.folder_outlined), label: l10n.navVault),
      NavigationDestination(icon: const Icon(Icons.search_outlined), label: l10n.navSearch),
      NavigationDestination(icon: const Icon(Icons.add_circle_outline), label: l10n.navCapture),
      NavigationDestination(icon: const Icon(Icons.forum_outlined), label: l10n.navAi),
      NavigationDestination(icon: const Icon(Icons.settings_outlined), label: l10n.navSettings),
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
