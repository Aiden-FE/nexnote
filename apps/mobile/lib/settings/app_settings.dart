// 应用设置——存于 App Support（不进入知识库，不随 Git 同步）
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

/// 应用级设置
class AppSettings {
  /// 快速捕获默认落点目录（知识库内相对路径）
  String captureDirectory;

  /// 自动同步间隔（秒）
  int autoSyncSeconds;

  /// 界面语言覆盖：null = 跟随系统，'zh' / 'en' = 强制（ADR-0024 可覆盖）。
  String? languageOverride;

  AppSettings({
    this.captureDirectory = 'Inbox',
    this.autoSyncSeconds = 300,
    this.languageOverride,
  });

  Map<String, dynamic> toJson() => {
        'captureDirectory': captureDirectory,
        'autoSyncSeconds': autoSyncSeconds,
        if (languageOverride != null) 'languageOverride': languageOverride,
      };

  static AppSettings fromJson(Map<String, dynamic> json) => AppSettings(
        captureDirectory: json['captureDirectory'] as String? ?? 'Inbox',
        autoSyncSeconds: json['autoSyncSeconds'] as int? ?? 300,
        languageOverride: _languageFromJson(json['languageOverride']),
      );

  static String? _languageFromJson(Object? value) {
    return switch (value) {
      final String s when s == 'zh' || s == 'en' => s,
      _ => null,
    };
  }
}

/// 设置读写
class SettingsStore {
  final File file;
  AppSettings? _cache;

  SettingsStore({required Directory appSupport})
      : file = File(p.join(appSupport.path, 'nexnote-settings.json'));

  AppSettings load() {
    final existing = _cache;
    if (existing != null) return existing;
    if (!file.existsSync()) return AppSettings();
    try {
      final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      return _cache = AppSettings.fromJson(json);
    } on Object {
      // 设置损坏时回退默认值，不阻塞启动
      return AppSettings();
    }
  }

  void save(AppSettings settings) {
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert(settings.toJson()),
    );
    _cache = settings;
  }
}
