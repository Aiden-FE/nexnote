// 统一写入路径——MOB-004/007
//
// 写盘 → 索引增量更新 → 自动提交调度；冲突禁写在此拦截（ADR-0018）。
library;

import '../core/constants.dart';
import '../git/device_git_service.dart';
import '../index/search_index.dart';
import 'vault_repository.dart';

/// 页面写入入口：所有写操作必须经过这里
class PageWriter {
  final VaultRepository repository;
  final SearchIndex index;
  final DeviceGitService git;

  /// 内容变更回调（供 UI 刷新）
  final void Function()? onChanged;

  const PageWriter({
    required this.repository,
    required this.index,
    required this.git,
    this.onChanged,
  });

  /// 更新页面内容；返回是否发生写入
  bool writePage(String path, String content, {String summary = '保存页面'}) {
    _ensureWritable();
    final changed = repository.writeText(path, content);
    if (!changed) return false;
    index.upsert(repository.readPage(path)!);
    onChanged?.call();
    git.scheduleAutoCommit(summary);
    return true;
  }

  /// 创建页面
  void createPage(String path, String content, {String summary = '创建页面'}) {
    _ensureWritable();
    repository.createPage(path, content);
    index.upsert(repository.readPage(path)!);
    onChanged?.call();
    git.scheduleAutoCommit(summary);
  }

  /// 删除页面
  void deletePage(String path, {String summary = '删除页面'}) {
    _ensureWritable();
    repository.deletePage(path);
    index.remove(path);
    onChanged?.call();
    git.scheduleAutoCommit(summary);
  }

  void _ensureWritable() {
    if (git.blockedByConflict) {
      throw const GitServiceError(
        GitErrorKind.conflict,
        '同步冲突禁写中：请在桌面端解决冲突并同步后重试',
      );
    }
  }
}
