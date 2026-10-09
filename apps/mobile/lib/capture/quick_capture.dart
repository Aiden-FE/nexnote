// 快速捕获——MOB-009
//
// 捕获即页面：写入捕获目录，自带默认元数据头，同名不覆盖。
library;

import '../vault/frontmatter.dart';
import '../vault/page_writer.dart';

/// 捕获错误种类（语言中性）；UI 层翻译（ADR-0023）。
enum CaptureErrorCode { empty }

/// 捕获结果
class CaptureResult {
  final String path;
  final String title;
  final bool generatedTitle;
  const CaptureResult(this.path, this.title, {this.generatedTitle = false});
}

/// 缺省标题的语言中性稳定标识：文件名 / frontmatter 用它，UI 再本地化。
const String untitledCaptureTitle = 'untitled';

/// 快速捕获
class QuickCapture {
  final PageWriter writer;

  /// 默认捕获类型（写入元数据头）
  final String defaultType;

  const QuickCapture({required this.writer, this.defaultType = 'note'});

  /// 捕获文本；返回新建页面路径
  CaptureResult capture(String text, {String captureDirectory = 'Inbox'}) {
    final body = text.trim();
    if (body.isEmpty) {
      throw const CaptureError(CaptureErrorCode.empty);
    }
    final title = _titleOf(body);
    final now = DateTime.now();
    final stamp = '${now.year}-${_two(now.month)}-${_two(now.day)} '
        '${_two(now.hour)}:${_two(now.minute)}';
    final fileName = '${_sanitizeFileName(title)}.md';
    final path = _uniquePath(captureDirectory, fileName);
    final content =
        '${buildFrontmatter({'title': title, 'created': stamp, 'type': defaultType})}\n$body\n';
    writer.createPage(path, content, summary: '快速捕获 $title');
    return CaptureResult(
      path,
      title,
      generatedTitle: title == untitledCaptureTitle,
    );
  }

  static String _two(int value) => value.toString().padLeft(2, '0');

  /// 标题取正文首行
  static String _titleOf(String body) {
    for (final line in body.split('\n')) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;
      final withoutMarker =
          trimmed.startsWith('#') ? trimmed.replaceFirst(RegExp(r'^#+\s*'), '') : trimmed;
      return withoutMarker.length > 60
          ? withoutMarker.substring(0, 60)
          : withoutMarker;
    }
    return untitledCaptureTitle;
  }

  /// 文件名安全化：去掉路径分隔符与非法字符
  static String _sanitizeFileName(String title) {
    final cleaned = title
        .replaceAll(RegExp(r'[/\\:*?"<>|]'), '-')
        .replaceAll(RegExp(r'-+'), '-')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    return cleaned.isEmpty ? untitledCaptureTitle : cleaned;
  }

  /// 同名时追加序号，绝不覆盖
  String _uniquePath(String directory, String fileName) {
    final base = fileName.substring(0, fileName.length - 3);
    var candidate = '$directory/$fileName';
    var index = 1;
    while (_exists(candidate)) {
      candidate = '$directory/$base-$index.md';
      index++;
    }
    return candidate;
  }

  bool _exists(String path) {
    try {
      return writer.repository.vault.file(path).existsSync();
    } on Object {
      return false;
    }
  }
}

class CaptureError implements Exception {
  final CaptureErrorCode code;
  const CaptureError(this.code);
  @override
  String toString() => code.name;
}
