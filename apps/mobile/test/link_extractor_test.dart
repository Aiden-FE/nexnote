import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/vault/link_extractor.dart';

void main() {
  group('双链抽取', () {
    test('基础双链', () {
      final links = extractWikiLinks('参见 [[设备端同步]]。');
      expect(links.length, 1);
      expect(links.first.target, '设备端同步');
      expect(links.first.alias, isNull);
    });

    test('带别名的双链', () {
      final links = extractWikiLinks('[[设备端同步|同步]]');
      expect(links.first.target, '设备端同步');
      expect(links.first.alias, '同步');
    });

    test('带锚点的双链', () {
      final links = extractWikiLinks('[[设备端同步#提交节奏]]');
      expect(links.first.target, '设备端同步');
      expect(links.first.anchor, '提交节奏');
    });

    test('锚点与别名同时存在', () {
      final links = extractWikiLinks('[[设备端同步#提交节奏|节奏]]');
      expect(links.first.target, '设备端同步');
      expect(links.first.anchor, '提交节奏');
      expect(links.first.alias, '节奏');
    });

    test('代码块与行内代码内的双链不参与', () {
      const body = '''
```dart
final x = '[[不该命中]]';
```
行内 `[[也不该命中]]` 但这里应该 [[该命中]]。
''';
      final links = extractWikiLinks(body);
      expect(links.map((l) => l.target), equals(['该命中']));
    });

    test('同一正文多条双链按出现顺序', () {
      final links = extractWikiLinks('[[A]] 然后 [[B]]');
      expect(links.map((l) => l.target), equals(['A', 'B']));
      expect(links[0].offset < links[1].offset, isTrue);
    });

    test('偏移量指向原始文本', () {
      const body = '前缀 [[目标]] 后缀';
      final link = extractWikiLinks(body).single;
      expect(body.substring(link.offset, link.offset + link.raw.length),
          equals('[[目标]]'));
    });

    test('空目标不产生链接', () {
      expect(extractWikiLinks('[[]] [[|别名]]'), isEmpty);
    });
  });

  group('标题目录抽取', () {
    test('按层级抽取 ATX 标题', () {
      const body = '# 一级\n\n正文\n\n## 二级\n\n### 三级\n';
      final headings = extractHeadings(body);
      expect(headings.map((h) => h.level), equals([1, 2, 3]));
      expect(headings.map((h) => h.text), equals(['一级', '二级', '三级']));
    });

    test('代码块内的 # 不算标题', () {
      const body = '# 真标题\n\n```\n# 不是标题\n```\n';
      final headings = extractHeadings(body);
      expect(headings.map((h) => h.text), equals(['真标题']));
    });

    test('结尾 # 被剥离', () {
      expect(extractHeadings('## 标题 ##').single.text, '标题');
    });

    test('偏移量可定位原文', () {
      const body = '前言\n\n## 章节\n';
      final heading = extractHeadings(body).single;
      expect(body.substring(heading.offset).startsWith('## 章节'), isTrue);
    });
  });
}
