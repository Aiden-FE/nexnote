// 真实应用端到端旅程验收——驱动 main() 的真实 UI
//
// 覆盖：克隆远端 → 库列表 → 页面渲染 → 双链跳转 → 中文搜索 → 快速捕获 → 编辑保存。
// 每个阶段写入标记文件并留出等待窗口，宿主机轮询后调用 simctl 截图取证。
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nexnote_mobile/main.dart' as app;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'support/fixture.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late Directory docs;

  Future<void> checkpoint(String name) async {
    File(p.join(docs.path, 'shot-$name.ready')).writeAsStringSync(
      DateTime.now().toIso8601String(),
    );
    // 给宿主机留出截图窗口
    await Future<void>.delayed(const Duration(seconds: 4));
  }

  testWidgets('真实应用旅程：克隆 → 浏览 → 搜索 → 捕获 → 编辑', (tester) async {
    docs = await getApplicationDocumentsDirectory();
    // 可重复执行：清掉上一轮克隆的设备知识库与标记
    final support = await getApplicationSupportDirectory();
    final vaultDir = Directory(p.join(support.path, 'vaults', 'default'));
    if (vaultDir.existsSync()) vaultDir.deleteSync(recursive: true);
    for (final file in docs.listSync()) {
      if (file is File && p.basename(file.path).startsWith('shot-')) {
        file.deleteSync();
      }
    }

    // fixture 远端由 tool/make_test_fixture.sh 生成，地址经 dart-define 注入，
    // 启动后应已预填在「设置」页的远端字段里。
    final remote = requireFixtureRemote();
    await app.main();
    await tester.pumpAndSettle(const Duration(seconds: 2));
    await checkpoint('01-启动-空知识库');

    // —— 克隆测试远端 ——
    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();
    expect(find.text(remote), findsOneWidget,
        reason: '远端字段应预填注入的 fixture 地址');
    expect(find.text('Git 状态'), findsOneWidget);
    await checkpoint('02-设置页');

    await tester.tap(find.text('克隆远端'));
    await tester.pumpAndSettle(const Duration(seconds: 8));
    await checkpoint('03-克隆完成');

    // —— 库列表 ——
    await tester.tap(find.text('库'));
    await tester.pumpAndSettle();
    expect(find.text('NexNote 移动端验收库'), findsOneWidget);
    await checkpoint('04-库列表');

    // —— 页面渲染 ——
    await tester.tap(find.text('NexNote 移动端验收库'));
    await tester.pumpAndSettle();
    expect(find.text('关键词'), findsOneWidget);
    await checkpoint('05-页面渲染');

    // —— 双链跳转 ——
    await tester.tap(find.text('设备端同步').first);
    await tester.pumpAndSettle();
    expect(find.text('提交节奏'), findsOneWidget);
    await checkpoint('06-双链跳转');
    // 双链会再 push 一层阅读页：退回主壳才能切底部导航
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();

    // —— 中文搜索 ——
    await tester.tap(find.text('搜索'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '基准');
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pumpAndSettle();
    expect(find.textContaining('命中'), findsOneWidget);
    await checkpoint('07-中文搜索');

    // —— 快速捕获 ——
    await tester.tap(find.text('捕获'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).first,
      '端到端验收笔记\n这是旅程测试写入的内容。',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '捕获'));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    await checkpoint('08-快速捕获');

    // —— 打开捕获页并编辑保存 ——
    await tester.tap(find.text('打开刚捕获的页面'));
    await tester.pumpAndSettle();
    expect(find.text('端到端验收笔记'), findsWidgets);
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pumpAndSettle();
    await checkpoint('09-源码编辑');

    await tester.enterText(find.byType(TextField).last, '这是被编辑过的内容。');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '保存'));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    await checkpoint('10-保存后');

    // —— 块编辑模式 ——
    await tester.tap(find.byTooltip('切换到块编辑模式'));
    await tester.pumpAndSettle();
    await checkpoint('11-块编辑模式');
  });
}
