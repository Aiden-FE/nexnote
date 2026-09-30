// MOB-006 在 iOS 运行时上验证：sqlite3 原生库可用 + 分词命中与桌面语义一致
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nexnote_mobile/core/models.dart';
import 'package:nexnote_mobile/index/search_index.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('iOS 运行时：中文子串搜索与桌面语义一致', (tester) async {
    final index = SearchIndex.inMemory();

    final pages = [
      const Page(
        path: 'a.md',
        title: '搜索基准',
        body: '这是关于搜索基准的说明内容。',
        frontmatter: null,
      ),
      const Page(
        path: 'b.md',
        title: '移动端计划',
        body: '里程碑：M1 Git、M2 阅读搜索、M3 编辑、M4 捕获与 AI。',
        frontmatter: null,
      ),
      const Page(
        path: 'c.md',
        title: 'NexNote',
        body: 'nexnote mobile 是本地优先知识库。',
        frontmatter: null,
      ),
    ];
    index.rebuild(pages);
    expect(index.documentCount, 3);

    // 中文子串（不同于整词：'基准' 是 '搜索基准' 的子串）
    final hitsJizhun = index.search('基准');
    expect(hitsJizhun.map((h) => h.path), equals(['a.md']));

    // 单字 unigram
    expect(index.search('里').map((h) => h.path), equals(['b.md']));

    // 拉丁前缀
    expect(index.search('nex').map((h) => h.path), equals(['c.md']));

    // 不存在词返回空
    expect(index.search('不存在词'), isEmpty);

    index.close();
  });
}
