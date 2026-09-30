// 两阶段召回——MOB-010
//
// 阶段一 关键词/标签粗筛（设备本地索引）；阶段二 双链关系扩展。
// v1 不做向量召回与置信度重排（ADR-0019）。
library;

import '../index/search_index.dart';
import '../reader/link_graph.dart';

/// 召回阶段
enum RecallStage { keyword, links }

extension RecallStageLabel on RecallStage {
  String get label => switch (this) {
        RecallStage.keyword => '关键词',
        RecallStage.links => '双链扩展',
      };
}

/// 一条召回引用
class Citation {
  final String path;
  final String title;
  final RecallStage stage;
  final String snippet;

  const Citation({
    required this.path,
    required this.title,
    required this.stage,
    required this.snippet,
  });
}

/// 渐进式召回
class Retrieval {
  final SearchIndex index;
  final LinkGraph graph;

  const Retrieval({required this.index, required this.graph});

  /// 两阶段召回：先关键词命中，再沿双链扩展一跳
  List<Citation> recall(String query, {int limit = 8, int keywordLimit = 5}) {
    final keywordHits =
        index.search(query, limit: keywordLimit).toList(growable: false);
    final seen = <String>{};
    final citations = <Citation>[];
    for (final hit in keywordHits) {
      if (!seen.add(hit.path)) continue;
      citations.add(
        Citation(
          path: hit.path,
          title: hit.title,
          stage: RecallStage.keyword,
          snippet: hit.snippet,
        ),
      );
    }
    if (citations.length >= limit) {
      return citations.sublist(0, limit);
    }

    final adjacency = graph.adjacency();
    for (final seed in keywordHits.map((h) => h.path)) {
      for (final neighbor in adjacency[seed] ?? const <String>{}) {
        if (citations.length >= limit) break;
        if (!seen.add(neighbor)) continue;
        citations.add(
          Citation(
            path: neighbor,
            title: _titleOf(neighbor),
            stage: RecallStage.links,
            snippet: '',
          ),
        );
      }
    }
    return citations;
  }

  /// 引用页面正文（供上下文注入，按字符上限截断）
  String contextFor(String path, {int maxChars = 2000}) {
    for (final page in graph.pages) {
      if (page.path != path) continue;
      final body = page.body.trim();
      if (body.length <= maxChars) return body;
      return '${body.substring(0, maxChars)}…';
    }
    return '';
  }

  String _titleOf(String path) {
    for (final page in graph.pages) {
      if (page.path == path) return page.title;
    }
    return path;
  }
}
