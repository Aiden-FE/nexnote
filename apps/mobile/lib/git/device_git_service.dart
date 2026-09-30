// 设备端 Git 服务层——MOB-004
//
// 行为语义对齐桌面 GitService：提交消息前缀、防抖节奏、护栏意图、
// fetch -> rebase -> push 编排；冲突即禁写并回桌面处理（ADR-0018）。
library;

import 'dart:async';
import 'dart:io';

import 'package:git2dart/git2dart.dart';
import 'package:git2dart_binaries/git2dart_binaries.dart'
    show LibGit2Error, git_error_t;
import 'package:path/path.dart' as p;

import '../core/constants.dart';
import '../core/models.dart';
import '../vault/vault_store.dart';
import 'credentials.dart';
import 'git_types.dart';
import 'sync_guard.dart';

/// Git 运算失败（已分类）
class GitServiceError implements Exception {
  final GitErrorKind kind;
  final String message;
  const GitServiceError(this.kind, this.message);
  @override
  String toString() => 'GitServiceError($kind): $message';
}

/// 设备端 Git 服务
class DeviceGitService {
  static bool _libgit2Ready = false;

  final VaultStore vault;
  final CredentialProvider credentials;

  Repository? _repo;

  // 自动提交节奏（对齐桌面 30s 防抖 / 2s 最小间隔）
  Timer? _autoCommitDebounce;
  DateTime _lastAutoCommitAt = DateTime.fromMillisecondsSinceEpoch(0);
  static const _autoCommitDebounceDelay = Duration(seconds: 30);
  static const _autoCommitMinInterval = Duration(seconds: 2);

  // 自动同步节奏（对齐桌面 autoSync 默认 300s）
  Timer? _autoSyncTimer;
  static const _autoSyncInterval = Duration(seconds: 300);
  bool _syncing = false;
  int _backoffMs = 0;

  /// 冲突禁写标志——在成功同步前阻止所有写入
  bool _blockedByConflict = false;

  /// 状态广播
  final _syncStatusController = StreamController<VaultStatus>.broadcast();
  Stream<VaultStatus> get statusStream => _syncStatusController.stream;

  String _identityName = 'NexNote';
  String _identityEmail = 'nexnote@local';

  DeviceGitService._(this.vault, this.credentials);

  /// 打开服务（首次使用时初始化 libgit2 运行时）
  static Future<DeviceGitService> open(
    VaultStore vault,
    CredentialProvider credentials,
  ) async {
    if (!_libgit2Ready) {
      await PlatformSpecific.initialize();
      _libgit2Ready = true;
    }
    return DeviceGitService._(vault, credentials);
  }

  // ————————————————————————————————————— 库生命周期

  /// 仓库是否已初始化
  bool get isRepoInitialized =>
      Directory(p.join(vault.rootPath, '.git')).existsSync();

  /// 仓库句柄（惰性打开）
  Repository get repo {
    final existing = _repo;
    if (existing != null) return existing;
    if (!isRepoInitialized) {
      throw const GitServiceError(GitErrorKind.unknown, '知识库尚未初始化 Git');
    }
    final r = Repository.open(vault.rootPath);
    _repo = r;
    return r;
  }

  /// 丢弃缓存句柄（clone/init 后调用）
  void invalidateRepo() {
    _repo = null;
  }

  /// 初始化仓库并设置身份
  void init({required String name, required String email}) {
    _identityName = name;
    _identityEmail = email;
    final r = Repository.init(path: vault.rootPath, initialHead: 'main');
    _repo = r;
    r.setIdentity(name: name, email: email);
  }

  /// clone 远端到设备知识库目录（要求目录为空或不存在）
  Future<void> clone({
    required String url,
    required String name,
    required String email,
    String? branch,
  }) async {
    final root = Directory(vault.rootPath);
    if (root.existsSync() && root.listSync().isNotEmpty) {
      throw const GitServiceError(
          GitErrorKind.unknown, '知识库目录非空，拒绝 clone');
    }
    _identityName = name;
    _identityEmail = email;
    try {
      final r = Repository.clone(
        url: url,
        localPath: vault.rootPath,
        checkoutBranch: branch,
        callbacks: await _callbacks(url),
      );
      _repo = r;
      r.setIdentity(name: name, email: email);
      _blockedByConflict = false;
    } on Object catch (e) {
      throw _classify(e);
    }
  }

  // ————————————————————————————————————— 状态

  /// 当前分支名（HEAD 不可解析时回退 main）
  String currentBranch(Repository r) {
    try {
      return r.head.shorthand;
    } on Object {
      return 'main';
    }
  }

  /// HEAD 是否指向尚无提交的分支
  bool _isHeadUnborn(Repository r) {
    try {
      r.head;
      return false;
    } on Object {
      return true;
    }
  }

  /// 工作区变更路径（原始，未过滤）
  List<String> changedPaths(Repository r) {
    // libgit2 的聚合 status 不包含未跟踪文件，这里按文件补齐（statusFile 可报 wtNew）
    final out = <String>{};
    out.addAll(r.status.keys);
    for (final rel in vault.listTrackableFiles()) {
      final fileStatus = r.statusFile(rel);
      if (fileStatus.any((s) => s != GitStatus.current)) {
        out.add(rel);
      }
    }
    final list = out.toList()..sort();
    return list;
  }

  /// 仓库是否处于未完成操作（rebase/merge 等）
  bool get inSpecialState => repo.state != GitRepositoryState.none;

  /// 冲突禁写是否生效
  bool get blockedByConflict => _blockedByConflict || inSpecialState;

  /// 全量状态
  VaultStatus status({String? lastSyncMessage}) {
    if (!isRepoInitialized) {
      return VaultStatus(
        initialized: false,
        branch: 'main',
        changed: const [],
        ahead: 0,
        behind: 0,
        conflict: false,
      );
    }
    final r = repo;
    final branch = currentBranch(r);
    final changed = _filterGuarded(changedPaths(r));
    final remoteUrl = _safeRemoteUrl();
    var ahead = 0;
    var behind = 0;
    final upstreamRef = _upstreamRefName(branch);
    if (r.references.contains(upstreamRef)) {
      try {
        final local = r.head.target;
        final upstream = Reference.lookup(repo: r, name: upstreamRef).target;
        final ab = r.aheadBehind(local: local, upstream: upstream);
        ahead = ab.first;
        behind = ab.last;
      } on Object {
        // HEAD 不可解析（unborn）时视为 0/0
      }
    }
    final conflict = blockedByConflict ||
        r.status.values.any((s) => s.contains(GitStatus.conflicted));
    return VaultStatus(
      initialized: true,
      branch: branch,
      changed: changed,
      ahead: ahead,
      behind: behind,
      conflict: conflict,
      remoteUrl: remoteUrl,
      lastSyncMessage: lastSyncMessage,
    );
  }

  void _broadcastStatus([String? message]) {
    if (!_syncStatusController.hasListener) return;
    _syncStatusController.add(status(lastSyncMessage: message));
  }

  // ————————————————————————————————————— 远端

  /// 配置 origin 远端（存在则替换 URL）
  void setRemoteOrigin(String url) {
    if (Remote.list(repo).contains('origin')) {
      Remote.delete(repo: repo, name: 'origin');
    }
    Remote.create(
      repo: repo,
      name: 'origin',
      url: url,
      fetch: 'refs/heads/*:refs/remotes/origin/*',
    );
  }

  /// 远端地址（脱敏：隐藏凭证部分）
  String? _safeRemoteUrl() {
    try {
      final url = Remote.lookup(repo: repo, name: 'origin').url;
      return url.replaceAll(RegExp(r'//[^@/]+@'), '//');
    } on Object {
      return null;
    }
  }

  Remote get _origin {
    try {
      return Remote.lookup(repo: repo, name: 'origin');
    } on Object catch (e) {
      throw _classify(e);
    }
  }

  String _upstreamRefName(String branch) => 'refs/remotes/origin/$branch';

  // ————————————————————————————————————— 提交

  /// 过滤同步护栏路径（对齐桌面意图：OS 垃圾与 `.nexnote/` 运行时产物不入库）
  List<String> _filterGuarded(List<String> paths) => SyncGuard.allowed(paths);

  /// 提交指定路径（含未跟踪），返回提交 sha
  String commitPaths({
    required String message,
    required List<String> paths,
  }) {
    final allowed = _filterGuarded(paths);
    if (allowed.isEmpty) {
      throw const GitServiceError(GitErrorKind.unknown, '没有可提交的变更');
    }
    final r = repo;
    final index = r.index;
    index.addAll(allowed);
    index.write();
    return _createCommit(r, index, message);
  }

  /// 提交全部非护栏变更；无变更时返回 null
  String? commitAll({required String message}) {
    final changed = _filterGuarded(changedPaths(repo));
    if (changed.isEmpty) return null;
    return commitPaths(message: message, paths: changed);
  }

  String _createCommit(Repository r, Index index, String message) {
    final treeOid = index.writeTree(r);
    final tree = Tree.lookup(repo: r, oid: treeOid);
    final sig = Signature.create(name: _identityName, email: _identityEmail);
    final parents = <Commit>[];
    if (!_isHeadUnborn(r)) {
      parents.add(r.headCommit);
    }
    final oid = Commit.create(
      repo: r,
      updateRef: 'HEAD',
      author: sig,
      committer: sig,
      message: message,
      tree: tree,
      parents: parents,
    );
    return oid.sha;
  }

  /// 调度自动提交（写入路径触发；30s 防抖 + 2s 最小间隔）
  void scheduleAutoCommit(String summary) {
    if (_blockedByConflict) {
      throw const GitServiceError(
          GitErrorKind.conflict, '同步冲突禁写中，不能提交');
    }
    _autoCommitDebounce?.cancel();
    final sinceLast = DateTime.now().difference(_lastAutoCommitAt);
    final delay = sinceLast < _autoCommitMinInterval
        ? _autoCommitMinInterval - sinceLast
        : Duration.zero;
    _autoCommitDebounce = Timer(delay + _autoCommitDebounceDelay, () async {
      try {
        final sha = commitAll(message: '${CommitPrefix.auto} $summary');
        if (sha != null) {
          _lastAutoCommitAt = DateTime.now();
          _broadcastStatus();
        }
      } on Object {
        // 自动提交失败不打断写入流程；状态展示层会读取 changed 状态
      }
    });
  }

  // ————————————————————————————————————— 时间线

  /// 版本时间线（只读）
  List<CommitRecord> timeline({int limit = 100}) {
    if (!isRepoInitialized || _isHeadUnborn(repo)) return const [];
    final commits = repo.log(oid: repo.head.target, sorting: {GitSort.time});
    final records = <CommitRecord>[];
    for (final (i, c) in commits.indexed) {
      if (i >= limit) break;
      records.add(
        CommitRecord.from(
          c.oid.sha,
          c.author.name,
          DateTime.fromMillisecondsSinceEpoch(
            c.author.time * 1000,
            isUtc: true,
          ),
          c.message.trim(),
          i == 0,
        ),
      );
    }
    return records;
  }

  // ————————————————————————————————————— 同步

  /// 同步：fetch → rebase（落后时）→ push（领先时）
  Future<SyncResult> sync() async {
    if (_syncing) {
      return const SyncResult(state: SyncState.idle, message: '同步进行中');
    }
    _syncing = true;
    try {
      final r = repo;
      final branch = currentBranch(r);

      // 脏工作区守卫（对齐桌面语义）
      final dirty = _filterGuarded(changedPaths(r));
      if (dirty.isNotEmpty) {
        return SyncResult(
          state: SyncState.idle,
          message: SyncMessages.dirtyRejected,
        );
      }

      _setStatus(SyncMessages.fetching);
      final remote = _origin;
      await Future<void>.delayed(Duration.zero);
      remote.fetch(callbacks: await _callbacks(remote.url));

      final upstreamRef = _upstreamRefName(branch);
      final hasUpstream = r.references.contains(upstreamRef);
      final localOid = _isHeadUnborn(r) ? null : r.head.target;
      var ahead = 0;
      var behind = 0;
      if (hasUpstream && localOid != null) {
        final upstream =
            Reference.lookup(repo: r, name: upstreamRef).target;
        final ab = r.aheadBehind(local: localOid, upstream: upstream);
        ahead = ab.first;
        behind = ab.last;
      }

      // 远端尚无此分支：首次推送
      if (!hasUpstream) {
        if (localOid == null) {
          return const SyncResult(
            state: SyncState.upToDate,
            message: SyncMessages.nothingToPush,
          );
        }
        _setStatus(SyncMessages.pushing);
        await _push(branch, remote);
        return SyncResult(
          state: SyncState.ahead,
          message: SyncMessages.done,
          ahead: 1,
          pushed: 1,
        );
      }

      if (behind > 0) {
        _setStatus(SyncMessages.rebasing);
        final upstream =
            Reference.lookup(repo: r, name: upstreamRef).target;
        await _rebaseOnto(r, upstream);
        // rebase 后重新计算 ahead
        final newLocal = r.head.target;
        final newUpstream =
            Reference.lookup(repo: r, name: upstreamRef).target;
        final ab = r.aheadBehind(local: newLocal, upstream: newUpstream);
        ahead = ab.first;
        behind = ab.last;
      }

      if (ahead > 0) {
        _setStatus(SyncMessages.pushing);
        await _push(branch, remote);
        return SyncResult(
          state: SyncState.ahead,
          message: SyncMessages.done,
          ahead: ahead,
          pushed: ahead,
        );
      }

      _blockedByConflict = false;
      return SyncResult(
        state: SyncState.upToDate,
        message: SyncMessages.doneUpToDate,
      );
    } on GitServiceError {
      rethrow;
    } on Object catch (e) {
      final err = _classify(e);
      _scheduleBackoff();
      throw err;
    } finally {
      _syncing = false;
      _broadcastStatus();
    }
  }

  void _setStatus(String message) {
    _broadcastStatus(message);
  }

  /// rebase 本地分支到远端上游；冲突时 abort 并进入禁写
  Future<void> _rebaseOnto(Repository r, Oid upstreamOid) async {
    final upstream = AnnotatedCommit.lookup(repo: r, oid: upstreamOid);
    final rebase = Rebase.init(repo: r, upstream: upstream);
    try {
      final steps = rebase.operations.length;
      for (var i = 0; i < steps; i++) {
        rebase.next();
        rebase.commit(
          committer:
              Signature.create(name: _identityName, email: _identityEmail),
        );
      }
      rebase.finish();
      _blockedByConflict = false;
    } on LibGit2Error catch (e) {
      try {
        rebase.abort();
      } on Object {
        // abort 失败也保持禁写态，由桌面端处理
      }
      _blockedByConflict = true;
      throw GitServiceError(
        GitErrorKind.conflict,
        '同步冲突：${e.message}（请在桌面端解决后重新同步）',
      );
    }
  }

  Future<void> _push(String branch, Remote remote) async {
    try {
      remote.push(
        refspecs: ['refs/heads/$branch:refs/heads/$branch'],
        callbacks: await _callbacks(remote.url),
      );
    } on Object catch (e) {
      throw _classify(e);
    }
  }

  Future<Callbacks> _callbacks(String url) async {
    if (!credentials.needsCredentials(url)) {
      return const Callbacks();
    }
    final creds = await credentials.httpsCredentials();
    if (creds == null) {
      throw const GitServiceError(
          GitErrorKind.auth, '未配置远端凭证（请在设置中填写）');
    }
    return Callbacks(credentials: creds);
  }

  void _scheduleBackoff() {
    _backoffMs = (_backoffMs == 0)
        ? 60 * 1000
        : (_backoffMs * 2).clamp(60 * 1000, 4 * 60 * 1000);
    _autoSyncTimer?.cancel();
    _autoSyncTimer = Timer(Duration(milliseconds: _backoffMs), () {
      _backoffMs = 0;
      sync().ignore();
    });
  }

  /// 启动自动同步定时器
  void startAutoSync() {
    _autoSyncTimer?.cancel();
    _autoSyncTimer = Timer.periodic(_autoSyncInterval, (_) {
      if (!_syncing) sync().ignore();
    });
  }

  void stopAutoSync() {
    _autoSyncTimer?.cancel();
    _autoSyncTimer = null;
  }

  // ————————————————————————————————————— 错误分类

  GitServiceError _classify(Object e) {
    if (e is GitServiceError) return e;
    if (e is LibGit2Error) {
      final msg = e.message.toLowerCase();
      switch (e.errorClass) {
        case git_error_t.GIT_ERROR_HTTP:
        case git_error_t.GIT_ERROR_NET:
          return GitServiceError(GitErrorKind.network, e.message);
        case git_error_t.GIT_ERROR_SSL:
          return GitServiceError(GitErrorKind.hostKey, e.message);
        case git_error_t.GIT_ERROR_SSH:
          return GitServiceError(GitErrorKind.auth, e.message);
        case git_error_t.GIT_ERROR_REBASE:
        case git_error_t.GIT_ERROR_MERGE:
        case git_error_t.GIT_ERROR_CHECKOUT:
          return GitServiceError(GitErrorKind.conflict, e.message);
        default:
          break;
      }
      if (msg.contains('401') ||
          msg.contains('403') ||
          msg.contains('authenticat')) {
        return GitServiceError(GitErrorKind.auth, e.message);
      }
      if (msg.contains('certificate') || msg.contains('host key')) {
        return GitServiceError(GitErrorKind.hostKey, e.message);
      }
      if (msg.contains('conflict')) {
        return GitServiceError(GitErrorKind.conflict, e.message);
      }
      if (msg.contains('could not resolve host') ||
          msg.contains('connection') ||
          msg.contains('timed out')) {
        return GitServiceError(GitErrorKind.network, e.message);
      }
      return GitServiceError(GitErrorKind.unknown, e.message);
    }
    return GitServiceError(GitErrorKind.unknown, e.toString());
  }

  /// 释放资源
  void dispose() {
    _autoCommitDebounce?.cancel();
    stopAutoSync();
    _syncStatusController.close();
  }
}
