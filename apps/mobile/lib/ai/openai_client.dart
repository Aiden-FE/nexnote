// OpenAI 兼容流式客户端——MOB-010
//
// 行为语义对齐桌面端：显式触发才发请求、协议层显式关闭 reasoning
// （reasoning_effort: 'none'）、<think>/<analysis> 残留清洗、取消后已呈现内容保留。
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'provider_profile.dart';

/// AI 请求异常
class AiRequestError implements Exception {
  final String message;
  final int? statusCode;
  const AiRequestError(this.message, {this.statusCode});
  @override
  String toString() =>
      'AiRequestError(${statusCode ?? '-'}): $message';
}

/// OpenAI 兼容协议客户端
class OpenAiClient {
  /// 供应商无关的「关闭 reasoning」取值（与桌面端 TRANSLATION_REASONING_EFFORT 一致）
  static const noReasoningEffort = 'none';

  /// 对话消息
  final List<Map<String, String>> messages;

  const OpenAiClient({required this.messages});

  /// 构建 chat/completions URL
  static Uri chatUrl(String baseUrl, String model) {
    final normalized = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    final base = Uri.parse(normalized);
    return base.replace(
      path: '${base.path}/chat/completions',
      query: model.isEmpty ? null : 'model=$model',
    );
  }

  /// 流式对话：逐段返回增量文本
  ///
  /// [signal] 取消后，调用方已收到的内容保持有效。
  Stream<String> streamChat({
    required ProviderProfile profile,
    required String apiKey,
    String? model,
    double? temperature,
    int? maxTokens,
    bool noReasoning = true,
    http.Client? client,
  }) async* {
    final httpClient = client ?? http.Client();
    final uri = chatUrl(profile.baseUrl, model ?? profile.defaultModel);
    final body = <String, dynamic>{
      'model': model ?? profile.defaultModel,
      'messages': messages,
      'stream': true,
      'temperature': ?temperature,
      'max_tokens': ?maxTokens,
      'reasoning_effort': ?(noReasoning ? noReasoningEffort : null),
    };
    final request = http.Request('POST', uri)
      ..headers['Content-Type'] = 'application/json'
      ..headers['Authorization'] = 'Bearer $apiKey'
      ..body = jsonEncode(body);

    late final http.StreamedResponse response;
    try {
      response = await httpClient.send(request);
    } on Object catch (e) {
      throw AiRequestError('网络请求失败：$e');
    }
    if (response.statusCode != 200) {
      // 错误响应不携带供应商原文，避免敏感内容进入日志与界面
      throw AiRequestError(
        '供应商返回 ${response.statusCode}',
        statusCode: response.statusCode,
      );
    }

    final cleaner = ReasoningResidueCleaner();
    await for (final line in response.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter())) {
      if (!line.startsWith('data:')) continue;
      final payload = line.substring('data:'.length).trim();
      final delta = parseDelta(payload);
      if (delta == null || delta.isEmpty) continue;
      final cleaned = cleaner.accept(delta);
      if (cleaned.isNotEmpty) {
        yield cleaned;
      }
    }
    final tail = cleaner.flush();
    if (tail.isNotEmpty) yield tail;
    if (client == null) httpClient.close();
  }

  /// 解析 SSE `data:` 行中的 delta 文本；非文本分片返回 null
  static String? parseDelta(String payload) {
    try {
      final json = jsonDecode(payload) as Map<String, dynamic>;
      final choices = json['choices'] as List<dynamic>?;
      if (choices == null || choices.isEmpty) return null;
      final first = choices.first as Map<String, dynamic>;
      final delta = first['delta'] as Map<String, dynamic>?;
      final content = delta?['content'];
      if (content is String) return content;
      return null;
    } on Object {
      return null;
    }
  }
}

/// 清洗 `<think>` / `<analysis>` 残留
///
/// 增量清洗：跨分片被切断的标签也能正确识别。
class ReasoningResidueCleaner {
  static const _openTags = ['<think>', '<analysis>'];
  static const _closeTags = ['</think>', '</analysis>'];

  bool _inside = false;
  String _pending = '';

  /// 送入增量文本，返回应展示的文本
  String accept(String delta) {
    _pending += delta;
    final out = StringBuffer();
    while (true) {
      if (_inside) {
        final close = _firstTag(_pending, _closeTags);
        if (close == null) {
          // 只保留可能是关闭标签前缀的尾巴，其余（思考内容）不展示
          _pending = _keepPossibleTagTail(_pending, _closeTags);
          break;
        }
        _pending = _pending.substring(close.$1 + close.$2.length);
        _inside = false;
        continue;
      }
      final open = _firstTag(_pending, _openTags);
      if (open == null) {
        final safe = _dropPossibleTagTail(_pending, _openTags);
        out.write(safe);
        _pending = _pending.substring(safe.length);
        break;
      }
      out.write(_pending.substring(0, open.$1));
      _pending = _pending.substring(open.$1);
      _inside = true;
    }
    return out.toString();
  }

  /// 结束时冲刷残留（仍在思考中的内容不展示）
  String flush() {
    final rest = _pending;
    _pending = '';
    return _inside ? '' : rest;
  }

  /// 首个出现的标签：返回（下标, 标签）
  static (int, String)? _firstTag(String text, List<String> tags) {
    int? bestIndex;
    String? bestTag;
    for (final tag in tags) {
      final index = text.indexOf(tag);
      if (index >= 0 && (bestIndex == null || index < bestIndex)) {
        bestIndex = index;
        bestTag = tag;
      }
    }
    if (bestIndex == null) return null;
    return (bestIndex, bestTag!);
  }

  /// 去掉可能是标签前缀的尾巴，返回可安全展示的前缀
  static String _dropPossibleTagTail(String text, List<String> tags) {
    final keep = _possibleTailLength(text, tags);
    if (keep == 0) return text;
    final keepFrom = text.length - keep;
    return keepFrom > 0 ? text.substring(0, keepFrom) : '';
  }

  /// 只保留可能是标签前缀的尾巴
  static String _keepPossibleTagTail(String text, List<String> tags) {
    final keep = _possibleTailLength(text, tags);
    if (keep == 0) return '';
    return text.substring(text.length - keep);
  }

  static int _possibleTailLength(String text, List<String> tags) {
    var keep = 0;
    for (final tag in tags) {
      final maxOverlap =
          tag.length - 1 < text.length ? tag.length - 1 : text.length;
      for (var n = maxOverlap; n > 0; n--) {
        if (text.endsWith(tag.substring(0, n))) {
          if (n > keep) keep = n;
          break;
        }
      }
    }
    return keep;
  }
}
