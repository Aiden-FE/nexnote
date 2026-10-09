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

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('nexnote-l10n-test');
    appServices.dispose();
    await appServices.bootstrap(appSupportOverride: tmp);
  });

  tearDown(() {
    appServices.dispose();
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  testWidgets('中文环境底部导航显示中文标签', (tester) async {
    await tester.pumpWidget(testApp(const Locale('zh')));
    await tester.pumpAndSettle();
    expect(find.text('库'), findsWidgets);
    expect(find.text('搜索'), findsOneWidget);
    expect(find.text('捕获'), findsOneWidget);
    expect(find.text('设置'), findsOneWidget);
  });

  testWidgets('英文环境底部导航显示英文标签', (tester) async {
    await tester.pumpWidget(testApp(const Locale('en')));
    await tester.pumpAndSettle();
    expect(find.text('Vault'), findsWidgets);
    expect(find.text('Search'), findsOneWidget);
    expect(find.text('Capture'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
  });

  testWidgets('设置页按语言覆盖渲染对应标签', (tester) async {
    await tester.pumpWidget(
      testApp(const Locale('zh'), home: const SettingsPage()),
    );
    await tester.pumpAndSettle();
    expect(find.text('界面语言'), findsOneWidget);
    expect(find.text('跟随系统'), findsOneWidget);

    await tester.pumpWidget(
      testApp(const Locale('en'), home: const SettingsPage()),
    );
    await tester.pumpAndSettle();
    expect(find.text('Interface language'), findsOneWidget);
    expect(find.text('Match system'), findsOneWidget);
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

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(appServices.localeOverride.value, const Locale('en'));
    expect(appServices.settings.languageOverride, 'en');
  });
}
