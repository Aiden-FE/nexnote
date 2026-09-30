// 跨端取证：设备端产出可被桌面端验证的产物
//
// 1) 捕获 + 编辑 → 等自动提交 → 立即同步到远端
// 2) 导出固定查询集的手机端命中集合
// 3) 导出手机端产出的 Markdown 原文（供桌面端内核往返核对）
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nexnote_mobile/app/app_services.dart';
import 'package:nexnote_mobile/main.dart' as app;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// 跨端核对用的固定中文查询集
const queries = ['基准', '防抖', '双链', '设备端同步', '索引', '不存在词'];

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('跨端取证：设备提交可见 + 命中集 + 原文导出', (tester) async {
    final support = await getApplicationSupportDirectory();
    final docs = await getApplicationDocumentsDirectory();

    final vaultDir = Directory(p.join(support.path, 'vaults', 'default'));
    if (vaultDir.existsSync()) vaultDir.deleteSync(recursive: true);

    await app.main();
    await tester.pumpAndSettle(const Duration(seconds: 2));

    // 克隆测试远端
    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('克隆远端'));
    await tester.pumpAndSettle(const Duration(seconds: 8));
    expect(find.text('iCloud 备份排除：已生效'), findsOneWidget);

    // 捕获（写入 Inbox，触发自动提交调度）
    await tester.tap(find.text('捕获'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).first,
      '跨端核对笔记\n包含防抖与索引分词说明，并通过 [[设备端同步]] 关联。',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '捕获'));
    await tester.pumpAndSettle(const Duration(seconds: 2));
    expect(find.text('打开刚捕获的页面'), findsOneWidget);

    // 等自动提交（30s 防抖）落地：轮询 Git 提交是否出现
    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();
    var committed = false;
    for (var i = 0; i < 40 && !committed; i++) {
      await Future<void>.delayed(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 1));
      committed = find.textContaining('ahead').evaluate().isNotEmpty;
    }
    await tester.pumpAndSettle();

    // 立即同步：推送设备提交到远端
    await tester.tap(find.text('立即同步'));
    await tester.pumpAndSettle(const Duration(seconds: 10));

    // 导出手机端产物
    final index = appServices.searchIndex;
    final hits = <String, List<String>>{};
    for (final query in queries) {
      hits[query] = index.search(query).map((h) => h.path).toList()..sort();
    }
    final vault = appServices.vaultRepository;
    final pagePaths = vault.listPagePaths();
    final pageText = <String, String>{
      for (final path in pagePaths) path: vault.readText(path),
    };

    // 直接落到宿主机路径：模拟器与宿主共享文件系统，且 flutter test 结束会
    // 卸载应用（容器随之消失），写进容器会丢证据。
    final evidenceHost = Directory(
      '/Users/aiden/dev/aiden/nexnote/.scratch/nexnote-mobile/evidence',
    );
    if (!evidenceHost.existsSync()) evidenceHost.createSync(recursive: true);
    File(p.join(evidenceHost.path, 'cross-device-evidence.json'))
        .writeAsStringSync(
      jsonEncode({
        'vaultPath': appServices.vaultStore.rootPath,
        'gitStatus': {
          'branch': appServices.gitService.status().branch,
          'ahead': appServices.gitService.status().ahead,
          'behind': appServices.gitService.status().behind,
        },
        'hits': hits,
        'pagePaths': pagePaths,
        'pageText': pageText,
      }),
    );
    File(p.join(docs.path, 'shot-20-跨端取证.ready')).writeAsStringSync(
      DateTime.now().toIso8601String(),
    );
    await Future<void>.delayed(const Duration(seconds: 4));
  });
}
