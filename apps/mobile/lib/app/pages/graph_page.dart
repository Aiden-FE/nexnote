// 只读图谱——MOB-005
//
// 圆形布局浏览双链关系；点击节点跳转页面。只读浏览，不做编辑与布局持久化。
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../reader/link_graph.dart';
import '../app_services.dart';
import 'page_reader_page.dart';

class GraphPage extends StatefulWidget {
  const GraphPage({super.key});

  @override
  State<GraphPage> createState() => _GraphPageState();
}

class _GraphPageState extends State<GraphPage> {
  late final LinkGraph _graph;
  late final List<String> _nodes;
  late final Map<String, Offset> _positions;
  String? _selected;

  @override
  void initState() {
    super.initState();
    _graph = LinkGraph.build(appServices.vaultRepository);
    _nodes = _graph.pages.map((p) => p.path).toList()..sort();
    _positions = _layout();
  }

  Map<String, Offset> _layout() {
    // 圆形布局：度数高的节点放外圈上方，其余均匀分布
    final center = const Offset(0.5, 0.48);
    final radius = 0.36;
    final degree = <String, int>{};
    final adjacency = _graph.adjacency();
    for (final node in _nodes) {
      degree[node] = adjacency[node]?.length ?? 0;
    }
    final sorted = [..._nodes]..sort((a, b) => (degree[b] ?? 0).compareTo(degree[a] ?? 0));
    final positions = <String, Offset>{};
    for (var i = 0; i < sorted.length; i++) {
      final angle = -math.pi / 2 + 2 * math.pi * i / sorted.length;
      positions[sorted[i]] = Offset(
        center.dx + radius * math.cos(angle),
        center.dy + radius * math.sin(angle),
      );
    }
    return positions;
  }

  String _titleOf(String path) {
    for (final page in _graph.pages) {
      if (page.path == path) return page.title;
    }
    return path;
  }

  void _openPage(String path) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => PageReaderPage(path: path)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('图谱'),
        actions: [
          if (_selected != null)
            TextButton(
              onPressed: () => _openPage(_selected!),
              child: Text(_titleOf(_selected!), overflow: TextOverflow.ellipsis),
            ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final size = Size(constraints.maxWidth, constraints.maxHeight);
          return GestureDetector(
            onTapUp: (details) {
              final tap = details.localPosition;
              String? hit;
              var best = double.infinity;
              for (final entry in _positions.entries) {
                final pos = Offset(
                  entry.value.dx * size.width,
                  entry.value.dy * size.height,
                );
                final distance = (tap - pos).distance;
                if (distance < 36 && distance < best) {
                  best = distance;
                  hit = entry.key;
                }
              }
              setState(() => _selected = hit);
            },
            child: CustomPaint(
              size: size,
              painter: _GraphPainter(
                graph: _graph,
                positions: _positions,
                selected: _selected,
                titleOf: _titleOf,
              ),
            ),
          );
        },
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Text(
            '节点 ${_nodes.length} · 边 ${_graph.edges.length} ·'
            ' 未解析 ${_graph.unresolved.length}（点击节点查看，只读浏览）',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ),
    );
  }
}

class _GraphPainter extends CustomPainter {
  final LinkGraph graph;
  final Map<String, Offset> positions;
  final String? selected;
  final String Function(String path) titleOf;

  _GraphPainter({
    required this.graph,
    required this.positions,
    required this.selected,
    required this.titleOf,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final edgePaint = Paint()
      ..color = Colors.grey.withValues(alpha: 0.5)
      ..strokeWidth = 1.2;

    // 边
    for (final edge in graph.edges) {
      final from = positions[edge.fromPath];
      final to = positions[edge.toPath];
      if (from == null || to == null) continue;
      canvas.drawLine(
        Offset(from.dx * size.width, from.dy * size.height),
        Offset(to.dx * size.width, to.dy * size.height),
        edgePaint,
      );
    }

    // 节点
    for (final entry in positions.entries) {
      final pos = Offset(entry.value.dx * size.width, entry.value.dy * size.height);
      final isSelected = entry.key == selected;
      final degree = graph.adjacency()[entry.key]?.length ?? 0;
      final radius = 8.0 + degree * 2.0;
      final paint = Paint()
        ..color = isSelected
            ? Colors.deepPurple
            : Colors.deepPurple.withValues(alpha: 0.55);
      canvas.drawCircle(pos, radius, paint);
      final tp = TextPainter(
        text: TextSpan(
          text: titleOf(entry.key),
          style: TextStyle(
            fontSize: 11,
            color: isSelected ? Colors.deepPurple : Colors.black87,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w400,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: 120);
      tp.paint(canvas, pos.translate(-tp.width / 2, radius + 4));
    }
  }

  @override
  bool shouldRepaint(covariant _GraphPainter oldDelegate) =>
      oldDelegate.selected != selected;
}
