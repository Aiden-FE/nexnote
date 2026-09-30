import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/capture/quick_capture.dart';
import 'package:nexnote_mobile/git/credentials.dart';
import 'package:nexnote_mobile/git/device_git_service.dart';
import 'package:nexnote_mobile/index/search_index.dart';
import 'package:nexnote_mobile/vault/page_writer.dart';
import 'package:nexnote_mobile/vault/vault_repository.dart';
import 'package:nexnote_mobile/vault/vault_store.dart';

void main() {
  late Directory tmp;
  late QuickCapture capture;
  late SearchIndex index;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-capture-test');
    final store = await VaultStore.open(
      name: 'default',
      appSupportOverride: tmp,
    );
    final repo = VaultRepository(store);
    final git = await DeviceGitService.open(store, NoCredentialProvider());
    index = SearchIndex.inMemory();
    final writer = PageWriter(repository: repo, index: index, git: git);
    capture = QuickCapture(writer: writer);
  });

  tearDown(() {
    index.close();
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  test('捕获创建页面：首行标题 + 默认元数据头', () {
    final result = capture.capture('手机上的想法\n正文内容。', captureDirectory: 'Inbox');
    expect(result.path, 'Inbox/手机上的想法.md');
    final page = capture.writer.repository.readPage('Inbox/手机上的想法.md');
    expect(page!.title, '手机上的想法');
    expect(page.frontmatter?.type, 'note');
    expect(page.body, contains('正文内容。'));
  });

  test('捕获落点默认 Inbox/', () {
    final result = capture.capture('内容');
    expect(result.path, startsWith('Inbox/'));
  });

  test('同名捕获追加序号不覆盖', () {
    capture.capture('同名标题', captureDirectory: 'Inbox');
    final second = capture.capture('同名标题', captureDirectory: 'Inbox');
    expect(second.path, 'Inbox/同名标题-1.md');
  });

  test('文件名安全化（分隔符与非法字符被替换）', () {
    final result = capture.capture('非法/字符:标题', captureDirectory: 'Inbox');
    expect(result.path, 'Inbox/非法-字符-标题.md');
  });

  test('空内容拒绝', () {
    expect(() => capture.capture('   '), throwsA(isA<CaptureError>()));
  });

  test('捕获后索引可命中', () {
    capture.capture('捕获搜索基准词', captureDirectory: 'Inbox');
    expect(index.search('基准').map((h) => h.path), contains('Inbox/捕获搜索基准词.md'));
  });

  test('冲突禁写时捕获被拒绝', () {
    capture.writer.git.forceConflictBlock();
    expect(
      () => capture.capture('内容', captureDirectory: 'Inbox'),
      throwsA(isA<GitServiceError>()),
    );
  });
}
