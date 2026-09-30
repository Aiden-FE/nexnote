// 服务容器：进程内单例，按依赖顺序初始化
library;

import '../git/credentials.dart';
import '../git/device_git_service.dart';
import '../vault/vault_repository.dart';
import '../vault/vault_store.dart';

/// 应用级服务
class AppServices {
  VaultStore? _vaultStore;
  VaultRepository? _vaultRepository;
  DeviceGitService? _gitService;

  VaultStore get vaultStore => _vaultStore!;
  VaultRepository get vaultRepository => _vaultRepository!;
  DeviceGitService get gitService => _gitService!;

  bool _ready = false;
  bool get ready => _ready;

  Future<void> bootstrap() async {
    if (_ready) return;
    final store = await VaultStore.open(name: 'default');
    final repo = VaultRepository(store);
    final git = await DeviceGitService.open(store, NoCredentialProvider());
    _vaultStore = store;
    _vaultRepository = repo;
    _gitService = git;
    _ready = true;
  }
}

/// 进程级服务定位器
final appServices = AppServices();
