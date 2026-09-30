// CJK/拉丁 检索分析器——复刻桌面端 packages/main/src/indexer/index-service.ts 的语义
//
// 索引侧：CJK run → unigram + bigram；拉丁/数字 → 小写整词。
// 查询侧：CJK run（≥2）→ bigram AND；单字 → unigram；拉丁词 → 前缀匹配。
library;

/// CJK 码位范围（与桌面端一致：扩展A + 基本区 + 兼容区）
final _cjkRanges = [
  (0x3400, 0x4DBF),
  (0x4E00, 0x9FFF),
  (0xF900, 0xFAFF),
];

final _wordPattern = RegExp(r'[a-z0-9]+');

bool _isCjk(int codeUnit) {
  for (final (start, end) in _cjkRanges) {
    if (codeUnit >= start && codeUnit <= end) return true;
  }
  return false;
}

/// 把文本切成「CJK run / 拉丁数字 run」两类片段，顺序与桌面端 TOKEN_RE 一致。
List<({bool cjk, String text})> _splitRuns(String lower) {
  final runs = <({bool cjk, String text})>[];
  var i = 0;
  while (i < lower.length) {
    final code = lower.codeUnitAt(i);
    if (_isCjk(code)) {
      var j = i;
      while (j < lower.length && _isCjk(lower.codeUnitAt(j))) {
        j++;
      }
      runs.add((cjk: true, text: lower.substring(i, j)));
      i = j;
      continue;
    }
    final match = _wordPattern.matchAsPrefix(lower, i);
    if (match != null) {
      runs.add((cjk: false, text: match.group(0)!));
      i = match.end;
      continue;
    }
    i++;
  }
  return runs;
}

/// 索引侧分词
List<String> indexTokens(String text) {
  final tokens = <String>[];
  for (final run in _splitRuns(text.toLowerCase())) {
    if (run.cjk) {
      final s = run.text;
      for (var i = 0; i < s.length; i++) {
        tokens.add(s[i]);
      }
      for (var i = 0; i + 1 < s.length; i++) {
        tokens.add(s.substring(i, i + 2));
      }
    } else {
      tokens.add(run.text);
    }
  }
  return tokens;
}

/// 查询项：token 文本 + 是否前缀匹配（拉丁词使用前缀）
typedef QueryTerm = ({String token, bool prefix});

/// 查询侧分词
List<QueryTerm> queryTerms(String query) {
  final terms = <QueryTerm>[];
  for (final run in _splitRuns(query.toLowerCase())) {
    if (run.cjk) {
      final s = run.text;
      if (s.length == 1) {
        terms.add((token: s, prefix: false));
      } else {
        for (var i = 0; i + 1 < s.length; i++) {
          terms.add((token: s.substring(i, i + 2), prefix: false));
        }
      }
    } else {
      terms.add((token: run.text, prefix: true));
    }
  }
  return terms;
}
