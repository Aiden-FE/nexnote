// 元数据头解析与生成——只读展示 + 快速捕获写入
library;

import 'package:yaml/yaml.dart';

/// 解析结果：原始头部文本（用于字节保真回写）、解析后的字段、正文
class ParsedMarkdown {
  /// 原始元数据头块（含 `---` 围栏），无头部时为 null
  final String? rawFrontmatter;

  /// 头部字段（无头部时为空）
  final Map<String, dynamic> data;

  /// 正文（不含元数据头）
  final String body;

  const ParsedMarkdown({
    required this.rawFrontmatter,
    required this.data,
    required this.body,
  });
}

/// 解析 Markdown 文件内容，拆出元数据头与正文
ParsedMarkdown parseMarkdown(String content) {
  final normalized = content.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) {
    return ParsedMarkdown(rawFrontmatter: null, data: const {}, body: content);
  }
  final end = normalized.indexOf('\n---', 3);
  if (end < 0) {
    return ParsedMarkdown(rawFrontmatter: null, data: const {}, body: content);
  }
  // 找到结束围栏所在行的行尾
  var fenceEnd = normalized.indexOf('\n', end + 1);
  if (fenceEnd < 0) fenceEnd = normalized.length;
  final rawHeader = normalized.substring(0, fenceEnd + 1);
  var body = normalized.substring(fenceEnd + 1);
  // 围栏后紧跟的单个空行属于排版，不属于正文
  if (body.startsWith('\n')) body = body.substring(1);
  final yamlText = normalized.substring(4, end);
  Map<String, dynamic> data = const {};
  try {
    final loaded = loadYaml(yamlText);
    if (loaded is YamlMap) {
      data = loaded.value.cast<String, dynamic>();
    }
  } on Object {
    // 头部损坏时按无头部处理，正文保持原样
    data = const {};
  }
  return ParsedMarkdown(
    rawFrontmatter: rawHeader,
    data: data,
    body: body,
  );
}

/// 标题解析顺序：元数据头 title > 正文首个一级标题 > 文件名
String resolveTitle({
  required String path,
  required Map<String, dynamic> frontmatter,
  required String body,
}) {
  final fromFrontmatter = frontmatter['title']?.toString().trim();
  if (fromFrontmatter != null && fromFrontmatter.isNotEmpty) {
    return fromFrontmatter;
  }
  for (final line in body.split('\n')) {
    final trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.substring(2).trim();
    }
    if (trimmed.isNotEmpty) break;
  }
  final name = path.split('/').last;
  return name.endsWith('.md') ? name.substring(0, name.length - 3) : name;
}

/// 生成元数据头块（快速捕获用）
String buildFrontmatter(Map<String, dynamic> data) {
  final buffer = StringBuffer('---');
  data.forEach((key, value) {
    buffer.writeln();
    if (value is List) {
      buffer.write('$key:');
      for (final item in value) {
        buffer.writeln();
        buffer.write('  - $item');
      }
    } else {
      buffer.write('\n$key: $value');
    }
  });
  buffer.write('\n---\n');
  return buffer.toString();
}
