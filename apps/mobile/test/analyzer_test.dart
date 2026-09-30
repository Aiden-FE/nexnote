import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/index/analyzer.dart';

void main() {
  group('indexTokens（索引侧）', () {
    test('中文 run 产 unigram + bigram', () {
      final tokens = indexTokens('搜索基准');
      expect(tokens, containsAll(['搜', '索', '基', '准', '搜索', '索基', '基准']));
      // 4 字 CJK → 4 unigram + 3 bigram = 7
      expect(tokens.length, 7);
    });

    test('拉丁词小写整词', () {
      final tokens = indexTokens('Hello World');
      expect(tokens, equals(['hello', 'world']));
    });

    test('混合文本保持顺序', () {
      final tokens = indexTokens('移动 Mobile 端');
      expect(tokens.take(3), equals(['移', '动', '移动']));
      expect(tokens, contains('mobile'));
      expect(tokens.last, '端');
    });

    test('数字整词', () {
      expect(indexTokens('2026 note'), contains('2026'));
      expect(indexTokens('2026 note'), contains('note'));
    });
  });

  group('queryTerms（查询侧）', () {
    test('中文 ≥2 字 → bigram AND', () {
      final terms = queryTerms('搜索基准');
      expect(terms.map((t) => t.token), equals(['搜索', '索基', '基准']));
      expect(terms.every((t) => !t.prefix), isTrue);
    });

    test('单字中文 → unigram', () {
      expect(queryTerms('搜').map((t) => t.token), equals(['搜']));
    });

    test('拉丁词 → 前缀匹配', () {
      final terms = queryTerms('nex');
      expect(terms, equals([(token: 'nex', prefix: true)]));
    });

    test('混合查询保持顺序', () {
      final terms = queryTerms('搜 nex');
      expect(terms.map((t) => t.token), equals(['搜', 'nex']));
      expect(terms.first.prefix, isFalse);
      expect(terms.last.prefix, isTrue);
    });
  });

  test('与桌面端语义一致性：same expected tokens for canonical 触发词', () {
    // 桌面端 "搜索基准" 应命中的最短 bigram：'搜索' 与 '基准' 都存在于 tok 中
    final doc = indexTokens('搜索基准库内容');
    for (final term in queryTerms('基准')) {
      expect(doc, contains(term.token));
    }
  });
}
