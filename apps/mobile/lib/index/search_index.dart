// 设备本地搜索索引——MOB-006
//
// 桌面端用 FTS5 + 自定义 CJK 分词；Dart 侧 sqlite3 绑定没有自定义 FTS5
// 分词器接口（已核对 sqlite3 3.6.0），因此以同语义的倒排表实现：
// 分词与查询分析器完全复用 analyzer.dart，命中集合与桌面端一致。
library;

import 'dart:io';

import 'package:sqlite3/sqlite3.dart';

import '../core/models.dart';
import 'analyzer.dart';

/// 一条搜索命中
class SearchHit {
  final String path;
  final String title;
  final String snippet;

  const SearchHit({
    required this.path,
    required this.title,
    required this.snippet,
  });
}

/// 设备本地派生索引（可随时全量重建）
class SearchIndex {
  final Database _db;

  SearchIndex._(this._db) {
    _migrate();
  }

  /// 打开（或创建）索引文件
  static SearchIndex open(String path) {
    final file = File(path);
    if (!file.parent.existsSync()) file.parent.createSync(recursive: true);
    final db = sqlite3.open(path);
    db.execute('PRAGMA journal_mode = WAL;');
    return SearchIndex._(db);
  }

  /// 内存索引（测试用）
  static SearchIndex inMemory() => SearchIndex._(sqlite3.openInMemory());

  void _migrate() {
    _db.execute('''
      CREATE TABLE IF NOT EXISTS docs(
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS postings(
        token TEXT NOT NULL,
        doc_id INTEGER NOT NULL,
        PRIMARY KEY(token, doc_id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS postings_doc_idx ON postings(doc_id);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ''');
  }

  /// 索引版本（分词语义变化时递增，触发全量重建）
  static const schemaVersion = '1';

  bool get needsRebuild {
    final rows = _db.select(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    return rows.isEmpty || rows.first['value'] != schemaVersion;
  }

  /// 文档数
  int get documentCount =>
      _db.select('SELECT COUNT(*) AS c FROM docs').first['c'] as int;

  /// 全量重建（幂等）
  void rebuild(Iterable<Page> pages) {
    _db.execute('BEGIN');
    try {
      _db.execute('DELETE FROM postings');
      _db.execute('DELETE FROM docs');
      for (final page in pages) {
        _insert(page);
      }
      _db.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', ?) "
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [schemaVersion],
      );
      _db.execute('COMMIT');
    } on Object {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  /// 增量更新单页
  void upsert(Page page) {
    _db.execute('BEGIN');
    try {
      final existing = _db.select(
        'SELECT id FROM docs WHERE path = ?',
        [page.path],
      );
      if (existing.isNotEmpty) {
        final id = existing.first['id'] as int;
        _db.execute('DELETE FROM postings WHERE doc_id = ?', [id]);
        _db.execute('DELETE FROM docs WHERE id = ?', [id]);
      }
      _insert(page);
      _db.execute('COMMIT');
    } on Object {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  void remove(String path) {
    final rows = _db.select('SELECT id FROM docs WHERE path = ?', [path]);
    if (rows.isEmpty) return;
    final id = rows.first['id'] as int;
    _db.execute('DELETE FROM postings WHERE doc_id = ?', [id]);
    _db.execute('DELETE FROM docs WHERE id = ?', [id]);
  }

  void _insert(Page page) {
    final fm = page.frontmatter;
    final content = [
      page.title,
      (fm?.aliases ?? const <String>[]).join(' '),
      (fm?.tags ?? const <String>[]).join(' '),
      page.body,
    ].join('\n');
    _db.execute(
      'INSERT INTO docs(path, title, content) VALUES(?,?,?)',
      [page.path, page.title, content],
    );
    final docId = _db.lastInsertRowId;
    final tokens = indexTokens(content).toSet();
    final stmt = _db.prepare(
      'INSERT OR IGNORE INTO postings(token, doc_id) VALUES(?,?)',
    );
    try {
      for (final token in tokens) {
        stmt.execute([token, docId]);
      }
    } finally {
      stmt.close();
    }
  }

  /// 搜索：命中集合与桌面端一致（CJK bigram AND / 单字 unigram / 拉丁前缀）
  List<SearchHit> search(String query, {int limit = 50}) {
    final terms = queryTerms(query);
    if (terms.isEmpty) return const [];
    Set<int>? intersection;
    for (final term in terms) {
      final ids = _docIdsFor(term);
      if (ids.isEmpty) return const [];
      intersection = intersection == null
          ? ids
          : intersection.intersection(ids);
      if (intersection.isEmpty) return const [];
    }
    final hits = <SearchHit>[];
    final termTexts = terms.map((t) => t.token).toList();
    for (final id in intersection!) {
      final row =
          _db.select('SELECT path, title, content FROM docs WHERE id = ?', [id]);
      if (row.isEmpty) continue;
      final r = row.first;
      hits.add(
        SearchHit(
          path: r['path'] as String,
          title: r['title'] as String,
          snippet: snippetFor(r['content'] as String, termTexts),
        ),
      );
    }
    hits.sort((a, b) {
      final byTitle = a.title.compareTo(b.title);
      return byTitle != 0 ? byTitle : a.path.compareTo(b.path);
    });
    return hits.length > limit ? hits.sublist(0, limit) : hits;
  }

  Set<int> _docIdsFor(QueryTerm term) {
    if (!term.prefix) {
      final rows = _db.select(
        'SELECT doc_id FROM postings WHERE token = ?',
        [term.token],
      );
      return rows.map((r) => r['doc_id'] as int).toSet();
    }
    // 前缀：范围扫描（利用主键索引），上界用最大码位
    final rows = _db.select(
      'SELECT doc_id FROM postings WHERE token >= ? AND token < ?',
      [term.token, '${term.token}\u{10FFFF}'],
    );
    return rows.map((r) => r['doc_id'] as int).toSet();
  }

  /// 片段：与桌面端 blockLocalSnippet 一致——定位首个命中词并取上下文
  static String snippetFor(String content, List<String> terms) {
    if (content.isEmpty || terms.isEmpty) return '';
    final lower = content.toLowerCase();
    var index = -1;
    for (final term in terms) {
      final at = lower.indexOf(term);
      if (at >= 0 && (index == -1 || at < index)) index = at;
    }
    if (index == -1) return '';
    const lead = 40;
    final start = index - lead < 0 ? 0 : index - lead;
    final end = (index + terms.first.length + 100) > content.length
        ? content.length
        : index + terms.first.length + 100;
    final body = content.substring(start, end).replaceAll('\n', ' ');
    return '${start > 0 ? '…' : ''}$body${end < content.length ? '…' : ''}';
  }

  /// 关闭数据库连接
  void close() => _db.close();
}
