import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/editor/block_model.dart';

void main() {
  group('往返保真（未编辑）', () {
    test('覆盖全部可编辑块类型与不支持结构的语料逐字节一致', () {
      const corpus = '# 一级标题\n'
          '\n'
          '段落内容，包含 [[双链]] 与行内 `代码`。\n'
          '\n'
          '## 二级标题\n'
          '\n'
          '- 无序项一\n'
          '- 无序项二\n'
          '\n'
          '1. 有序一\n'
          '2. 有序二\n'
          '\n'
          '- [ ] 待办未完成\n'
          '- [x] 待办已完成\n'
          '\n'
          '> 引用内容\n'
          '\n'
          '```dart\n'
          "void main() {\n"
          "  print('代码块');\n"
          '}\n'
          '```\n'
          '\n'
          '| 块类型 | 状态 | 说明 |\n'
          '| --- | --- | --- |\n'
          '| 表格 | 只读 | 占位 |\n'
          '\n'
          r'$$' '\n'
          '\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n'
          r'$$' '\n'
          '\n'
          '![示意图](assets/demo.png)\n';
      final doc = parseBlocks(corpus);
      expect(doc.serialize(), equals(corpus));
    });

    test('连续空行与行尾空格保持不变', () {
      const corpus = '第一段   \n\n\n\n第二段\t\n';
      expect(parseBlocks(corpus).serialize(), equals(corpus));
    });

    test('CRLF 正文归一化后往返一致', () {
      const corpus = '# 标题\r\n\r\n段落\r\n';
      final doc = parseBlocks(corpus);
      expect(doc.serialize(), equals(corpus));
    });

    test('代码块内的 # 与 | 不被当作结构', () {
      const corpus = '```md\n# 不是标题\n| 不是表格 |\n```\n';
      final doc = parseBlocks(corpus);
      expect(doc.blocks.where((b) => b.type == BlockType.code), hasLength(1));
      expect(doc.serialize(), equals(corpus));
    });

    test('双链出现在标题/表格/代码块内不破坏结构', () {
      const corpus = '# 标题含 [[链接]]\n'
          '\n'
          '```text\n'
          '[[代码块内链接]]\n'
          '```\n'
          '\n'
          '| 链接 | [[表格内链接]] |\n'
          '| --- | --- |\n';
      final doc = parseBlocks(corpus);
      expect(doc.serialize(), equals(corpus));
      expect(doc.blocks.any((b) => b.type == BlockType.table), isTrue);
    });

    test('大页面往返一致', () {
      final buffer = StringBuffer();
      for (var i = 0; i < 300; i++) {
        buffer
          ..writeln('## 章节 $i')
          ..writeln()
          ..writeln('段落 $i，含 [[链接$i]] 与关键词。')
          ..writeln()
          ..writeln('- 项 $i')
          ..writeln();
      }
      final corpus = buffer.toString();
      expect(parseBlocks(corpus).serialize(), equals(corpus));
    });
  });

  group('类型判定', () {
    test('可编辑块类型识别', () {
      final doc = parseBlocks(
          '# 标题\n\n段落\n\n- 项\n1. 项\n- [x] 项\n> 引用\n```js\ncode\n```\n![a](b.png)\n');
      final types = doc.blocks.map((b) => b.type).toSet();
      expect(
        types,
        containsAll([
          BlockType.heading,
          BlockType.paragraph,
          BlockType.unorderedItem,
          BlockType.orderedItem,
          BlockType.taskItem,
          BlockType.quote,
          BlockType.code,
          BlockType.image,
        ]),
      );
    });

    test('不支持结构标记为只读', () {
      final doc = parseBlocks('| a | b |\n| --- | --- |\n\n\$\$\nx\n\$\$\n');
      for (final block in doc.blocks) {
        if (block.type == BlockType.table || block.type == BlockType.math) {
          expect(block.editable, isFalse);
        }
      }
      expect(
        doc.blocks.where((b) => !b.editable).map((b) => b.type).toSet(),
        containsAll([BlockType.table, BlockType.math]),
      );
    });

    test('标题层级与任务勾选被解析', () {
      final doc = parseBlocks('### 三级\n\n- [x] 完成\n- [ ] 未完成\n');
      final heading = doc.blocks.firstWhere((b) => b.type == BlockType.heading);
      expect(heading.level, 3);
      final tasks = doc.blocks.where((b) => b.type == BlockType.taskItem).toList();
      expect(tasks[0].checked, isTrue);
      expect(tasks[1].checked, isFalse);
    });

    test('代码块语言与内容被解析', () {
      final doc = parseBlocks('```python\nprint(1)\n```\n');
      final code = doc.blocks.first;
      expect(code.language, 'python');
      expect(code.content.trim(), 'print(1)');
    });
  });

  group('编辑后重写', () {
    test('只改动的块被重写，其余逐字节保持', () {
      const corpus = '# 标题\n\n原段落\n\n- 原列表项\n';
      final doc = parseBlocks(corpus);
      final paragraph = doc.blocks.firstWhere((b) => b.type == BlockType.paragraph);
      paragraph.content = '新段落';
      final out = doc.serialize();
      expect(out, '# 标题\n\n新段落\n\n- 原列表项\n');
      expect(out, isNot(equals(corpus)));
    });

    test('标题层级变更按新层级输出', () {
      final doc = parseBlocks('# 标题\n');
      final heading = doc.blocks.first;
      heading.level = 3;
      expect(doc.serialize(), '### 标题\n');
    });

    test('任务项勾选状态写回', () {
      final doc = parseBlocks('- [ ] 任务\n');
      final task = doc.blocks.first;
      expect(task.checked, isFalse);
      task.checked = true;
      expect(doc.serialize(), '- [x] 任务\n');
    });

    test('不支持结构不会被重写', () {
      const corpus = '| a | b |\n| --- | --- |\n';
      final doc = parseBlocks(corpus);
      doc.blocks.first.content = '被改了';
      expect(doc.serialize(), equals(corpus));
    });
  });
}
