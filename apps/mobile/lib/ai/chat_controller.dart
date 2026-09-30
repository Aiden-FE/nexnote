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

/// 一条对话消息
class ChatMessage {
  final ChatRole role;
  String content;
  final List<Citation> citations;
  bool streaming;
  String? error;

  ChatMessage({
    required this.role,
    required this.content,
    this.citations = const [],
    this.streaming = false,
    this.error,
  });
}

/// 对话控制器
class ChatController extends ChangeNotifier {
  final List<ChatMessage> messages = [];
  final Retrieval retrieval;
  final ProviderProfileStore profiles;

  bool sending = false;
  String? lastError;

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
      lastError = '未配置供应商 Profile，请先在设置中配置';
      notifyListeners();
      return;
    }
    final apiKey = await profiles.keyFor(profile);
    if (apiKey == null || apiKey.isEmpty) {
      lastError = '该 Profile 未配置 API Key';
      notifyListeners();
      return;
    }

    sending = true;
    lastError = null;
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
      reply.error = e.message;
      lastError = e.message;
    } on Object catch (e) {
      reply.error = e.toString();
      lastError = e.toString();
    } finally {
      reply.streaming = false;
      sending = false;
      notifyListeners();
    }
  }

  void clear() {
    messages.clear();
    lastError = null;
    notifyListeners();
  }
}
