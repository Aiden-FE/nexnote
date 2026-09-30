// 供应商 Profile 编辑对话框——MOB-010
//
// 密钥只写入 Keychain；配置文件仅保存不透明 account 引用。
import 'package:flutter/material.dart';

import '../../../ai/provider_profile.dart';
import '../../../ai/secret_vault.dart';

/// 新建或编辑 Profile
class AiProfileEditor extends StatefulWidget {
  final ProviderProfile? existing;
  const AiProfileEditor({super.key, this.existing});

  @override
  State<AiProfileEditor> createState() => _AiProfileEditorState();
}

class _AiProfileEditorState extends State<AiProfileEditor> {
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  late final _baseUrl =
      TextEditingController(text: widget.existing?.baseUrl ?? '');
  late final _model =
      TextEditingController(text: widget.existing?.defaultModel ?? '');
  final _apiKey = TextEditingController();
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _baseUrl.dispose();
    _model.dispose();
    _apiKey.dispose();
    super.dispose();
  }

  Future<void> _save(ProviderProfileStore store, SecretVault secrets) async {
    final name = _name.text.trim();
    final baseUrl = _baseUrl.text.trim();
    if (name.isEmpty || baseUrl.isEmpty) {
      setState(() => _error = '名称与 base-url 必填');
      return;
    }
    final profile = ProviderProfile(
      id: widget.existing?.id ??
          'p${DateTime.now().toIso8601String().replaceAll(RegExp(r'[^0-9]'), '')}',
      name: name,
      baseUrl: baseUrl,
      defaultModel: _model.text.trim(),
      temperature: widget.existing?.temperature,
      maxTokens: widget.existing?.maxTokens,
      keyAccount: widget.existing?.keyAccount,
    );
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await store.upsert(profile, _apiKey.text.trim().isEmpty ? null : _apiKey.text.trim());
      if (mounted) Navigator.of(context).pop();
    } on SecretVaultError catch (e) {
      setState(() {
        _error = e.message;
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.existing == null ? '新增 Profile' : '编辑 Profile'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: _name, decoration: const InputDecoration(labelText: '名称')),
            TextField(
              controller: _baseUrl,
              decoration: const InputDecoration(
                labelText: 'base-url',
                hintText: 'https://api.example.com/v1',
              ),
            ),
            TextField(
              controller: _model,
              decoration: const InputDecoration(labelText: '模型名'),
            ),
            TextField(
              controller: _apiKey,
              obscureText: true,
              decoration: InputDecoration(
                labelText: widget.existing?.hasKey == true ? 'API Key（留空则不改动）' : 'API Key',
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: _saving
              ? null
              : () => _save(
                    // 传入的 store/vault 由调用方注入
                    context.findAncestorWidgetOfExactType<_AiProfileEditorScope>()!.store,
                    context.findAncestorWidgetOfExactType<_AiProfileEditorScope>()!.secrets,
                  ),
          child: const Text('保存'),
        ),
      ],
    );
  }
}

/// 为对话框提供 store 与 vault 依赖
class _AiProfileEditorScope extends InheritedWidget {
  final ProviderProfileStore store;
  final SecretVault secrets;

  const _AiProfileEditorScope({
    required this.store,
    required this.secrets,
    required super.child,
  });

  @override
  bool updateShouldNotify(_AiProfileEditorScope oldWidget) =>
      store != oldWidget.store || secrets != oldWidget.secrets;
}

/// 打开编辑对话框
Future<void> showAiProfileEditor(
  BuildContext context, {
  required ProviderProfileStore store,
  required SecretVault secrets,
  ProviderProfile? existing,
}) {
  return showDialog<void>(
    context: context,
    builder: (dialogContext) => _AiProfileEditorScope(
      store: store,
      secrets: secrets,
      child: AiProfileEditor(existing: existing),
    ),
  );
}
