import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/vault/vault_store.dart';

void main() {
  late Directory tmp;
  late VaultStore store;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-vault-test');
    store = await VaultStore.open(
      name: 'default',
      appSupportOverride: tmp,
    );
  });

  tearDown(() async {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  group('路径校验', () {
    test('正常相对路径解析在库内', () {
      final resolved = store.resolve('notes/a.md');
      expect(resolved.startsWith(store.rootPath), isTrue);
      expect(resolved.endsWith('notes/a.md'), isTrue);
    });

    test('拒绝绝对路径', () {
      expect(() => store.resolve('/etc/passwd'),
          throwsA(isA<VaultPathError>()));
    });

    test('拒绝越出库外的相对路径', () {
      expect(() => store.resolve('../../evil.md'),
          throwsA(isA<VaultPathError>()));
      expect(() => store.resolve('notes/../../evil.md'),
          throwsA(isA<VaultPathError>()));
    });

    test('拒绝空路径', () {
      expect(() => store.resolve(''), throwsA(isA<VaultPathError>()));
    });

    test('拒绝符号链接穿透', () async {
      final outside = Directory('${tmp.path}/outside');
      outside.createSync();
      final link = Link('${store.rootPath}/escape');
      link.createSync(outside.path);
      expect(
          () => store.resolve('escape/evil.md'), throwsA(isA<VaultPathError>()));
    });

    test('路径含 . 与空段时归一化', () {
      final resolved = store.resolve('./notes//a.md');
      expect(resolved.endsWith('notes/a.md'), isTrue);
    });
  });

  group('页面枚举', () {
    test('只列出 Markdown 并跳过隐藏目录', () {
      store.directory('notes').createSync(recursive: true);
      store.directory('.hidden').createSync(recursive: true);
      store.directory('.nexnote').createSync(recursive: true);
      store.file('a.md').writeAsStringSync('# A');
      store.file('notes/b.md').writeAsStringSync('# B');
      store.file('notes/c.txt').writeAsStringSync('nope');
      store.file('.hidden/d.md').writeAsStringSync('# hidden');
      store.file('.nexnote/index.md').writeAsStringSync('# runtime');

      final pages = store.listMarkdownPages();
      expect(pages, equals(['a.md', 'notes/b.md']));
    });
  });
}
