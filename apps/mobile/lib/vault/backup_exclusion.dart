// iCloud 备份排除——MOB-003
//
// 设备知识库位于 App Support，默认会被 iCloud 备份；若被同步到 iCloud Drive，
// 整个 .git 目录会被文件级同步改写（第一轮对齐已否决的路径）。
library;

import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;

import 'vault_store.dart';

/// 备份排除标记通道
abstract final class BackupExclusion {
  static const _channel = MethodChannel('com.nexnote.mobile/backup_exclusion');

  /// 标记目录不参与 iCloud 备份；返回是否成功
  static Future<bool> markExcluded(Directory dir) async {
    try {
      final ok = await _channel.invokeMethod<bool>('markExcluded', {
        'path': dir.path,
      });
      return ok ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  /// 查询目录的排除标记；null 表示平台未返回
  static Future<bool?> isExcluded(Directory dir) async {
    try {
      return await _channel.invokeMethod<bool>('isExcluded', {
        'path': dir.path,
      });
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  /// 确保排除标记存在；标记丢失时重新写入
  ///
  /// 返回 true 表示标记可用。
  static Future<bool> ensure(Directory dir) async {
    final current = await isExcluded(dir);
    if (current == true) return true;
    return markExcluded(dir);
  }
}

/// 知识库根目录上的便利封装
extension VaultBackupGuard on VaultStore {
  /// 确保设备知识库不参与 iCloud 备份
  Future<bool> ensureExcludedFromBackup() async {
    final dir = Directory(p.join(rootPath));
    return BackupExclusion.ensure(dir);
  }
}
