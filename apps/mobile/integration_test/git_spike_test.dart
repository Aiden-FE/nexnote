// MOB-002 / MOB-004 设备端 Git 验证——在 iOS 运行时上真实执行
//
// 覆盖：clone -> 本地 commit -> push -> 远端 ref 一致；
//       第二设备写入后本设备 fetch+rebase+push 收敛；
//       同步护栏（.nexnote/ 与 OS 垃圾不入库）。
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:git2dart/git2dart.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nexnote_mobile/core/constants.dart';
import 'package:nexnote_mobile/git/credentials.dart';
import 'package:nexnote_mobile/git/device_git_service.dart';
import 'package:nexnote_mobile/git/sync_guard.dart';
import 'package:nexnote_mobile/vault/vault_repository.dart';
import 'package:nexnote_mobile/vault/vault_store.dart';
import 'package:path_provider/path_provider.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const remoteEnv = String.fromEnvironment('NEXNOTE_SPIKE_REMOTE');
  final remote = remoteEnv.isNotEmpty
      ? remoteEnv
      : 'file:///Users/aiden/dev/aiden/nexnote/.scratch/nexnote-mobile/fixture/remote.git';

  late Directory appSupport;
  final created = <Directory>[];

  setUpAll(() async {
    appSupport = await getTemporaryDirectory();
  });

  tearDownAll(() {
    for (final dir in created) {
      if (dir.existsSync()) dir.deleteSync(recursive: true);
    }
  });

  Future<(DeviceGitService, VaultRepository, VaultStore)> newClient(
      String name) async {
    final store = await VaultStore.open(
      name: name,
      appSupportOverride: appSupport,
    );
    created.add(Directory(store.rootPath));
    final repository = VaultRepository(store);
    final git = await DeviceGitService.open(store, NoCredentialProvider());
    return (git, repository, store);
  }

  testWidgets('设备端 Git 全链路：clone / commit / push / rebase 收敛', (tester) async {
    final (gitA, repoA, storeA) = await newClient('spike-a');

    expect(gitA.isRepoInitialized, isFalse);
    await gitA.clone(
      url: remote,
      name: 'Device A',
      email: 'a@nexnote.local',
    );
    expect(gitA.isRepoInitialized, isTrue, reason: 'clone 后应存在 .git');

    final afterClone = gitA.status();
    expect(afterClone.initialized, isTrue);
    expect(afterClone.branch, 'main');
    expect(afterClone.changed, isEmpty, reason: 'clone 后工作区应干净');

    expect(repoA.listPagePaths(), contains('index.md'));
    final indexPage = repoA.readPage('index.md');
    expect(indexPage, isNotNull);
    expect(indexPage!.title, 'NexNote 移动端验收库');
    expect(indexPage.frontmatter?.tags, contains('fixture'));

    // 正常页面 + 护栏文件同时写入
    storeA.directory('notes').createSync(recursive: true);
    storeA.directory('.nexnote').createSync(recursive: true);
    repoA.createPage('notes/设备提交.md', '# 设备提交\n\n来自设备 A。\n');
    storeA.file('.DS_Store').writeAsStringSync('junk');
    storeA.file('.nexnote/index.db').writeAsStringSync('runtime');

    final changed = gitA.status().changed;
    expect(changed, contains('notes/设备提交.md'), reason: '应发现未跟踪新页面');
    expect(changed, isNot(contains('.DS_Store')), reason: '护栏文件不应出现');
    expect(
      changed.any((e) => e.startsWith('.nexnote/')),
      isFalse,
      reason: '运行时产物不应出现',
    );

    final shaA = gitA.commitAll(message: '${CommitPrefix.manual} 设备 A 首次提交');
    expect(shaA, isNotNull, reason: '应产生提交');

    final timeline = gitA.timeline();
    expect(timeline, isNotEmpty);
    expect(timeline.first.message, contains(CommitPrefix.manual));
    expect(timeline.first.kind, CommitKind.manual);
    expect(timeline.first.isHead, isTrue);
    expect(timeline.first.hash, shaA);

    final pushA = await gitA.sync();
    expect(pushA.ok, isTrue, reason: '首次同步应推送成功：${pushA.message}');
    expect(gitA.status().ahead, 0, reason: '推送后不应再有领先提交');
    expect(_remoteHeadSha(remote, 'main'), shaA,
        reason: '远端 main 应指向设备 A 的提交');

    final (gitB, repoB, _) = await newClient('spike-b');
    await gitB.clone(
      url: remote,
      name: 'Device B',
      email: 'b@nexnote.local',
    );
    repoB.createPage('notes/设备B提交.md', '# 设备 B 提交\n\n来自设备 B。\n');
    gitB.commitAll(message: '${CommitPrefix.manual} 设备 B 提交');
    final pushB = await gitB.sync();
    expect(pushB.ok, isTrue, reason: '设备 B 推送应成功：${pushB.message}');
    expect(_remoteHeadSha(remote, 'main'), isNot(shaA));

    final remoteA = Remote.lookup(repo: gitA.repo, name: 'origin');
    remoteA.fetch();
    expect(gitA.status().behind, 1, reason: 'fetch 后应显示落后 1');

    repoA.createPage('notes/设备A分叉.md', '# 设备 A 分叉\n\n本地独有提交。\n');
    gitA.commitAll(message: '${CommitPrefix.manual} 设备 A 分叉提交');
    expect(gitA.status().ahead, 1);
    expect(gitA.status().behind, 1);

    final syncA = await gitA.sync();
    expect(syncA.ok, isTrue, reason: '分叉同步应成功（rebase）：${syncA.message}');

    final finalStatus = gitA.status();
    expect(finalStatus.ahead, 0, reason: '同步后本地应全部推送');
    expect(finalStatus.behind, 0, reason: '同步后不应落后');
    expect(finalStatus.changed, isEmpty, reason: '同步后工作区应干净');

    final messages = gitA.timeline(limit: 10).map((e) => e.message).toList();
    expect(messages.any((m) => m.contains('设备 B 提交')), isTrue,
        reason: 'rebase 后历史应包含设备 B 的提交：$messages');
    expect(messages.any((m) => m.contains('设备 A 分叉提交')), isTrue,
        reason: 'rebase 后历史应保留设备 A 的分叉提交：$messages');

    final remotePaths = _allPathsInCommitTree(remote);
    expect(remotePaths, contains('notes/设备B提交.md'));
    expect(remotePaths.any((e) => e.contains('.DS_Store')), isFalse,
        reason: 'OS 垃圾文件不得入库：$remotePaths');
    expect(remotePaths.any((e) => e.startsWith('.nexnote/')), isFalse,
        reason: '运行时产物不得入库：$remotePaths');
  });

  testWidgets('同步护栏判定（设备端单元语义）', (tester) async {
    expect(SyncGuard.isGuarded('.DS_Store'), isTrue);
    expect(SyncGuard.isGuarded('.nexnote/index.db'), isTrue);
    expect(SyncGuard.isGuarded('notes/a.md'), isFalse);
  });
}

String _remoteHeadSha(String remoteUrl, String branch) {
  final repo = Repository.open(remoteUrl.replaceFirst('file://', ''));
  return Reference.lookup(repo: repo, name: 'refs/heads/$branch').target.sha;
}

List<String> _allPathsInCommitTree(String remoteUrl) {
  final repo = Repository.open(remoteUrl.replaceFirst('file://', ''));
  final out = <String>[];
  void walk(Oid treeOid, String prefix) {
    final tree = Tree.lookup(repo: repo, oid: treeOid);
    for (final entry in tree.entries) {
      final path = prefix.isEmpty ? entry.name : '$prefix/${entry.name}';
      if (entry.type == GitObject.tree) {
        walk(entry.oid, path);
      } else {
        out.add(path);
      }
    }
  }

  walk(repo.headCommit.treeOid, '');
  return out;
}
