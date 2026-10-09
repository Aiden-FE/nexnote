// 只读 AI 对话控制器——MOB-010
//
// 显式触发（用户发送）才发起请求；会话固定「对话（只读）」——
// 不产生编辑提案、无写回路径。
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'openai_client.dart';
import 'provider_profile.dart';
import 'retrieval.dart';

/// 消息角色
enum ChatRole { user, assistant }

/// 语言中性的对话错误码；由 UI 层翻译为当前界面语言（ADR-0023 错误码化）。
enum ChatErrorCode { noProfile, noApiKey, provider }

/// 一条对话消息
class ChatMessage {
  final ChatRole role;
  String content;
  final List<Citation> citations;
  bool streaming;
  ChatErrorCode? errorCode;
  String? errorDetail;

  ChatMessage({
    required this.role,
    required this.content,
    this.citations = const [],
    this.streaming = false,
    this.errorCode,
    this.errorDetail,
  });
}

/// 对话控制器
class ChatController extends ChangeNotifier {
  final List<ChatMessage> messages = [];
  final Retrieval retrieval;
  final ProviderProfileStore profiles;

  bool sending = false;
  ChatErrorCode? lastErrorCode;
  String? lastErrorDetail;

  ChatController({required this.retrieval, required this.profiles});

  /// 当前选中的 Profile
  ProviderProfile? activeProfile() {
    final all = profiles.list();
    if (all.isEmpty) return null;
    return all.firstWhere(
      (p) => p.hasKey,
      orElse: () => all.first,
    );
  }

  Future<void> send(String question) async {
    final text = question.trim();
    if (text.isEmpty || sending) return;
    final profile = activeProfile();
    if (profile == null) {
      lastErrorCode = ChatErrorCode.noProfile;
      lastErrorDetail = null;
      notifyListeners();
      return;
    }
    final apiKey = await profiles.keyFor(profile);
    if (apiKey == null || apiKey.isEmpty) {
      lastErrorCode = ChatErrorCode.noApiKey;
      lastErrorDetail = null;
      notifyListeners();
      return;
    }

    sending = true;
    lastErrorCode = null;
    lastErrorDetail = null;
    final citations = retrieval.recall(text);
    messages.add(ChatMessage(role: ChatRole.user, content: text));
    final reply = ChatMessage(
      role: ChatRole.assistant,
      content: '',
      citations: citations,
      streaming: true,
    );
    messages.add(reply);
    notifyListeners();

    final context = citations
        .map((c) => '## ${c.title}（${c.stage.label}）\n'
            '${retrieval.contextFor(c.path)}')
        .join('\n\n');
    final prompt = [
      const {
        'role': 'system',
        'content': '你是 NexNote 知识库助手。只依据提供的知识库内容回答；'
            '内容不足时明确说明。只读对话：不要提出对知识库的修改。',
      },
      if (context.isNotEmpty) {'role': 'system', 'content': '知识库内容：\n$context'},
      {'role': 'user', 'content': text},
    ];

    try {
      final client = OpenAiClient(messages: prompt);
      final stream = client.streamChat(
        profile: profile,
        apiKey: apiKey,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
      );
      await for (final delta in stream) {
        reply.content += delta;
        notifyListeners();
      }
    } on AiRequestError catch (e) {
      reply.errorCode = ChatErrorCode.provider;
      reply.errorDetail = e.message;
      lastErrorCode = ChatErrorCode.provider;
      lastErrorDetail = e.message;
    } on Object catch (e) {
      reply.errorCode = ChatErrorCode.provider;
      reply.errorDetail = e.toString();
      lastErrorCode = ChatErrorCode.provider;
      lastErrorDetail = e.toString();
    } finally {
      reply.streaming = false;
      sending = false;
      notifyListeners();
    }
  }

  void clear() {
    messages.clear();
    lastErrorCode = null;
    lastErrorDetail = null;
    notifyListeners();
  }
}
