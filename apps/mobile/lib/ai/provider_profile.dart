// 供应商 Profile——MOB-010
//
// 属性文件只保存 base-url / 模型名 / 参数与 keyBlob account 引用；
// 密钥字节只进 SecretVault（iOS Keychain）。
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'secret_vault.dart';

/// 供应商 Profile
class ProviderProfile {
  final String id;
  final String name;
  final String baseUrl;
  final String defaultModel;
  double? temperature;
  int? maxTokens;

  /// Keychain account 引用（不含密钥）；为 null 表示未配置密钥
  String? keyAccount;

  ProviderProfile({
    required this.id,
    required this.name,
    required this.baseUrl,
    this.defaultModel = '',
    this.temperature,
    this.maxTokens,
    this.keyAccount,
  }) {
    if (id.isEmpty) {
      throw ArgumentError.value(id, 'id', '不能为空');
    }
  }

  /// 有密钥才算可用（无密钥的 Profile 不能发起请求）
  bool get hasKey => keyAccount != null && keyAccount!.isNotEmpty;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'baseUrl': baseUrl,
        'defaultModel': defaultModel,
        if (temperature != null) 'temperature': temperature,
        if (maxTokens != null) 'maxTokens': maxTokens,
        if (keyAccount != null) 'keyAccount': keyAccount,
      };

  static ProviderProfile fromJson(Map<String, dynamic> json) => ProviderProfile(
        id: json['id'] as String,
        name: json['name'] as String? ?? json['id'] as String,
        baseUrl: json['baseUrl'] as String? ?? '',
        defaultModel: json['defaultModel'] as String? ?? '',
        temperature: (json['temperature'] as num?)?.toDouble(),
        maxTokens: json['maxTokens'] as int?,
        keyAccount: json['keyAccount'] as String?,
      );
}

/// Profile 存储：JSON 文件 + Keychain 引用
class ProviderProfileStore {
  final File file;
  final SecretVault secrets;

  ProviderProfileStore({required Directory appSupport, required this.secrets})
      : file = File(p.join(appSupport.path, 'nexnote-ai.json'));

  List<ProviderProfile>? _cache;

  List<ProviderProfile> list() {
    final existing = _cache;
    if (existing != null) return existing;
    if (!file.existsSync()) return const [];
    final data = jsonDecode(file.readAsStringSync()) as List<dynamic>;
    final profiles =
        data.map((e) => ProviderProfile.fromJson(e as Map<String, dynamic>)).toList();
    _cache = profiles;
    return profiles;
  }

  void save(List<ProviderProfile> profiles) {
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert(
        profiles.map((e) => e.toJson()).toList(),
      ),
    );
    _cache = profiles;
  }

  /// 保存 Profile 并写入密钥；密钥失败时不落盘 Profile（保证一致性）
  Future<void> upsert(ProviderProfile profile, String? apiKey) async {
    if (apiKey != null) {
      if (!profile.hasKey) {
        profile.keyAccount = 'profile-${profile.id}';
      }
      await secrets.write(profile.keyAccount!, apiKey);
    }
    final current = [...list()];
    current.removeWhere((p) => p.id == profile.id);
    current.add(profile);
    save(current);
  }

  /// 读取密钥（不存在返回 null）
  Future<String?> keyFor(ProviderProfile profile) async {
    final account = profile.keyAccount;
    if (account == null) return null;
    return secrets.read(account);
  }

  Future<void> remove(String id) async {
    final target = list().where((p) => p.id == id).toList();
    for (final profile in target) {
      final account = profile.keyAccount;
      if (account != null) {
        await secrets.delete(account);
      }
    }
    save(list().where((p) => p.id != id).toList());
  }
}
