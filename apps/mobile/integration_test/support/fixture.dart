// 集成测试的本地 Git 远端（fixture）解析
//
// fixture 由 `tool/make_test_fixture.sh` 在测试前生成（幂等、纯本地产物、不入库），
// 地址通过 --dart-define=NEXNOTE_SPIKE_REMOTE=file://... 注入。
// 推荐直接用 `./tool/run_integration_test.sh` 一步跑完（自动生成 fixture + 注入地址）。
library;

const _remoteFromDefine = String.fromEnvironment('NEXNOTE_SPIKE_REMOTE');

/// 返回注入的 fixture 远端地址；未注入时抛出可操作的错误信息
String requireFixtureRemote() {
  if (_remoteFromDefine.isEmpty) {
    throw StateError(
      '缺少 fixture 远端地址。请用 ./tool/run_integration_test.sh 运行，'
      '或手动执行：\n'
      '  ./tool/make_test_fixture.sh\n'
      '  flutter test integration_test/<file>.dart -d <sim> '
      '--dart-define=NEXNOTE_SPIKE_REMOTE=file://<repo>/apps/mobile/.test-fixture/remote.git',
    );
  }
  return _remoteFromDefine;
}
