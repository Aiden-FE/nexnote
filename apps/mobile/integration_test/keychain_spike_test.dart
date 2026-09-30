// MOB-010 在 iOS 运行时上验证 Keychain 密钥往返与 Profile 落盘不含密钥
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nexnote_mobile/ai/provider_profile.dart';
import 'package:nexnote_mobile/ai/secret_vault.dart';
import 'package:path_provider/path_provider.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Keychain 写入/读取/删除往返', (tester) async {
    final vault = KeychainSecretVault();
    final account = 'itest-${DateTime.now().millisecondsSinceEpoch}';

    expect(await vault.read(account), isNull);
    await vault.write(account, 'sk-integration-secret');
    expect(await vault.read(account), 'sk-integration-secret');

    await vault.write(account, 'sk-updated');
    expect(await vault.read(account), 'sk-updated');

    await vault.delete(account);
    expect(await vault.read(account), isNull);
  });

  testWidgets('Profile 落盘文件不含密钥字节', (tester) async {
    final support = await getApplicationSupportDirectory();
    final store = ProviderProfileStore(
      appSupport: support,
      secrets: KeychainSecretVault(),
    );
    final profile = ProviderProfile(
      id: 'itest-${DateTime.now().millisecondsSinceEpoch}',
      name: '集成测试',
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'demo-model',
    );
    await store.upsert(profile, 'sk-never-on-disk');
    expect(store.file.readAsStringSync(), isNot(contains('sk-never-on-disk')));
    expect(await store.keyFor(profile), 'sk-never-on-disk');
    await store.remove(profile.id);
  });
}
