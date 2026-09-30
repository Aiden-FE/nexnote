// 关系图与回链——MOB-005
//
// 页面标题与别名 → 路径解析；由此派生回链、出链与标签统计、图谱边。
library;

import '../core/models.dart';
import '../vault/link_extractor.dart';
import '../vault/vault_repository.dart';

/// 一条解析后的链接边
class LinkEdge {
  final String fromPath;
  final String toPath;

  /// 链接显示名（原始目标文本）
  final String rawTarget;

  /// 出链在源文件中的上下文片段
  final String context;

  const LinkEdge({
    required this.fromPath,
    required this.toPath,
    required this.rawTarget,
    required this.context,
  });
}

/// 未解析链接（目标页面不存在）
class UnresolvedLink {
  final String fromPath;
  final String rawTarget;
  const UnresolvedLink({required this.fromPath, required this.rawTarget});
}

/// 页面关系图
class LinkGraph {
  final List<Page> pages;
  final List<LinkEdge> edges;
  final List<UnresolvedLink> unresolved;
  /// 标题 / 文件名 → 路径
  final Map<String, String> titleToPath;
  /// 别名 → 路径
  final Map<String, String> aliasToPath;

  LinkGraph._({
    required this.pages,
    required this.edges,
    required this.unresolved,
    required this.titleToPath,
    required this.aliasToPath,
  });

  /// 从知识库构建关系图
  factory LinkGraph.build(VaultRepository repository) {
    final pages = repository.readAllPages();
    final titleToPath = <String, String>{};
    final aliasToPath = <String, String>{};
    for (final page in pages) {
      titleToPath[page.title] = page.path;
      final fileName = page.path.split('/').last;
      final name = fileName.replaceAll('.md', '');
      // 同时接受带与不带 .md 的写法
      titleToPath.putIfAbsent(name, () => page.path);
      titleToPath.putIfAbsent(fileName, () => page.path);
      for (final alias in page.frontmatter?.aliases ?? const <String>[]) {
        aliasToPath[alias] = page.path;
      }
    }

    final edges = <LinkEdge>[];
    final unresolved = <UnresolvedLink>[];
    for (final page in pages) {
      for (final link in extractWikiLinks(page.body)) {
        final target = titleToPath[link.target] ?? aliasToPath[link.target];
        if (target == null) {
          unresolved.add(
            UnresolvedLink(fromPath: page.path, rawTarget: link.target),
          );
          continue;
        }
        edges.add(
          LinkEdge(
            fromPath: page.path,
            toPath: target,
            rawTarget: link.target,
            context: _contextAround(page.body, link),
          ),
        );
      }
    }
    return LinkGraph._(
      pages: pages,
      edges: edges,
      unresolved: unresolved,
      titleToPath: titleToPath,
      aliasToPath: aliasToPath,
    );
  }

  /// 目标名 → 路径（标题、文件名或别名）
  String? resolve(String target) =>
      titleToPath[target] ?? aliasToPath[target];

  /// 引用当前页面的位置（回链）
  List<LinkEdge> backlinksFor(String path) =>
      edges.where((e) => e.toPath == path).toList(growable: false);

  /// 当前页面引用的其它页面（出链）
  List<LinkEdge> outgoingFor(String path) =>
      edges.where((e) => e.fromPath == path).toList(growable: false);

  /// 标签统计（标签名 → 页面路径集合）
  Map<String, Set<String>> tagIndex() {
    final out = <String, Set<String>>{};
    for (final page in pages) {
      for (final tag in page.frontmatter?.tags ?? const <String>[]) {
        out.putIfAbsent(tag, () => <String>{}).add(page.path);
      }
    }
    return out;
  }

  /// 图谱邻接（无向，供只读图谱浏览）
  Map<String, Set<String>> adjacency() {
    final out = <String, Set<String>>{};
    for (final page in pages) {
      out.putIfAbsent(page.path, () => <String>{});
    }
    for (final edge in edges) {
      out.putIfAbsent(edge.fromPath, () => <String>{}).add(edge.toPath);
      out.putIfAbsent(edge.toPath, () => <String>{}).add(edge.fromPath);
    }
    return out;
  }

  static String _contextAround(String body, WikiLink link) {
    const lead = 24;
    final start = link.offset - lead < 0 ? 0 : link.offset - lead;
    final end = link.offset + link.raw.length + 40;
    final snippet = body.substring(
      start,
      end > body.length ? body.length : end,
    );
    return snippet.replaceAll('\n', ' ').trim();
  }
}
