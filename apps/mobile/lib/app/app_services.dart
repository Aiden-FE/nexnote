// 服务容器：进程内单例，按依赖顺序初始化
library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;

import '../ai/chat_controller.dart';
import '../ai/provider_profile.dart';
import '../ai/retrieval.dart';
import '../ai/secret_vault.dart';
import '../capture/quick_capture.dart';
import '../git/credentials.dart';
import '../git/device_git_service.dart';
import '../index/search_index.dart';
import '../reader/link_graph.dart';
import '../settings/app_settings.dart';
import '../vault/backup_exclusion.dart';
import '../vault/page_writer.dart';
import '../vault/vault_repository.dart';
import '../vault/vault_store.dart';

/// 应用级服务
class AppServices {
  VaultStore? _vaultStore;
  VaultRepository? _vaultRepository;
  DeviceGitService? _gitService;
  SearchIndex? _searchIndex;
  PageWriter? _pageWriter;
  SettingsStore? _settingsStore;
  ProviderProfileStore? _profileStore;
  QuickCapture? _capture;
  ChatController? _chat;

  VaultStore get vaultStore => _vaultStore!;
  VaultRepository get vaultRepository => _vaultRepository!;
  DeviceGitService get gitService => _gitService!;
  SearchIndex get searchIndex => _searchIndex!;
  PageWriter get pageWriter => _pageWriter!;
  SettingsStore get settingsStore => _settingsStore!;
  AppSettings get settings => _settingsStore!.load();
  ProviderProfileStore get profileStore => _profileStore!;
  QuickCapture get capture => _capture!;

  /// 对话控制器（按需创建，依赖最新索引与页面关系）
  ChatController get chat {
    final existing = _chat;
    if (existing != null) return existing;
    final controller = ChatController(
      retrieval: Retrieval(
        index: searchIndex,
        graph: LinkGraph.build(vaultRepository),
      ),
      profiles: profileStore,
    );
    return _chat = controller;
  }

  bool _ready = false;
  bool get ready => _ready;

  /// 知识库内容/结构修订号——克隆、初始化、写入后自增，UI 据此刷新。
  /// dispose 后由下一次 bootstrap 重建。
  ValueNotifier<int>? _vaultRevision;
  ValueNotifier<int> get vaultRevision => _vaultRevision ??= ValueNotifier<int>(0);

  void bumpVaultRevision() => vaultRevision.value++;

  /// 备份排除标记是否已生效（false = 平台未确认，需在设置页提示）
  bool backupExcluded = false;

  /// 初始化服务；[appSupportOverride] 供测试注入临时目录
  Future<void> bootstrap({Directory? appSupportOverride}) async {
    if (_ready) return;
    final store = await VaultStore.open(
      name: 'default',
      appSupportOverride: appSupportOverride,
    );
    final appSupport = Directory(p.dirname(store.rootPath));
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
      onChanged: bumpVaultRevision,
    );
    _settingsStore = SettingsStore(appSupport: appSupport);
    _profileStore = ProviderProfileStore(
      appSupport: appSupport,
      secrets: KeychainSecretVault(),
    );
    _capture = QuickCapture(writer: _pageWriter!);
    rebuildSearchIndex();
    backupExcluded = await store.ensureExcludedFromBackup();
    _ready = true;
  }

  /// 克隆远端知识库。
  ///
  /// 首次启动时应用已在知识库目录内创建运行时产物（`.nexnote/` 搜索索引），
  /// 而 libgit2 要求 clone 目标目录为空，因此这里先关闭并移除运行时产物，
  /// clone 完成后重建索引。
  Future<void> cloneVault({
    required String url,
    required String name,
    required String email,
  }) async {
    final store = _vaultStore!;
    _chat?.dispose();
    _chat = null;
    _searchIndex?.close();
    _searchIndex = null;

    final runtime = Directory(p.join(store.rootPath, '.nexnote'));
    if (runtime.existsSync()) runtime.deleteSync(recursive: true);

    await _gitService!.clone(url: url, name: name, email: email);
    _gitService!.setRemoteOrigin(url);

    final reopened = SearchIndex.open(
      p.join(store.rootPath, '.nexnote', 'search.db'),
    );
    _searchIndex = reopened;
    _pageWriter = PageWriter(
      repository: _vaultRepository!,
      index: reopened,
      git: _gitService!,
      onChanged: bumpVaultRevision,
    );
    // 写入器换了，依赖它的捕获服务必须一起重建，避免持有已关闭的索引
    _capture = QuickCapture(writer: _pageWriter!);
    rebuildSearchIndex();
    bumpVaultRevision();
  }

  /// 全量重建搜索索引（首次打开 / schema 变更 / 手动触发）
  void rebuildSearchIndex() {
    final idx = _searchIndex;
    if (idx == null) return;
    idx.rebuild(_vaultRepository!.readAllPages());
  }

  /// 释放资源（测试与热重启用）
  void dispose() {
    _vaultRevision?.dispose();
    _vaultRevision = null;
    _chat?.dispose();
    _chat = null;
    _searchIndex?.close();
    _searchIndex = null;
    _gitService?.dispose();
    _gitService = null;
    _pageWriter = null;
    _ready = false;
  }
}

/// 进程级服务定位器
final appServices = AppServices();
