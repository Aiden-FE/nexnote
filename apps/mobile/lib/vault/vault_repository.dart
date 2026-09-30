// 页面仓库：设备知识库的读写入口
library;

import 'dart:convert';

import '../core/models.dart';
import 'frontmatter.dart';
import 'vault_store.dart';

/// 设备知识库内的页面读写
class VaultRepository {
  final VaultStore vault;

  VaultRepository(this.vault);

  /// 全部页面路径（相对，按字典序）
  List<String> listPagePaths() => vault.listMarkdownPages();

  /// 读取页面（不存在返回 null）
  Page? readPage(String relativePath) {
    final file = vault.file(relativePath);
    if (!file.existsSync()) return null;
    final content = file.readAsStringSync();
    return _toPage(relativePath, content);
  }

  /// 读取全部页面
  List<Page> readAllPages() =>
      listPagePaths().map(readPage).whereType<Page>().toList();

  /// 读取原文
  String readText(String relativePath) =>
      vault.file(relativePath).readAsStringSync();

  /// 写入原文（UTF-8，逐字节保真；仅在内容变化时写盘）
  ///
  /// 返回是否真的发生写入。
  bool writeText(String relativePath, String content) {
    final file = vault.file(relativePath);
    final bytes = utf8.encode(content);
    if (file.existsSync()) {
      final existing = file.readAsBytesSync();
      if (_sameBytes(existing, bytes)) return false;
    }
    file.parent.createSync(recursive: true);
    file.writeAsBytesSync(bytes);
    return true;
  }

  /// 创建页面（父目录自动创建）
  void createPage(String relativePath, String content) {
    final file = vault.file(relativePath);
    if (file.existsSync()) {
      throw VaultPathError('页面已存在: $relativePath');
    }
    file.parent.createSync(recursive: true);
    file.writeAsBytesSync(utf8.encode(content));
  }

  /// 删除页面
  void deletePage(String relativePath) {
    final file = vault.file(relativePath);
    if (file.existsSync()) file.deleteSync();
  }

  Page _toPage(String relativePath, String content) {
    final parsed = parseMarkdown(content);
    return Page(
      path: relativePath,
      title: resolveTitle(
        path: relativePath,
        frontmatter: parsed.data,
        body: parsed.body,
      ),
      body: parsed.body,
      frontmatter:
          parsed.data.isEmpty ? null : Frontmatter.fromMap(parsed.data),
    );
  }

  static bool _sameBytes(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
