import 'package:flutter/material.dart';

import 'app/app_services.dart';
import 'app/home_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await appServices.bootstrap();
  runApp(const NexNoteMobileApp());
}

class NexNoteMobileApp extends StatelessWidget {
  const NexNoteMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NexNote',
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
    );
  }
}
