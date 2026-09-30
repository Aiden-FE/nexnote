// 双链抽取——MOB-005（回链、图谱）与索引解析共用
library;

/// 一条双链
class WikiLink {
  /// 原始文本（含围栏）
  final String raw;

  /// 目标名（不含别名与锚点）
  final String target;

  /// 显示文本（`[[目标|显示]]` 的显示部分）
  final String? alias;

  /// 锚点（`[[目标#小节]]`）
  final String? anchor;

  /// 出现位置（字符偏移，用于片段定位）
  final int offset;

  const WikiLink({
    required this.raw,
    required this.target,
    required this.alias,
    required this.anchor,
    required this.offset,
  });
}

/// 代码围栏内的文本不参与双链抽取
final _fencePattern = RegExp(r'```[\s\S]*?```|`[^`\n]*`', multiLine: true);

final _wikiPattern = RegExp(r'\[\[([^\[\]|#]+)(?:#([^\[\]|]+))?(?:\|([^\[\]]+))?\]\]');

/// 抽取正文中的双链（排除代码块/行内代码）
List<WikiLink> extractWikiLinks(String body) {
  final masked = _maskFences(body);
  final links = <WikiLink>[];
  for (final match in _wikiPattern.allMatches(masked)) {
    final target = match.group(1)?.trim() ?? '';
    if (target.isEmpty) continue;
    links.add(
      WikiLink(
        raw: match.group(0)!,
        target: target,
        alias: match.group(3)?.trim(),
        anchor: match.group(2)?.trim(),
        offset: match.start,
      ),
    );
  }
  return links;
}

/// 把代码围栏与行内代码替换为等长空格，保持偏移不变
String _maskFences(String body) {
  return body.replaceAllMapped(_fencePattern, (m) {
    return ' ' * m.group(0)!.length;
  });
}

/// 标题条目（标题目录）
class HeadingEntry {
  final int level;
  final String text;
  final int offset;

  const HeadingEntry({
    required this.level,
    required this.text,
    required this.offset,
  });
}

final _headingPattern = RegExp(r'^(#{1,6})\s+(.+?)\s*#*\s*$', multiLine: true);

/// 抽取标题目录（仅解析 ATX 标题；围栏内不参与）
List<HeadingEntry> extractHeadings(String body) {
  final masked = _maskFences(body);
  final out = <HeadingEntry>[];
  for (final match in _headingPattern.allMatches(masked)) {
    final marks = match.group(1)!;
    out.add(
      HeadingEntry(
        level: marks.length,
        text: match.group(2)!.trim(),
        offset: match.start,
      ),
    );
  }
  return out;
}
