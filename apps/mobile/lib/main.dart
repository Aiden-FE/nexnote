import 'package:flutter/material.dart';

import 'app/app_services.dart';
import 'app/home_shell.dart';
import 'l10n/app_localizations.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await appServices.bootstrap();
  runApp(const NexNoteMobileApp());
}

class NexNoteMobileApp extends StatelessWidget {
  const NexNoteMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: appServices.localeOverride,
      builder: (context, _) => MaterialApp(
        title: 'NexNote',
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        locale: appServices.localeOverride.value,
        theme: ThemeData(
          colorSchemeSeed: const Color(0xFF7C6FF0),
          useMaterial3: true,
          brightness: Brightness.light,
        ),
        darkTheme: ThemeData(
          colorSchemeSeed: const Color(0xFF7C6FF0),
          useMaterial3: true,
          brightness: Brightness.dark,
        ),
        home: const HomeShell(),
      ),
    );
  }
}
