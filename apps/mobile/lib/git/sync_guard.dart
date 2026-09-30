// 同步护栏——与桌面端意图一致：设备运行时产物与 OS 垃圾不进入版本库
library;

/// 同步护栏判定
abstract final class SyncGuard {
  /// 是否属于被护栏拒绝的路径
  static bool isGuarded(String path) {
    if (path.isEmpty) return true;
    if (path == '.DS_Store' || path.endsWith('/.DS_Store')) return true;
    if (path == 'Thumbs.db' || path.endsWith('/Thumbs.db')) return true;
    if (path == 'desktop.ini' || path.endsWith('/desktop.ini')) return true;
    if (path == '.nexnote' || path.startsWith('.nexnote/')) return true;
    return false;
  }

  /// 过滤出允许进入版本库的路径
  static List<String> allowed(List<String> paths) =>
      paths.where((p) => !isGuarded(p)).toList(growable: false);
}
