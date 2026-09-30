// 诊断：libgit2 在 iOS 上的 status / 提交可见性
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:git2dart/git2dart.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('诊断 status 与提交', (tester) async {
    final tmp = await getTemporaryDirectory();
    final dir = Directory('${tmp.path}/diag-${DateTime.now().millisecondsSinceEpoch}');
    dir.createSync(recursive: true);
    File('${dir.path}/a.md').writeAsStringSync('# A');

    final repo = Repository.init(path: dir.path, initialHead: 'main');
    repo.setIdentity(name: 'Diag', email: 'diag@nexnote.local');

    final rawStatus = repo.status;
    debugPrint('DIAG status after write: $rawStatus');
    debugPrint('DIAG workdir: ${repo.workdir}');
    debugPrint('DIAG path: ${repo.path}');
    debugPrint('DIAG state: ${repo.state}');

    final index0 = repo.index;
    debugPrint('DIAG index.find(a.md) before add: ${index0.find('a.md')}');
    debugPrint('DIAG statusFile(a.md): ${repo.statusFile('a.md')}');
    debugPrint('DIAG head targets: ${repo.references}');

    final index = repo.index;
    index.addAll(['a.md']);
    index.write();
    debugPrint('DIAG status after addAll: ${repo.status}');

    final treeOid = index.writeTree(repo);
    final sig = Signature.create(name: 'Diag', email: 'diag@nexnote.local');
    final oid = Commit.create(
      repo: repo,
      updateRef: 'HEAD',
      author: sig,
      committer: sig,
      message: 'nexnote:manual: diag',
      tree: Tree.lookup(repo: repo, oid: treeOid),
      parents: const [],
    );
    debugPrint('DIAG created commit: ${oid.sha}');
    debugPrint('DIAG log: ${repo.log(oid: repo.head.target).map((c) => c.summary).toList()}');

    expect(oid.sha, isNotEmpty);
  });
}
