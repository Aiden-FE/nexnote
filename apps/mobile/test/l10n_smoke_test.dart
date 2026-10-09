import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/app/app_services.dart';
import 'package:nexnote_mobile/app/home_shell.dart';
import 'package:nexnote_mobile/app/pages/settings_page.dart';
import 'package:nexnote_mobile/l10n/app_localizations.dart';

Widget testApp(Locale locale, {Widget? home}) => MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      locale: locale,
      home: home ?? const HomeShell(),
    );

void main() {
  late Directory tmp;
  late AppLocalizations zh;
  late AppLocalizations en;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-l10n-test');
    appServices.dispose();
    await appServices.bootstrap(appSupportOverride: tmp);
    zh = await AppLocalizations.delegate.load(const Locale('zh'));
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  tearDown(() {
    appServices.dispose();
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  testWidgets('中文环境底部导航显示中文标签', (tester) async {
    await tester.pumpWidget(testApp(const Locale('zh')));
    await tester.pumpAndSettle();
    expect(find.text(zh.navVault), findsWidgets);
    expect(find.text(zh.navSearch), findsOneWidget);
    expect(find.text(zh.navCapture), findsOneWidget);
    expect(find.text(zh.navSettings), findsOneWidget);
  });

  testWidgets('英文环境底部导航显示英文标签', (tester) async {
    await tester.pumpWidget(testApp(const Locale('en')));
    await tester.pumpAndSettle();
    expect(find.text(en.navVault), findsWidgets);
    expect(find.text(en.navSearch), findsOneWidget);
    expect(find.text(en.navCapture), findsOneWidget);
    expect(find.text(en.navSettings), findsOneWidget);
  });

  testWidgets('设置页按语言覆盖渲染对应标签', (tester) async {
    await tester.pumpWidget(
      testApp(const Locale('zh'), home: const SettingsPage()),
    );
    await tester.pumpAndSettle();
    expect(find.text(zh.settingsLanguage), findsOneWidget);
    expect(find.text(zh.settingsLanguageSystem), findsOneWidget);

    await tester.pumpWidget(
      testApp(const Locale('en'), home: const SettingsPage()),
    );
    await tester.pumpAndSettle();
    expect(find.text(en.settingsLanguage), findsOneWidget);
    expect(find.text(en.settingsLanguageSystem), findsOneWidget);
  });

  testWidgets('语言切换持久化到设置并可恢复跟随系统', (tester) async {
    appServices.setLanguageOverride(const Locale('en'));
    expect(appServices.localeOverride.value, const Locale('en'));
    expect(appServices.settings.languageOverride, 'en');

    appServices.setLanguageOverride(null);
    expect(appServices.localeOverride.value, isNull);
    expect(appServices.settings.languageOverride, isNull);

    // 设置文件里不应残留 languageOverride 字段
    final raw = appServices.settingsStore.file.readAsStringSync();
    expect(raw.contains('languageOverride'), isFalse);
  });

  testWidgets('设置页切换语言会写入 localeOverride', (tester) async {
    await tester.pumpWidget(
      testApp(const Locale('zh'), home: const SettingsPage()),
    );
    await tester.pumpAndSettle();
    expect(appServices.localeOverride.value, isNull);

    await tester.tap(find.text(zh.settingsLanguageEn));
    await tester.pumpAndSettle();
    expect(appServices.localeOverride.value, const Locale('en'));
    expect(appServices.settings.languageOverride, 'en');
  });
}
