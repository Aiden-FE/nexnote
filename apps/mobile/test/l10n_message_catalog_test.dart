// 消息目录契约：EN 词典不得含中文残留；跟随系统路径的回退行为锁定。
//
// 对应 ADR-0023 的完成门槛「切到 en-US 后全 UI 无中文残留」在手机端的
// 可执行手段（ADR-0024 Consequences）。
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/l10n/app_localizations.dart';

/// 有意保留中文的 key：语言名称自身、简体中文标签。
const _allowedCjkKeys = {'settingsLanguageZh'};

void main() {
  test('EN 词典不含中文残留（语言名称类除外）', () async {
    final raw = await File('lib/l10n/app_en.arb').readAsString();
    final data = (jsonDecode(raw) as Map<String, dynamic>)
        .entries
        .where((e) => !e.key.startsWith('@') && e.key != '@@locale')
        .toList();
    expect(data, isNotEmpty);

    final cjk = RegExp(r'[一-鿿　-〿＀-￯]');
    final offenders = <String>[];
    for (final entry in data) {
      if (_allowedCjkKeys.contains(entry.key)) continue;
      final text = entry.value.toString();
      if (cjk.hasMatch(text)) offenders.add('${entry.key}: $text');
    }
    expect(offenders, isEmpty,
        reason: 'EN 词典出现中文残留（ADR-0023 完成门槛）：\n${offenders.join('\n')}');
  });

  test('ZH 与 EN 的 key 集合完全一致', () async {
    Future<Set<String>> keysOf(String path) async {
      final data = jsonDecode(await File(path).readAsString())
          as Map<String, dynamic>;
      return data.keys
          .where((k) => !k.startsWith('@') && k != '@@locale')
          .toSet();
    }

    final zh = await keysOf('lib/l10n/app_zh.arb');
    final en = await keysOf('lib/l10n/app_en.arb');
    expect(zh.difference(en), isEmpty, reason: 'ZH 独有 key');
    expect(en.difference(zh), isEmpty, reason: 'EN 独有 key');
  });

  test('未覆盖的系统语言按 supportedLocales 首项回退（en）', () async {
    // flutter test 默认系统 locale 为 en_US；显式模拟一个不受支持的语言，
    // 由 MaterialApp 的 locale 解析按 supportedLocales 首项回退。
    final resolved = await _resolve(Locale('fr'));
    expect(resolved, isNotNull);
    // supportedLocales 首项是 en，故回退结果应为 en-US 词典
    expect(resolved!.navVault, 'Vault');
    expect(resolved.navSettings, 'Settings');
  });

  test('中文 locale 命中 zh 词典，en 命中 en 词典', () async {
    final zh = await _resolve(const Locale('zh'));
    expect(zh!.navVault, '库');
    final en = await _resolve(const Locale('en'));
    expect(en!.navVault, 'Vault');
  });
}

/// 按 MaterialApp 的 locale 解析规则解析实际生效的本地化实例。
Future<AppLocalizations?> _resolve(Locale? systemLocale) async {
  final supported = AppLocalizations.supportedLocales;
  Locale? match;
  for (final locale in supported) {
    if (locale.languageCode == systemLocale?.languageCode) {
      match = locale;
      break;
    }
  }
  match ??= supported.first; // Flutter 默认回退到首项
  return AppLocalizations.delegate.load(match);
}
