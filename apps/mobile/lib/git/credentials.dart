// Git 凭证抽象——实现由平台层提供（iOS Keychain，见 MOB-010）
library;

import 'package:git2dart/git2dart.dart';

/// 凭证来源
abstract interface class CredentialProvider {
  /// HTTPS 用户名与 token/password；返回 null 表示不使用凭证（如本地远端）
  Future<UserPass?> httpsCredentials();

  /// 远端是否需要凭证（按 URL 前缀判断；子类可覆盖）
  bool needsCredentials(String url) =>
      url.startsWith('http://') || url.startsWith('https://');
}

/// 无凭证实现——用于本地文件远端与测试
class NoCredentialProvider extends CredentialProvider {
  NoCredentialProvider();

  @override
  Future<UserPass?> httpsCredentials() async => null;

  @override
  bool needsCredentials(String url) => false;
}

/// 静态凭证实现——用于测试与手动配置场景
class StaticCredentialProvider extends CredentialProvider {
  final String username;
  final String token;
  StaticCredentialProvider({required this.username, required this.token});

  @override
  Future<UserPass?> httpsCredentials() async =>
      UserPass(username: username, password: token);
}
