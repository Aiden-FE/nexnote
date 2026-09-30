import 'package:flutter_test/flutter_test.dart';
import 'package:nexnote_mobile/git/sync_guard.dart';

void main() {
  test('设备运行时产物与 OS 垃圾被护栏拒绝', () {
    expect(SyncGuard.isGuarded('.DS_Store'), isTrue);
    expect(SyncGuard.isGuarded('notes/.DS_Store'), isTrue);
    expect(SyncGuard.isGuarded('Thumbs.db'), isTrue);
    expect(SyncGuard.isGuarded('desktop.ini'), isTrue);
    expect(SyncGuard.isGuarded('.nexnote'), isTrue);
    expect(SyncGuard.isGuarded('.nexnote/index.db'), isTrue);
    expect(SyncGuard.isGuarded('.nexnote/metadata/x.json'), isTrue);
    expect(SyncGuard.isGuarded(''), isTrue);
  });

  test('正常页面路径放行', () {
    expect(SyncGuard.isGuarded('index.md'), isFalse);
    expect(SyncGuard.isGuarded('notes/设备端同步.md'), isFalse);
    expect(SyncGuard.isGuarded('.gitignore'), isFalse);
  });

  test('批量过滤保留允许路径', () {
    final allowed = SyncGuard.allowed([
      'index.md',
      '.DS_Store',
      '.nexnote/index.db',
      'notes/a.md',
    ]);
    expect(allowed, equals(['index.md', 'notes/a.md']));
  });
}
