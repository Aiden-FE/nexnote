import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/vault/vault_repository.dart';
import 'package:nexnote_mobile/vault/vault_store.dart';

void main() {
  late Directory tmp;
  late VaultRepository repo;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-repo-test');
    final store = await VaultStore.open(
      name: 'default',
      appSupportOverride: tmp,
    );
    repo = VaultRepository(store);
  });

  tearDown(() async {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  test('创建与读取页面（解析标题与元数据头）', () {
    repo.createPage(
      'notes/a.md',
      '---\ntitle: 页面 A\ntags:\n  - x\n---\n\n正文 A\n',
    );
    final page = repo.readPage('notes/a.md');
    expect(page, isNotNull);
    expect(page!.title, '页面 A');
    expect(page.body.trim(), '正文 A');
    expect(page.frontmatter?.tags, equals(['x']));
  });

  test('仅打开不编辑时字节保持不变', () {
    repo.createPage('b.md', '第一行\n第二行\n');
    final before = repo.readText('b.md');
    expect(repo.readPage('b.md'), isNotNull);
    expect(repo.readText('b.md'), equals(before));
  });

  test('写入相同内容不落盘（返回 false）', () {
    repo.createPage('c.md', '内容');
    expect(repo.writeText('c.md', '内容'), isFalse);
    expect(repo.writeText('c.md', '内容改'), isTrue);
    expect(repo.readText('c.md'), '内容改');
  });

  test('局部编辑不影响其它部分', () {
    const original = '---\ntitle: T\n---\n\n段落一\n\n段落二\n';
    repo.createPage('d.md', original);
    final edited = original.replaceFirst('段落一', '段落一改');
    repo.writeText('d.md', edited);
    final text = repo.readText('d.md');
    expect(text, contains('段落一改'));
    expect(text, contains('段落二'));
    expect(text.split('\n').length, original.split('\n').length);
  });

  test('路径逃逸被拒绝', () {
    expect(
      () => repo.createPage('../escape.md', 'x'),
      throwsA(isA<VaultPathError>()),
    );
  });
}
