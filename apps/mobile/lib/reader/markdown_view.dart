// 只读页面渲染——MOB-005
//
// markdown AST → Flutter 组件；不支持的块以占位呈现，不丢内容。
// 双链渲染为可点链接；标题/列表/引用/代码/表格/图片全部可读。
library;

import 'package:flutter/material.dart';
import 'package:markdown/markdown.dart' as md;

import 'dart:io';

import '../vault/link_extractor.dart';

/// 只读 Markdown 视图
class MarkdownView extends StatelessWidget {
  final String markdown;

  /// 双链点击回调（target 为链接目标）
  final void Function(String target)? onWikiLink;

  /// 图片相对路径解析根（当前页面所在目录）
  final String? imageBaseDir;

  /// 图片解析回调：返回文件路径或 null（不存在）
  final String? Function(String relativePath)? resolveImage;

  const MarkdownView({
    super.key,
    required this.markdown,
    this.onWikiLink,
    this.imageBaseDir,
    this.resolveImage,
  });

  @override
  Widget build(BuildContext context) {
    final document = md.Document(extensionSet: md.ExtensionSet.gitHubWeb);
    final nodes = document.parse(markdown);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final node in nodes)
          _renderBlock(context, node),
      ],
    );
  }

  Widget _renderBlock(BuildContext context, md.Node node) {
    final theme = Theme.of(context);
    if (node is md.Text) {
      final text = node.textContent.trim();
      if (text.isEmpty) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: _inlineText(context, text),
      );
    }
    if (node is md.UnparsedContent) {
      return _codeBlock(context, node.textContent);
    }
    if (node is! md.Element) {
      return const SizedBox.shrink();
    }
    final tag = node.tag;
    switch (tag) {
      case 'h1' || 'h2' || 'h3' || 'h4' || 'h5' || 'h6':
        final level = int.parse(tag.substring(1));
        final scale = switch (level) {
          1 => 1.6,
          2 => 1.35,
          3 => 1.2,
          4 => 1.08,
          _ => 1.0,
        };
        return Padding(
          padding: EdgeInsets.only(
            top: level <= 2 ? 16 : 12,
            bottom: 6,
          ),
          child: Text(
            _plainText(node),
            style: theme.textTheme.titleLarge?.copyWith(
              fontSize: (theme.textTheme.bodyLarge?.fontSize ?? 16) * scale,
              fontWeight: FontWeight.w700,
            ),
          ),
        );
      case 'p':
        final text = _plainText(node);
        final trimmed = text.trim();
        // 独立成段的块级公式 → 数学占位样式（只读）
        if (trimmed.startsWith(r'$$') && trimmed.endsWith(r'$$')) {
          return _mathBlock(context, trimmed);
        }
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text.rich(
            TextSpan(
              children: _inlineSpans(context, node.children),
            ),
          ),
        );
      case 'ul' || 'ol':
        return _list(context, node, ordered: tag == 'ol');
      case 'blockquote':
        return Container(
          margin: const EdgeInsets.symmetric(vertical: 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(
                width: 3,
                color: theme.colorScheme.primary.withValues(alpha: 0.6),
              ),
            ),
            color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final c in node.children ?? const []) _renderBlock(context, c)],
          ),
        );
      case 'pre':
        return _codeBlock(context, _plainText(node));
      case 'table':
        return _table(context, node);
      case 'hr':
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Divider(),
        );
      case 'img':
        return _image(context, node);
      default:
        // 未知块：按正文呈现其内联文本，不丢内容
        final text = _plainText(node).trim();
        if (text.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: _inlineText(context, text),
        );
    }
  }

  Widget _list(BuildContext context, md.Element node, {required bool ordered}) {
    final items = <Widget>[];
    var index = 0;
    for (final child in node.children ?? const <md.Node>[]) {
      if (child is md.Element && child.tag == 'li') {
        index += 1;
        final marker = ordered ? '$index.' : '•';
        items.add(
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 24,
                  child: Text(
                    marker,
                    textAlign: TextAlign.end,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final itemChild in child.children ?? const <md.Node>[])
                        if (itemChild is md.Element && itemChild.tag == 'p')
                          Padding(
                            padding: const EdgeInsets.only(bottom: 2),
                            child: Text.rich(
                              TextSpan(
                                children: _inlineSpans(context, itemChild.children),
                              ),
                            ),
                          )
                        else
                          _renderBlock(context, itemChild),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      }
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: items,
      ),
    );
  }

  Widget _table(BuildContext context, md.Element table) {
    final theme = Theme.of(context);
    final rows = <TableRow>[];
    String cellText(md.Element cell) => _plainText(cell);
    bool isHeader = false;
    for (final section in table.children ?? const <md.Node>[]) {
      if (section is! md.Element) continue;
      isHeader = section.tag == 'thead';
      for (final tr in section.children ?? const <md.Node>[]) {
        if (tr is! md.Element || tr.tag != 'tr') continue;
        final cells = <Widget>[];
        for (final td in tr.children ?? const <md.Node>[]) {
          if (td is! md.Element) continue;
          final text = cellText(td);
          cells.add(
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                text,
                style: isHeader
                    ? theme.textTheme.labelLarge
                        ?.copyWith(fontWeight: FontWeight.w700)
                    : theme.textTheme.bodySmall,
              ),
            ),
          );
        }
        rows.add(TableRow(children: cells));
      }
    }
    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Table(
          border: TableBorder.all(color: theme.dividerColor),
          defaultVerticalAlignment: TableCellVerticalAlignment.middle,
          children: rows,
        ),
      ),
    );
  }

  Widget _codeBlock(BuildContext context, String text) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      width: double.infinity,
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SelectableText(
          text,
          style: const TextStyle(fontFamily: 'Menlo', fontSize: 13, height: 1.5),
        ),
      ),
    );
  }

  Widget _mathBlock(BuildContext context, String text) {
    final theme = Theme.of(context);
    final inner = text.startsWith(r'$$') && text.endsWith(r'$$')
        ? text.substring(2, text.length - 2)
        : text;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      width: double.infinity,
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.functions, size: 14, color: theme.colorScheme.primary),
              const SizedBox(width: 4),
              Text(
                '公式（只读）',
                style: theme.textTheme.labelSmall
                    ?.copyWith(color: theme.colorScheme.primary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          SelectableText(
            inner.trim(),
            style: const TextStyle(fontFamily: 'Menlo', fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _image(BuildContext context, md.Element img) {
    final src = img.attributes['src'] ?? '';
    final alt = img.attributes['alt'] ?? '图片';
    final resolved = src.isEmpty ? null : _resolveImage(src);
    if (resolved == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              const Icon(Icons.image_outlined),
              const SizedBox(width: 8),
              Expanded(child: Text('图片：$alt（$src）')),
            ],
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Image.file(File(resolved)),
    );
  }

  String? _resolveImage(String src) {
    if (!src.startsWith('file://')) {
      if (!src.contains('/')) {
        // 相对路径：相对当前页面目录
        final base = imageBaseDir;
        if (base == null || resolveImage == null) return null;
        return resolveImage!('$base/$src');
      }
      return resolveImage?.call(src);
    }
    return Uri.tryParse(src)?.toFilePath();
  }

  Text _inlineText(BuildContext context, String text) {
    return Text.rich(TextSpan(children: _inlineSpans(context, [md.Text(text)])));
  }

  List<InlineSpan> _inlineSpans(BuildContext? context, List<md.Node>? nodes) {
    final spans = <InlineSpan>[];
    for (final node in nodes ?? const <md.Node>[]) {
      if (node is md.Text) {
        spans.addAll(_splitWikilinks(context, node.textContent));
      } else if (node is md.Element) {
        switch (node.tag) {
          case 'strong':
            spans.addAll(
              _styledSpans(context, node.children, const TextStyle(fontWeight: FontWeight.w700)),
            );
          case 'em':
            spans.addAll(
              _styledSpans(context, node.children, const TextStyle(fontStyle: FontStyle.italic)),
            );
          case 'del':
            spans.addAll(
              _styledSpans(context, node.children, const TextStyle(decoration: TextDecoration.lineThrough)),
            );
          case 'code':
            spans.addAll(
              _styledSpans(
                context,
                node.children,
                const TextStyle(fontFamily: 'Menlo', backgroundColor: Color(0x1A888888)),
              ),
            );
          case 'a':
            final target = node.attributes['data-target'];
            if (target != null) {
              spans.add(
                WidgetSpan(
                  alignment: PlaceholderAlignment.baseline,
                  baseline: TextBaseline.alphabetic,
                  child: GestureDetector(
                    onTap: () => onWikiLink?.call(target),
                    child: Builder(
                      builder: (innerContext) => Text(
                        _plainText(node),
                        style: Theme.of(innerContext).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(innerContext).colorScheme.primary,
                          decoration: TextDecoration.underline,
                        ),
                      ),
                    ),
                  ),
                ),
              );
            } else {
              spans.addAll(_styledSpans(context, node.children, const TextStyle(color: Color(0xFF4C6FFF), decoration: TextDecoration.underline)));
            }
          case 'br':
            spans.add(const TextSpan(text: '\n'));
          case 'img':
            final alt = node.attributes['alt'] ?? '';
            spans.add(TextSpan(text: alt.isEmpty ? '[图片]' : '[图片:$alt]'));
          default:
            spans.addAll(_inlineSpans(context, node.children));
        }
      }
    }
    return spans;
  }

  List<InlineSpan> _styledSpans(
    BuildContext? context,
    List<md.Node>? nodes,
    TextStyle style,
  ) {
    final inner = _inlineSpans(context, nodes);
    return [
      for (final span in inner)
        span is TextSpan
            ? TextSpan(
                text: span.text,
                children: span.children,
                style: span.style == null ? style : span.style!.merge(style),
                recognizer: span.recognizer,
              )
            : span,
    ];
  }

  /// 把纯文本中的双链拆为可点 span
  List<InlineSpan> _splitWikilinks(BuildContext? context, String text) {
    final links = extractWikiLinks(text);
    if (links.isEmpty) {
      return [TextSpan(text: text)];
    }
    final spans = <InlineSpan>[];
    var cursor = 0;
    for (final link in links) {
      if (link.offset > cursor) {
        spans.add(TextSpan(text: text.substring(cursor, link.offset)));
      }
      final label = (link.alias != null && link.alias!.isNotEmpty)
          ? link.alias!
          : link.target;
      spans.add(
        WidgetSpan(
          alignment: PlaceholderAlignment.baseline,
          baseline: TextBaseline.alphabetic,
          child: Builder(
            builder: (innerContext) => GestureDetector(
              onTap: () => onWikiLink?.call(link.target),
              child: Text(
                label,
                style: Theme.of(innerContext).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(innerContext).colorScheme.primary,
                  decoration: TextDecoration.underline,
                ),
              ),
            ),
          ),
        ),
      );
      cursor = link.offset + link.raw.length;
    }
    if (cursor < text.length) {
      spans.add(TextSpan(text: text.substring(cursor)));
    }
    return spans;
  }

  static String _plainText(md.Element node) {
    final buffer = StringBuffer();
    void visit(md.Node? n) {
      if (n is md.Text) {
        buffer.write(n.textContent);
      } else if (n is md.UnparsedContent) {
        buffer.write(n.textContent);
      } else if (n is md.Element) {
        for (final c in n.children ?? const <md.Node>[]) {
          visit(c);
        }
      }
    }

    for (final c in node.children ?? const <md.Node>[]) {
      visit(c);
    }
    return buffer.toString();
  }
}
