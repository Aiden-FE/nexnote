// MOB-007 / MOB-008 移动侧验收：块编辑保存的字节保真、索引增量、模式切换不写盘
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/app/app_services.dart';
import 'package:nexnote_mobile/app/pages/edit/block_editor_page.dart';
import 'package:nexnote_mobile/app/pages/edit/source_editor_page.dart';

void main() {
  late Directory tmp;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-editor-test');
    appServices.dispose();
    await appServices.bootstrap(appSupportOverride: tmp);
  });

  tearDown(() {
    appServices.dispose();
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  Future<void> pump(WidgetTester tester, Widget page) async {
    await tester.pumpWidget(MaterialApp(home: page));
    await tester.pumpAndSettle();
  }

  /// 推进假时钟越过自动提交防抖窗口，避免测试结束时残留定时器
  Future<void> flushAutoCommit(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 31));
    await tester.pumpAndSettle();
  }

  String readVault(String path) => appServices.vaultRepository.readText(path);

  testWidgets('块编辑保存：只有被改动的块变化，其余逐字节保持', (tester) async {
    const original = '# 标题\n\n原段落内容\n\n- 列表项\n';
    appServices.vaultRepository.createPage('notes/a.md', original);

    await pump(tester, const BlockEditorPage(path: 'notes/a.md'));

    await tester.enterText(find.text('原段落内容'), '新段落内容');
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await flushAutoCommit(tester);

    expect(readVault('notes/a.md'), '# 标题\n\n新段落内容\n\n- 列表项\n');
  });

  testWidgets('块编辑未修改时不写盘', (tester) async {
    const original = '# 标题\n\n段落\n';
    appServices.vaultRepository.createPage('notes/b.md', original);

    await pump(tester, const BlockEditorPage(path: 'notes/b.md'));
    // 保存按钮在无改动时为禁用态
    final saveButton = tester.widget<TextButton>(
      find.widgetWithText(TextButton, '保存'),
    );
    expect(saveButton.onPressed, isNull);
    expect(readVault('notes/b.md'), original);
  });

  testWidgets('只读结构在块编辑保存后原样保留', (tester) async {
    const original = '原段落\n\n| a | b |\n| --- | --- |\n\n' r'$$x$$' '\n';
    appServices.vaultRepository.createPage('notes/c.md', original);

    await pump(tester, const BlockEditorPage(path: 'notes/c.md'));
    await tester.enterText(find.text('原段落'), '改过的段落');
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await flushAutoCommit(tester);

    final text = readVault('notes/c.md');
    expect(text, startsWith('改过的段落\n'));
    expect(text, contains('| a | b |\n| --- | --- |\n'));
    expect(text, contains(r'$$x$$'));
  });

  testWidgets('保存后索引增量更新（新内容可被搜索命中）', (tester) async {
    appServices.vaultRepository.createPage('notes/d.md', '旧内容\n');
    await pump(tester, const BlockEditorPage(path: 'notes/d.md'));

    await tester.enterText(find.text('旧内容'), '独特关键词内容');
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    await flushAutoCommit(tester);

    final hits = appServices.searchIndex.search('独特关键词');
    expect(hits.map((h) => h.path), contains('notes/d.md'));
    expect(appServices.searchIndex.search('旧内容'), isEmpty);
  });

  testWidgets('模式切换本身不写盘、不产生提交', (tester) async {
    const original = '# 标题\n\n段落\n';
    appServices.vaultRepository.createPage('notes/e.md', original);

    await pump(tester, const SourceEditorPage(path: 'notes/e.md'));
    expect(readVault('notes/e.md'), original);

    await tester.tap(find.byTooltip('切换到块编辑模式'));
    await tester.pumpAndSettle();
    expect(readVault('notes/e.md'), original);

    await tester.tap(find.byTooltip('切换到源码模式'));
    await tester.pumpAndSettle();
    expect(readVault('notes/e.md'), original);
  });

  testWidgets('源码模式编辑保存同样逐字节保真（frontmatter 只读）', (tester) async {
    const original = '---\ntitle: 页面\ntags:\n  - t\n---\n\n正文\n';
    appServices.vaultRepository.createPage('notes/f.md', original);

    await pump(tester, const SourceEditorPage(path: 'notes/f.md'));
    // frontmatter 只读展示
    expect(find.textContaining('元数据头（只读）'), findsOneWidget);
    expect(find.textContaining('title: 页面'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '正文改过');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '保存'));
    await tester.pumpAndSettle();
    await flushAutoCommit(tester);

    expect(readVault('notes/f.md'), '---\ntitle: 页面\ntags:\n  - t\n---\n正文改过');
  });
}
