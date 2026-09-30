import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/vault/frontmatter.dart';

void main() {
  test('解析标准元数据头', () {
    const content = '---\ntitle: 示例\ntags:\n  - a\n  - b\n---\n\n正文内容\n';
    final parsed = parseMarkdown(content);
    expect(parsed.data['title'], '示例');
    expect(parsed.data['tags'], equals(['a', 'b']));
    expect(parsed.body, equals('正文内容\n'));
    expect(parsed.rawFrontmatter, isNotNull);
  });

  test('无元数据头时全文作为正文', () {
    const content = '# 标题\n\n正文';
    final parsed = parseMarkdown(content);
    expect(parsed.data, isEmpty);
    expect(parsed.body, equals(content));
    expect(parsed.rawFrontmatter, isNull);
  });

  test('头部损坏时按无头部处理且正文不丢', () {
    const content = '---\n: : :\nbroken\n\n正文';
    final parsed = parseMarkdown(content);
    expect(parsed.body, contains('正文'));
  });

  test('CRLF 归一化后可解析', () {
    const content = '---\r\ntitle: CRLF\r\n---\r\n\r\n正文';
    final parsed = parseMarkdown(content);
    expect(parsed.data['title'], 'CRLF');
    expect(parsed.body, contains('正文'));
  });

  group('标题解析', () {
    test('优先取元数据头 title', () {
      final title = resolveTitle(
        path: 'notes/a.md',
        frontmatter: const {'title': '头部标题'},
        body: '# 正文标题',
      );
      expect(title, '头部标题');
    });

    test('无头部时取首个一级标题', () {
      final title = resolveTitle(
        path: 'notes/a.md',
        frontmatter: const {},
        body: '\n# 正文标题\n',
      );
      expect(title, '正文标题');
    });

    test('都没有时取文件名', () {
      final title = resolveTitle(
        path: 'notes/文件名.md',
        frontmatter: const {},
        body: '正文没有标题',
      );
      expect(title, '文件名');
    });
  });

  test('生成元数据头可被再次解析', () {
    final header = buildFrontmatter(const {
      'title': '捕获',
      'tags': ['inbox', 'capture'],
      'type': 'note',
    });
    final parsed = parseMarkdown('$header\n正文');
    expect(parsed.data['title'], '捕获');
    expect(parsed.data['tags'], equals(['inbox', 'capture']));
    expect(parsed.data['type'], 'note');
  });
}
