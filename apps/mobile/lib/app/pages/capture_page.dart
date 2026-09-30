import 'package:flutter/material.dart';

/// 捕获——MOB-009（快速捕获 + 捕获目录）实现时启用
class CapturePage extends StatelessWidget {
  const CapturePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('捕获')),
      body: const Center(
        child: Text('快速捕获待 MOB-009 启用'),
      ),
    );
  }
}
