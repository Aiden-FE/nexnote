// 流式请求链路验证（MockClient，不触网）——MOB-010
//
// 证明同一条链路上：URL 拼接 → 请求体（reasoning_effort=none + messages）
// → SSE 解析 → reasoning 残留清洗 → 增量产出。
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexnote_mobile/ai/chat_controller.dart';
import 'package:nexnote_mobile/ai/openai_client.dart';
import 'package:nexnote_mobile/ai/provider_profile.dart';
import 'package:nexnote_mobile/ai/retrieval.dart';
import 'package:nexnote_mobile/ai/secret_vault.dart';
import 'package:nexnote_mobile/index/search_index.dart';
import 'package:nexnote_mobile/reader/link_graph.dart';
import 'package:nexnote_mobile/vault/vault_repository.dart';
import 'package:nexnote_mobile/vault/vault_store.dart';

void main() {
  late Directory tmp;
  late VaultRepository repo;
  late ProviderProfileStore store;
  late SearchIndex index;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-ai-stream-test');
    final vault = await VaultStore.open(
      name: 'default',
      appSupportOverride: tmp,
    );
    repo = VaultRepository(vault);
    repo.createPage('a.md', '---\ntitle: 设备端同步\n---\n\n防抖与提交节奏。\n');
    index = SearchIndex.inMemory();
    index.rebuild(repo.readAllPages());
    store = ProviderProfileStore(appSupport: tmp, secrets: InMemorySecretVault());
  });

  tearDown(() {
    index.close();
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  Retrieval buildRetrieval() =>
      Retrieval(index: index, graph: LinkGraph.build(repo));

  test('流式响应经解析与清洗后逐段呈现，请求体正确', () async {
    final profile = ProviderProfile(
      id: 'p1',
      name: '测试',
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'demo',
    );
    final client = MockClient((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(request.url.path, '/v1/chat/completions');
      expect(body['reasoning_effort'], 'none');
      expect(body['model'], 'demo');
      expect(body['stream'], isTrue);
      expect((body['messages'] as List).last['content'], '问题');
      final frames = <String>[
        'data: {"choices":[{"delta":{"content":"<thi"}}]}',
        'data: {"choices":[{"delta":{"content":"nk>思考中</th"}}]}',
        'data: {"choices":[{"delta":{"content":"ink>最终答案"}}]}',
        'data: [DONE]',
      ];
      return http.Response.bytes(
        utf8.encode('${frames.join('\n')}\n'),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });

    final openAi = const OpenAiClient(
      messages: [
        {'role': 'user', 'content': '问题'},
      ],
    );
    final chunks = <String>[];
    await for (final chunk in openAi.streamChat(
      profile: profile,
      apiKey: 'sk-test',
      client: client,
    )) {
      chunks.add(chunk);
    }
    expect(chunks.join(), '最终答案');
  });

  test('非 200 响应抛出带状态码的错误且不泄漏响应体', () async {
    final profile = ProviderProfile(
      id: 'p1',
      name: '测试',
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'demo',
    );
    final client = MockClient(
      (_) async => http.Response('{"error":"internal secret detail"}', 500),
    );
    final openAi = const OpenAiClient(
      messages: [
        {'role': 'user', 'content': '问题'},
      ],
    );
    var thrown = false;
    try {
      await openAi
          .streamChat(profile: profile, apiKey: 'sk', client: client)
          .toList();
    } on AiRequestError catch (e) {
      thrown = true;
      expect(e.statusCode, 500);
      expect(e.message, isNot(contains('secret detail')));
    }
    expect(thrown, isTrue);
  });

  test('未配置 Profile 时不发起请求', () async {
    final controller = ChatController(
      retrieval: buildRetrieval(),
      profiles: store,
    );
    await controller.send('你好');
    expect(controller.messages, isEmpty);
    expect(controller.lastError, contains('未配置供应商 Profile'));
  });

  test('无密钥的 Profile 不发起请求', () async {
    await store.upsert(
      ProviderProfile(id: 'p1', name: '无钥', baseUrl: 'https://x/v1'),
      null,
    );
    final controller = ChatController(
      retrieval: buildRetrieval(),
      profiles: store,
    );
    await controller.send('你好');
    expect(controller.messages, isEmpty);
    expect(controller.lastError, contains('未配置 API Key'));
  });

  test('空问题不触发任何状态变化', () async {
    final controller = ChatController(
      retrieval: buildRetrieval(),
      profiles: store,
    );
    await controller.send('   ');
    expect(controller.messages, isEmpty);
    expect(controller.lastError, isNull);
  });
}
