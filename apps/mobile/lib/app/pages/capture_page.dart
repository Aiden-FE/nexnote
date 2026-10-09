// 快速捕获页面——MOB-009
import 'package:flutter/material.dart';

import '../../capture/quick_capture.dart';
import '../app_services.dart';
import 'page_reader_page.dart';
import '../../l10n/app_localizations.dart';

/// 把捕获错误码翻译为当前界面语言。
String describeCaptureError(AppLocalizations l10n, CaptureErrorCode code) {
  switch (code) {
    case CaptureErrorCode.empty:
      return l10n.captureEmpty;
  }
}

/// 捕获标题：缺省标题本地化，其余用实际标题。
String displayCaptureTitle(AppLocalizations l10n, CaptureResult result) {
  return result.generatedTitle ? l10n.captureUntitled : result.title;
}

class CapturePage extends StatefulWidget {
  const CapturePage({super.key});

  @override
  State<CapturePage> createState() => _CapturePageState();
}

class _CapturePageState extends State<CapturePage> {
  final _controller = TextEditingController();
  String? _error;
  String? _lastCapturedPath;
  bool _saving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _capture() {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = appServices.capture.capture(
        _controller.text,
        captureDirectory: appServices.settings.captureDirectory,
      );
      setState(() {
        _lastCapturedPath = result.path;
        _controller.clear();
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppLocalizations.of(context)!.captureSuccess(
              displayCaptureTitle(AppLocalizations.of(context)!, result),
            ),
          ),
        ),
      );
    } on CaptureError catch (e) {
      setState(() {
        _error = describeCaptureError(AppLocalizations.of(context)!, e.code);
        _saving = false;
      });
    } on Object catch (e) {
      setState(() {
        _error = '$e';
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final directory = appServices.settings.captureDirectory;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.captureTitle)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                const Icon(Icons.folder_outlined, size: 16),
                const SizedBox(width: 4),
                Text(l10n.captureDirectory(directory),
                    style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _controller,
              maxLines: 8,
              textInputAction: TextInputAction.newline,
              decoration: InputDecoration(
                hintText: l10n.captureHint,
                border: const OutlineInputBorder(),
                errorText: _error,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                FilledButton.icon(
                  onPressed: _saving ? null : _capture,
                  icon: const Icon(Icons.add),
                  label: Text(l10n.captureAction),
                ),
                const Spacer(),
                if (_lastCapturedPath != null)
                  TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => PageReaderPage(path: _lastCapturedPath!),
                      ),
                    ),
                    child: Text(l10n.captureOpenLast),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (_lastCapturedPath != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                _lastCapturedPath!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }
}
