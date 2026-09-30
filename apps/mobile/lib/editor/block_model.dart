// 简化块模型——MOB-007
//
// 设计要点：块保存**原始源文本**（raw），序列化即逐块拼接，
// 因此「未修改的块」在往返中逐字节不变；只有被编辑的块才重写为规范 Markdown。
// 不支持的结构（表格/公式/图表/HTML）按原样保留，块模式只读。
library;

/// 块类型
enum BlockType {
  heading,
  paragraph,
  unorderedItem,
  orderedItem,
  taskItem,
  quote,
  code,
  image,
  table,
  math,
  html,
  blank,
}

/// 块模式只读的类型（只能经源码模式编辑）
const readOnlyBlockTypes = {
  BlockType.table,
  BlockType.math,
  BlockType.html,
};

/// 一个块
class Block {
  final BlockType type;

  /// 原始源文本（含行尾换行），序列化直接拼回
  final String raw;

  late String _content;

  /// 可编辑正文（不含 Markdown 标记）。赋值即标记该块已修改。
  String get content => _content;
  set content(String value) {
    _content = value;
    _dirty = true;
  }

  late int _level;

  /// 标题层级（1-6），仅 heading 有效。赋值即标记该块已修改。
  int get level => _level;
  set level(int value) {
    _level = value;
    _dirty = true;
  }

  /// 代码块语言
  String? language;

  bool? _checked;

  /// 任务项是否勾选。赋值即标记该块已修改。
  bool? get checked => _checked;
  set checked(bool? value) {
    _checked = value;
    _dirty = true;
  }

  /// 有序列表序号
  int? ordinal;

  /// 块是否被编辑过（未编辑则序列化时原样返回 raw，保证逐字节不变）
  bool _dirty = false;
  bool get dirty => _dirty;

  /// 图片目标与替代文本
  String? imageTarget;
  String? imageAlt;

  Block({
    required this.type,
    required this.raw,
    required String content,
    int level = 0,
    this.language,
    bool? checked,
    this.ordinal,
    this.imageTarget,
    this.imageAlt,
  }) {
    _content = content;
    _level = level;
    _checked = checked;
  }

  /// 块模式是否可编辑
  bool get editable => !readOnlyBlockTypes.contains(type);

  /// 序列化：未被编辑时返回原始文本（逐字节保真）
  String serialize({bool force = false}) {
    if (!force && !_dirty) return raw;
    switch (type) {
      case BlockType.heading:
        return '${'#' * level} $content\n';
      case BlockType.paragraph:
        return '$content\n';
      case BlockType.quote:
        return '> $content\n';
      case BlockType.unorderedItem:
        return '- $content\n';
      case BlockType.orderedItem:
        return '${ordinal ?? 1}. $content\n';
      case BlockType.taskItem:
        return '- [${(checked ?? false) ? 'x' : ' '}] $content\n';
      case BlockType.code:
        return '```${language ?? ''}\n$content```\n';
      case BlockType.image:
        return "![${imageAlt ?? ''}](${imageTarget ?? ''})\n";
      default:
        return raw;
    }
  }
}

/// 解析结果
class BlockDocument {
  final List<Block> blocks;

  const BlockDocument(this.blocks);

  /// 序列化回 Markdown（未编辑块逐字节保持）
  String serialize() => blocks.map((b) => b.serialize()).join();
}

/// 行级解析：把正文拆为块
BlockDocument parseBlocks(String body) {
  final lines = body.split('\n');
  final blocks = <Block>[];
  var i = 0;
  while (i < lines.length) {
    final line = lines[i];
    // 最后一行 split 会产出空串：把它当尾部换行处理
    final isLast = i == lines.length - 1;
    if (isLast && line.isEmpty) break;

    // 围栏代码块（含未闭合）
    final fence = RegExp(r'^```(.*)$').firstMatch(line);
    if (fence != null) {
      final language = fence.group(1)!.trim();
      final buffer = StringBuffer('$line\n');
      var j = i + 1;
      final code = StringBuffer();
      while (j < lines.length) {
        buffer.write('${lines[j]}\n');
        if (lines[j].startsWith('```')) break;
        code.write('${lines[j]}\n');
        j++;
      }
      blocks.add(
        Block(
          type: BlockType.code,
          raw: buffer.toString(),
          content: code.toString(),
          language: language.isEmpty ? null : language,
        ),
      );
      i = j + 1;
      continue;
    }

    // 数学块
    if (line.trimLeft().startsWith(r'$$')) {
      final buffer = StringBuffer('$line\n');
      var j = i + 1;
      while (j < lines.length && !lines[j].trimRight().endsWith(r'$$')) {
        buffer.write('${lines[j]}\n');
        j++;
      }
      if (j < lines.length) {
        buffer.write('${lines[j]}\n');
        j++;
      }
      blocks.add(
        Block(type: BlockType.math, raw: buffer.toString(), content: ''),
      );
      i = j;
      continue;
    }

    // 表格（连续以 | 开头的行）
    if (line.trimLeft().startsWith('|')) {
      final buffer = StringBuffer();
      var j = i;
      while (j < lines.length && lines[j].trimLeft().startsWith('|')) {
        buffer.write('${lines[j]}\n');
        j++;
      }
      blocks.add(
        Block(type: BlockType.table, raw: buffer.toString(), content: ''),
      );
      i = j;
      continue;
    }

    // 空行
    if (line.trim().isEmpty) {
      blocks.add(Block(type: BlockType.blank, raw: '$line\n', content: ''));
      i++;
      continue;
    }

    // 标题
    final heading = RegExp(r'^(#{1,6})\s+(.*)$').firstMatch(line);
    if (heading != null) {
      blocks.add(
        Block(
          type: BlockType.heading,
          raw: '$line\n',
          content: heading.group(2)!.trim(),
          level: heading.group(1)!.length,
        ),
      );
      i++;
      continue;
    }

    // 引用
    final quote = RegExp(r'^>\s?(.*)$').firstMatch(line);
    if (quote != null) {
      blocks.add(
        Block(
          type: BlockType.quote,
          raw: '$line\n',
          content: quote.group(1)!.trim(),
        ),
      );
      i++;
      continue;
    }

    // 任务项
    final task = RegExp(r'^([-*+])\s+\[( |x|X)\]\s+(.*)$').firstMatch(line);
    if (task != null) {
      blocks.add(
        Block(
          type: BlockType.taskItem,
          raw: '$line\n',
          content: task.group(3)!.trim(),
          checked: task.group(2)!.toLowerCase() == 'x',
        ),
      );
      i++;
      continue;
    }

    // 无序列表项
    final bullet = RegExp(r'^([-*+])\s+(.*)$').firstMatch(line);
    if (bullet != null) {
      blocks.add(
        Block(
          type: BlockType.unorderedItem,
          raw: '$line\n',
          content: bullet.group(2)!.trim(),
        ),
      );
      i++;
      continue;
    }

    // 有序列表项
    final ordered = RegExp(r'^(\d+)[.)]\s+(.*)$').firstMatch(line);
    if (ordered != null) {
      blocks.add(
        Block(
          type: BlockType.orderedItem,
          raw: '$line\n',
          content: ordered.group(2)!.trim(),
          ordinal: int.tryParse(ordered.group(1)!),
        ),
      );
      i++;
      continue;
    }

    // 图片
    final image = RegExp(r'^!\[(.*?)\]\((.*?)\)\s*$').firstMatch(line);
    if (image != null) {
      blocks.add(
        Block(
          type: BlockType.image,
          raw: '$line\n',
          content: line,
          imageAlt: image.group(1),
          imageTarget: image.group(2),
        ),
      );
      i++;
      continue;
    }

    // HTML 块
    if (RegExp(r'^\s*<[a-zA-Z!/]').hasMatch(line)) {
      final buffer = StringBuffer('$line\n');
      var j = i + 1;
      while (j < lines.length &&
          lines[j].trim().isNotEmpty &&
          !RegExp(r'^(#{1,6})\s+').hasMatch(lines[j])) {
        buffer.write('${lines[j]}\n');
        j++;
      }
      blocks.add(
        Block(type: BlockType.html, raw: buffer.toString(), content: ''),
      );
      i = j;
      continue;
    }

    // 段落（连续非空行）
    final buffer = StringBuffer();
    var j = i;
    while (j < lines.length) {
      final candidate = lines[j];
      if (candidate.trim().isEmpty) break;
      if (j > i && _startsBlock(candidate)) break;
      buffer.write('$candidate\n');
      j++;
    }
    final raw = buffer.toString();
    blocks.add(
      Block(
        type: BlockType.paragraph,
        raw: raw,
        content: raw.trimRight(),
      ),
    );
    i = j;
  }
  return BlockDocument(blocks);
}

bool _startsBlock(String line) {
  return RegExp(r'^(#{1,6})\s+').hasMatch(line) ||
      line.startsWith('```') ||
      line.trimLeft().startsWith('|') ||
      line.trimLeft().startsWith(r'$$') ||
      RegExp(r'^>\s?').hasMatch(line) ||
      RegExp(r'^([-*+])\s+').hasMatch(line) ||
      RegExp(r'^\d+[.)]\s+').hasMatch(line) ||
      RegExp(r'^!\[.*?\]\(.*?\)\s*$').hasMatch(line);
}
