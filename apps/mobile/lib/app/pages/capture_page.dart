// 快速捕获页面——MOB-009
import 'package:flutter/material.dart';

import '../../capture/quick_capture.dart';
import '../app_services.dart';
import 'page_reader_page.dart';

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
        SnackBar(content: Text('已捕获：${result.title}')),
      );
    } on CaptureError catch (e) {
      setState(() {
        _error = e.message;
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
    final directory = appServices.settings.captureDirectory;
    return Scaffold(
      appBar: AppBar(title: const Text('捕获')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                const Icon(Icons.folder_outlined, size: 16),
                const SizedBox(width: 4),
                Text('落点目录：$directory',
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
                hintText: '随手记下想法，首行作为标题',
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
                  label: const Text('捕获'),
                ),
                const Spacer(),
                if (_lastCapturedPath != null)
                  TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => PageReaderPage(path: _lastCapturedPath!),
                      ),
                    ),
                    child: const Text('打开刚捕获的页面'),
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
