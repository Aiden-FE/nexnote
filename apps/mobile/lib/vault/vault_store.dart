// 设备知识库存储层——MOB-003
//
// 位置：Library/Application Support/<app>/vaults/<name>（不使用 Documents / Caches），
// 并标记排除 iCloud 备份；所有路径操作经统一校验层拒绝逃逸。
library;

import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// 路径校验失败——显式错误，不静默降级
class VaultPathError implements Exception {
  final String message;
  const VaultPathError(this.message);
  @override
  String toString() => 'VaultPathError: $message';
}

/// 设备知识库根目录解析与路径安全
class VaultStore {
  final Directory appSupport;
  final String vaultName;

  VaultStore._(this.appSupport, this.vaultName);

  /// 打开（或构造）一个设备知识库句柄
  static Future<VaultStore> open({
    String name = 'default',
    Directory? appSupportOverride,
  }) async {
    final support = appSupportOverride ?? await getApplicationSupportDirectory();
    final vaultsRoot = Directory(p.join(support.path, 'vaults'));
    await vaultsRoot.create(recursive: true);
    return VaultStore._(support, name);
  }

  /// 设备知识库根目录（不存在时创建）
  Directory get root {
    final dir = Directory(p.join(appSupport.path, 'vaults', vaultName));
    if (!dir.existsSync()) {
      dir.createSync(recursive: true);
    }
    return dir;
  }

  String get rootPath => root.path;

  /// 校验相对路径落在知识库内，且不经过符号链接
  ///
  /// 拒绝 `..`、绝对路径，以及指向库外的符号链接（对齐桌面 safeVaultPath 意图）。
  String resolve(String relative) {
    if (relative.isEmpty) {
      throw const VaultPathError('空路径');
    }
    if (p.isAbsolute(relative)) {
      throw VaultPathError('拒绝绝对路径: $relative');
    }
    final normalized = _normalize(relative);
    if (normalized == null) {
      throw VaultPathError('路径规范化失败: $relative');
    }
    final base = rootPath;
    final candidate = p.join(base, normalized);
    if (!p.isWithin(base, candidate)) {
      throw VaultPathError('路径逃逸: $relative');
    }
    // 逐段检查已存在的组件，拒绝符号链接
    var current = base;
    for (final seg in p.split(normalized)) {
      current = p.join(current, seg);
      if (Link(current).existsSync()) {
        throw VaultPathError('拒绝符号链接: $current');
      }
    }
    return candidate;
  }

  /// 绝对路径 -> 知识库内相对路径
  String relativize(String absolute) {
    final base = rootPath;
    if (!p.isWithin(base, absolute)) {
      throw VaultPathError('不属于当前知识库: $absolute');
    }
    return p.relative(absolute, from: base);
  }

  File file(String relative) => File(resolve(relative));

  Directory directory(String relative) => Directory(resolve(relative));

  /// 枚举全部 Markdown 页面（相对路径，按字典序），跳过 `.nexnote/` 与隐藏文件
  List<String> listMarkdownPages() {
    final result = <String>[];
    for (final entity in root.listSync(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      if (!entity.path.toLowerCase().endsWith('.md')) continue;
      final rel = relativize(entity.path);
      if (rel == '.' || rel.startsWith('.')) continue;
      if (p.split(rel).any((seg) => seg.startsWith('.'))) continue;
      result.add(rel);
    }
    result.sort();
    return result;
  }

  /// 枚举全部可纳入版本库的文件（相对路径）
  ///
  /// 跳过 `.git/`、`.nexnote/` 与 OS 垃圾文件；`.gitignore` 等点文件正常纳入。
  List<String> listTrackableFiles() {
    final result = <String>[];
    const osJunk = {'.DS_Store', 'Thumbs.db', 'desktop.ini'};
    void walk(Directory dir) {
      for (final entity in dir.listSync(followLinks: false)) {
        final name = entity.uri.pathSegments
            .where((s) => s.isNotEmpty)
            .last;
        if (entity is Directory) {
          if (name == '.git' || name == '.nexnote') continue;
          walk(entity);
          continue;
        }
        if (entity is! File) continue;
        if (osJunk.contains(name)) continue;
        result.add(relativize(entity.path));
      }
    }

    walk(root);
    result.sort();
    return result;
  }

  /// 规范化 POSIX 相对路径，拒绝 `..` 逃逸
  static String? _normalize(String input) {
    final out = <String>[];
    for (final seg in input.split('/')) {
      if (seg.isEmpty || seg == '.') continue;
      if (seg == '..') {
        if (out.isEmpty) return null;
        out.removeLast();
        continue;
      }
      out.add(seg);
    }
    return out.isEmpty ? null : out.join('/');
  }
}
