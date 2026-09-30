import 'package:flutter/material.dart';

/// AI——MOB-010（只读对话 + Keychain 密钥）实现时启用
class AiPage extends StatelessWidget {
  const AiPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AI')),
      body: const Center(
        child: Text('AI 只读对话待 MOB-010 启用'),
      ),
    );
  }
}
