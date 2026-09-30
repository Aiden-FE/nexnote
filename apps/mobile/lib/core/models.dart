// 领域模型
library;

import 'constants.dart';

/// 提交记录——桌面时间线语义
class CommitRecord {
  final String hash;
  final String author;
  final DateTime date;
  final String message;
  final CommitKind kind;
  final bool isHead;

  const CommitRecord({
    required this.hash,
    required this.author,
    required this.date,
    required this.message,
    required this.kind,
    required this.isHead,
  });

  /// 从消息解析 kind（桌面端用 `nexnote:*:` 前缀判定）
  factory CommitRecord.from(
      String hash, String author, DateTime date, String message, bool isHead) {
    CommitKind resolveKind() {
      if (message.startsWith(CommitPrefix.auto)) return CommitKind.auto;
      if (message.startsWith(CommitPrefix.manual)) return CommitKind.manual;
      if (message.startsWith(CommitPrefix.initial)) return CommitKind.initial;
      return CommitKind.unknown;
    }

    return CommitRecord(
      hash: hash,
      author: author,
      date: date,
      message: message,
      kind: resolveKind(),
      isHead: isHead,
    );
  }
}

/// 页面——设备知识库内的一篇文档
class Page {
  final String path;
  final String title;
  final String body;
  final Frontmatter? frontmatter;

  const Page({
    required this.path,
    required this.title,
    required this.body,
    required this.frontmatter,
  });
}

/// 元数据头——只读展示
class Frontmatter {
  final String title;
  final List<String> tags;
  final List<String> aliases;
  final dynamic created;
  final dynamic updated;
  final dynamic type;
  final dynamic confidence;
  final Map<String, dynamic> custom;

  Frontmatter.fromMap(Map<String, dynamic> m)
      : title = m['title']?.toString() ?? '',
        tags = [
          ...(m['tags'] as List?)?.map((e) => e.toString()) ??
              const <String>[],
        ],
        aliases = [
          ...(m['aliases'] as List?)?.map((e) => e.toString()) ??
              const <String>[],
        ],
        created = m['created'],
        updated = m['updated'],
        type = m['type'],
        confidence = m['confidence'],
        custom = {...m}
          ..removeWhere((k, _) => Frontmatter.trimmedKeys.contains(k));

  static const trimmedKeys = {
    'title',
    'tags',
    'aliases',
    'created',
    'updated',
    'type',
    'confidence',
  };
}
