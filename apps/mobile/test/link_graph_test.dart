import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/reader/link_graph.dart';
import 'package:nexnote_mobile/vault/vault_repository.dart';
import 'package:nexnote_mobile/vault/vault_store.dart';

void main() {
  late Directory tmp;
  late VaultRepository repo;
  late LinkGraph graph;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-graph-test');
    final store = await VaultStore.open(
      name: 'default',
      appSupportOverride: tmp,
    );
    repo = VaultRepository(store);
    repo.createPage(
      'index.md',
      '---\ntitle: 根页面\naliases:\n  - 入口\ntags:\n  - fixture\n---\n\n'
          '指向 [[设备端同步]] 与 [[设备端同步|同步别名]]，还有 [[不存在页面]]。\n',
    );
    repo.createPage(
      'notes/设备端同步.md',
      '---\ntitle: 设备端同步\ntags:\n  - git\n---\n\n回到 [[根页面]]。\n',
    );
    graph = LinkGraph.build(repo);
  });

  tearDown(() async {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  test('解析标题与别名', () {
    expect(graph.resolve('设备端同步'), 'notes/设备端同步.md');
    expect(graph.resolve('根页面'), 'index.md');
    expect(graph.resolve('入口'), 'index.md');
    expect(graph.resolve('设备端同步.md'), 'notes/设备端同步.md');
    expect(graph.resolve('缺失'), isNull);
  });

  test('回链与出链', () {
    final backlinks = graph.backlinksFor('notes/设备端同步.md');
    expect(backlinks.length, 2, reason: 'index.md 中出现两次链接');
    expect(backlinks.every((e) => e.fromPath == 'index.md'), isTrue);
    expect(graph.outgoingFor('index.md').length, 2,
        reason: '仅计入已解析的双链，未解析链接不产生出链');
    expect(graph.outgoingFor('notes/设备端同步.md').single.toPath, 'index.md');
  });

  test('未解析链接被记录', () {
    expect(graph.unresolved.length, 1);
    expect(graph.unresolved.single.rawTarget, '不存在页面');
  });

  test('标签索引', () {
    final tags = graph.tagIndex();
    expect(tags.keys, containsAll(['fixture', 'git']));
    expect(tags['git'], {'notes/设备端同步.md'});
  });

  test('邻接表无向', () {
    final adjacency = graph.adjacency();
    expect(adjacency['index.md'], contains('notes/设备端同步.md'));
    expect(adjacency['notes/设备端同步.md'], contains('index.md'));
  });

  test('回链上下文包含原句', () {
    final edge = graph.backlinksFor('notes/设备端同步.md').first;
    expect(edge.context, contains('指向'));
  });
}
