// 只读 AI 对话——MOB-010
//
// 显式触发（用户发送）才发起请求；会话固定只读，不提供任何编辑类动作。
import 'package:flutter/material.dart';

import '../../ai/chat_controller.dart';
import '../../ai/retrieval.dart';
import '../app_services.dart';
import 'page_reader_page.dart';

class AiPage extends StatefulWidget {
  const AiPage({super.key});

  @override
  State<AiPage> createState() => _AiPageState();
}

class _AiPageState extends State<AiPage> {
  final _input = TextEditingController();
  ChatController? _controller;

  @override
  void initState() {
    super.initState();
    _controller = appServices.chat;
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller!;
    final profile = controller.activeProfile();
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI 对话'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: '清空',
            onPressed: controller.messages.isEmpty ? null : controller.clear,
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                const Icon(Icons.lock_outline, size: 14),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    profile == null
                        ? '未配置供应商 Profile（只读对话）'
                        : '只读对话 · ${profile.name} · ${profile.defaultModel}',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: controller.messages.isEmpty
                ? const Center(
                    child: Text('提问会先做两阶段召回（关键词 + 双链扩展）'),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: controller.messages.length,
                    itemBuilder: (context, index) {
                      final message = controller.messages[index];
                      return _MessageBubble(
                        message: message,
                        onOpenSource: (path) => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => PageReaderPage(path: path),
                          ),
                        ),
                      );
                    },
                  ),
          ),
          if (controller.lastError != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                controller.lastError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        hintText: '问点什么…',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: controller.sending
                        ? null
                        : () async {
                            final text = _input.text;
                            _input.clear();
                            await controller.send(text);
                          },
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final void Function(String path) onOpenSource;

  const _MessageBubble({required this.message, required this.onOpenSource});

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == ChatRole.user;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.86,
        ),
        decoration: BoxDecoration(
          color: isUser
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (message.error != null)
              Text(
                message.error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              )
            else
              SelectableText(message.content.isEmpty && message.streaming
                  ? '思考中…'
                  : message.content),
            if (message.citations.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  for (final citation in message.citations)
                    ActionChip(
                      label: Text('${citation.title} · ${citation.stage.label}'),
                      onPressed: () => onOpenSource(citation.path),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
