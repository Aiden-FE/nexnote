// 服务容器：进程内单例，按依赖顺序初始化
library;

import '../git/credentials.dart';
import '../git/device_git_service.dart';
import '../index/search_index.dart';
import '../vault/page_writer.dart';
import '../vault/backup_exclusion.dart';
import '../vault/vault_repository.dart';
import '../vault/vault_store.dart';
import 'package:path/path.dart' as p;

/// 应用级服务
class AppServices {
  VaultStore? _vaultStore;
  VaultRepository? _vaultRepository;
  DeviceGitService? _gitService;
  SearchIndex? _searchIndex;
  PageWriter? _pageWriter;

  VaultStore get vaultStore => _vaultStore!;
  VaultRepository get vaultRepository => _vaultRepository!;
  DeviceGitService get gitService => _gitService!;
  SearchIndex get searchIndex => _searchIndex!;
  PageWriter get pageWriter => _pageWriter!;

  bool _ready = false;
  bool get ready => _ready;

  /// 备份排除标记是否已生效（false = 平台未确认，需在设置页提示）
  bool backupExcluded = false;

  Future<void> bootstrap() async {
    if (_ready) return;
    final store = await VaultStore.open(name: 'default');
    final repo = VaultRepository(store);
    final git = await DeviceGitService.open(store, NoCredentialProvider());
    final searchIndex = SearchIndex.open(
      p.join(store.rootPath, '.nexnote', 'search.db'),
    );
    _vaultStore = store;
    _vaultRepository = repo;
    _gitService = git;
    _searchIndex = searchIndex;
    _pageWriter = PageWriter(
      repository: repo,
      index: searchIndex,
      git: git,
    );
    rebuildSearchIndex();
    backupExcluded = await store.ensureExcludedFromBackup();
    _ready = true;
  }

  /// 全量重建搜索索引（首次打开 / schema 变更 / 手动触发）
  void rebuildSearchIndex() {
    final idx = _searchIndex;
    if (idx == null) return;
    idx.rebuild(_vaultRepository!.readAllPages());
  }
}

/// 进程级服务定位器
final appServices = AppServices();
