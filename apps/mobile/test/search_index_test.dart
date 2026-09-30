import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/core/models.dart';
import 'package:nexnote_mobile/index/search_index.dart';

Page _page(String path, String title, String body, {List<String> tags = const []}) {
  final fm = tags.isEmpty ? null : Frontmatter.fromMap({'tags': tags});
  return Page(path: path, title: title, body: body, frontmatter: fm);
}

void main() {
  late SearchIndex index;

  setUp(() {
    index = SearchIndex.inMemory();
  });

  tearDown(() {
    index.close();
  });

  test('全量重建后中文子串可命中', () {
    index.rebuild([
      _page('a.md', '搜索基准', '这是关于搜索基准的说明。'),
      _page('b.md', '其它页面', '与搜索无关。'),
    ]);
    final hits = index.search('基准');
    expect(hits.map((h) => h.path), equals(['a.md']));
  });

  test('单字中文命中 unigram', () {
    index.rebuild([_page('a.md', '标题', '包含中文内容')]);
    expect(index.search('中').map((h) => h.path), equals(['a.md']));
  });

  test('拉丁词前缀匹配', () {
    index.rebuild([_page('a.md', 'NexNote', 'nexnote mobile 验收库')]);
    expect(index.search('nex').map((h) => h.path), equals(['a.md']));
    expect(index.search('xyz').map((h) => h.path), isEmpty);
  });

  test('多词为 AND 关系', () {
    index.rebuild([
      _page('a.md', '甲', '搜索 基准'),
      _page('b.md', '乙', '搜索 结果'),
    ]);
    expect(index.search('搜索 基准').map((h) => h.path), equals(['a.md']));
    expect(index.search('搜索 结果').map((h) => h.path), equals(['b.md']));
    expect(index.search('搜索 缺失'), isEmpty);
  });

  test('标题与标签参与检索', () {
    index.rebuild([
      _page('a.md', '标题关键词', '正文', tags: ['fixture']),
    ]);
    expect(index.search('标题关键词').map((h) => h.path), equals(['a.md']));
    expect(index.search('fixture').map((h) => h.path), equals(['a.md']));
  });

  test('增量更新与删除', () {
    index.rebuild([_page('a.md', '旧标题', '旧内容')]);
    index.upsert(_page('a.md', '新标题', '新内容关键词'));
    expect(index.search('旧内容'), isEmpty);
    expect(index.search('关键词').map((h) => h.path), equals(['a.md']));
    index.remove('a.md');
    expect(index.search('关键词'), isEmpty);
  });

  test('重建幂等', () {
    final pages = [
      _page('a.md', '甲', '内容甲'),
      _page('b.md', '乙', '内容乙'),
    ];
    index.rebuild(pages);
    final first = index.search('内容').map((h) => h.path).toList();
    index.rebuild(pages);
    final second = index.search('内容').map((h) => h.path).toList();
    expect(second, equals(first));
    expect(index.documentCount, 2);
  });

  test('空查询返回空结果', () {
    index.rebuild([_page('a.md', '甲', '内容')]);
    expect(index.search(''), isEmpty);
    expect(index.search('   '), isEmpty);
  });

  test('片段包含命中词与省略号', () {
    final long = '${'前缀内容。' * 20}命中词在这里。${'后缀内容。' * 20}';
    index.rebuild([_page('a.md', '甲', long)]);
    final hit = index.search('命中词').first;
    expect(hit.snippet, contains('命中词'));
    expect(hit.snippet.startsWith('…'), isTrue);
  });
}
