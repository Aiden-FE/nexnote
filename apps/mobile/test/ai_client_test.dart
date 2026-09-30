// OpenAI 兼容客户端、reasoning 残留清洗与两阶段召回——MOB-010
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/ai/openai_client.dart';
import 'package:nexnote_mobile/ai/provider_profile.dart';
import 'package:nexnote_mobile/ai/retrieval.dart';
import 'package:nexnote_mobile/ai/secret_vault.dart';
import 'package:nexnote_mobile/index/search_index.dart';
import 'package:nexnote_mobile/reader/link_graph.dart';
import 'package:nexnote_mobile/vault/vault_repository.dart';
import 'package:nexnote_mobile/vault/vault_store.dart';

String _runCleaner(List<String> chunks) {
  final cleaner = ReasoningResidueCleaner();
  final out = StringBuffer();
  for (final chunk in chunks) {
    out.write(cleaner.accept(chunk));
  }
  out.write(cleaner.flush());
  return out.toString();
}

void main() {
  group('SSE 分片解析', () {
    test('解析标准 delta', () {
      const payload = '{"choices":[{"delta":{"content":"你好"}}]}';
      expect(OpenAiClient.parseDelta(payload), '你好');
    });

    test('忽略非文本分片与异常负载', () {
      expect(OpenAiClient.parseDelta('{"choices":[]}'), isNull);
      expect(OpenAiClient.parseDelta('not json'), isNull);
    });
  });

  group('reasoning 残留清洗', () {
    test('跨分片拼接的 think 标签被完整剔除', () {
      expect(_runCleaner(['<thi', 'nk>内部思考</th', 'ink>答案']), '答案');
    });

    test('analysis 标签同样被剔除', () {
      expect(_runCleaner(['<analysis>推理</analysis>结论']), '结论');
    });

    test('无残留时原文保留', () {
      expect(_runCleaner(['正常', '内容']), '正常内容');
    });

    test('未闭合的 think 内容不展示', () {
      expect(_runCleaner(['<think>一直思考']), '');
    });
  });

  test('无思考参数与桌面端一致（reasoning_effort=none）', () {
    expect(OpenAiClient.noReasoningEffort, 'none');
  });

  group('chat/completions URL 拼接', () {
    test('拼接 base-url 与 model', () {
      final url = OpenAiClient.chatUrl('https://api.example.com/v1/', 'gpt-x');
      expect(url.toString(), contains('/v1/chat/completions'));
      expect(url.queryParameters['model'], 'gpt-x');
    });
  });

  group('Profile 存储与密钥分离', () {
    late Directory tmp;
    late ProviderProfileStore store;
    final secrets = InMemorySecretVault();

    setUp(() async {
      tmp = await Directory.systemTemp.createTemp('nexnote-ai-test');
      store = ProviderProfileStore(appSupport: tmp, secrets: secrets);
    });

    tearDown(() {
      if (tmp.existsSync()) tmp.deleteSync(recursive: true);
    });

    test('配置文件不含密钥字节', () async {
      await store.upsert(
        ProviderProfile(id: 'a', name: '主', baseUrl: 'https://x/v1'),
        'sk-secret-value',
      );
      final raw = store.file.readAsStringSync();
      expect(raw, isNot(contains('sk-secret-value')));
      expect(raw, contains('keyAccount'));
    });

    test('密钥可从 SecretVault 取回', () async {
      final profile =
          ProviderProfile(id: 'a', name: '主', baseUrl: 'https://x/v1');
      await store.upsert(profile, 'sk-secret-value');
      expect(profile.hasKey, isTrue);
      expect(await store.keyFor(profile), 'sk-secret-value');
    });

    test('未配置密钥的 Profile hasKey 为 false', () {
      expect(
        ProviderProfile(id: 'b', name: '空', baseUrl: 'https://x/v1').hasKey,
        isFalse,
      );
    });

    test('删除 Profile 同时清除密钥', () async {
      final profile =
          ProviderProfile(id: 'c', name: '待删', baseUrl: 'https://x/v1');
      await store.upsert(profile, 'sk-to-delete');
      await store.remove('c');
      expect(store.list(), isEmpty);
      expect(await secrets.read('profile-c'), isNull);
    });
  });

  group('两阶段召回', () {
    late Directory tmp;
    late SearchIndex index;
    late Retrieval retrieval;

    setUp(() async {
      tmp = await Directory.systemTemp.createTemp('nexnote-retrieval-test');
      final store =
          await VaultStore.open(name: 'default', appSupportOverride: tmp);
      final repo = VaultRepository(store);
      repo.createPage(
        'a.md',
        '---\ntitle: 设备端同步\ntags:\n  - git\n---\n\n提交节奏与防抖。\n',
      );
      repo.createPage('b.md', '---\ntitle: 基础编辑\n---\n\n块编辑与源码编辑。\n');
      repo.createPage(
        'c.md',
        '---\ntitle: 捕获目录\n---\n\n[[设备端同步]] 相关。\n',
      );
      index = SearchIndex.inMemory();
      index.rebuild(repo.readAllPages());
      retrieval = Retrieval(index: index, graph: LinkGraph.build(repo));
    });

    tearDown(() {
      index.close();
      if (tmp.existsSync()) tmp.deleteSync(recursive: true);
    });

    test('阶段一命中关键词页面', () {
      final citations = retrieval.recall('防抖');
      expect(citations.first.stage, RecallStage.keyword);
      expect(citations.first.path, 'a.md');
    });

    test('阶段二沿双链扩展一跳', () {
      final citations = retrieval.recall('捕获目录');
      final stages = citations.map((c) => c.stage).toSet();
      expect(stages, contains(RecallStage.keyword));
      expect(
        citations.any((c) => c.path == 'a.md' && c.stage == RecallStage.links),
        isTrue,
        reason: 'c.md 链接 a.md，应被双链扩展命中',
      );
    });

    test('不重复引用同一页面', () {
      final citations = retrieval.recall('捕获目录');
      final paths = citations.map((c) => c.path).toList();
      expect(paths.toSet().length, paths.length);
    });

    test('上下文按上限截断', () {
      final context = retrieval.contextFor('a.md', maxChars: 5);
      expect(context.length, lessThanOrEqualTo(6));
    });

    test('阶段标签可读', () {
      expect(RecallStage.keyword.label, '关键词');
      expect(RecallStage.links.label, '双链扩展');
    });
  });
}
