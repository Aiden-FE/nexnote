// 只读 AI 对话——MOB-010
//
// 显式触发（用户发送）才发起请求；会话固定只读，不提供任何编辑类动作。
import 'package:flutter/material.dart';

import '../../ai/chat_controller.dart';
import '../../ai/retrieval.dart';
import '../app_services.dart';
import 'page_reader_page.dart';
import '../../l10n/app_localizations.dart';

/// 把对话错误码翻译为当前界面语言；供应商错误保留其原始细节。
String describeChatError(
  AppLocalizations l10n,
  ChatErrorCode code,
  String? detail,
) {
  switch (code) {
    case ChatErrorCode.noProfile:
      return l10n.errNoProfile;
    case ChatErrorCode.noApiKey:
      return l10n.errNoApiKey;
    case ChatErrorCode.providerNetwork:
      return l10n.errProviderNetwork(detail ?? '');
    case ChatErrorCode.providerHttp:
      return l10n.errProviderHttp(detail ?? '');
    case ChatErrorCode.providerUnexpected:
      return l10n.errProviderUnexpected(detail ?? '');
  }
}

/// 把召回阶段翻译为当前界面语言；system prompt 内的阶段标注不走这里。
String describeRecallStage(AppLocalizations l10n, RecallStage stage) {
  switch (stage) {
    case RecallStage.keyword:
      return l10n.recallKeyword;
    case RecallStage.links:
      return l10n.recallLinks;
  }
}

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
    final l10n = AppLocalizations.of(context)!;
    final controller = _controller!;
    final profile = controller.activeProfile();
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.aiTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: l10n.aiClearTooltip,
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
                        ? l10n.aiNoProfile
                        : l10n.aiReadOnlySession(profile.name, profile.defaultModel),
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: controller.messages.isEmpty
                ? Center(child: Text(l10n.aiEmptyHint))
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
          if (controller.lastErrorCode != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                describeChatError(
                  l10n,
                  controller.lastErrorCode!,
                  controller.lastErrorDetail,
                ),
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
                      decoration: InputDecoration(
                        hintText: l10n.aiInputHint,
                        border: const OutlineInputBorder(),
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
    final l10n = AppLocalizations.of(context)!;
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
            if (message.errorCode != null)
              Text(
                describeChatError(
                  l10n,
                  message.errorCode!,
                  message.errorDetail,
                ),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              )
            else
              SelectableText(message.content.isEmpty && message.streaming
                  ? l10n.aiThinking
                  : message.content),
            if (message.citations.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  for (final citation in message.citations)
                    ActionChip(
                      label: Text(
                        '${citation.title} · ${describeRecallStage(l10n, citation.stage)}',
                      ),
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
