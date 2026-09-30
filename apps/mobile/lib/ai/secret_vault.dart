// 密钥存取抽象——MOB-010
//
// iOS 走 Keychain（平台通道）；无平台通道（测试/开发）走内存实现。
// 配置文件只保存不透明 account 引用，密钥字节不落盘。
library;

import 'package:flutter/services.dart';

/// 密钥存取
abstract class SecretVault {
  Future<void> write(String account, String secret);

  /// 不存在时返回 null
  Future<String?> read(String account);

  Future<void> delete(String account);
}

class _KeychainChannel {
  static const _channel = MethodChannel('com.nexnote.mobile/keychain');

  static Future<bool> write(String account, String secret) async {
    try {
      final ok = await _channel.invokeMethod<bool>('write', {
        'account': account,
        'secret': secret,
      });
      return ok ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<String?> read(String account) async {
    try {
      return await _channel.invokeMethod<String>('read', {'account': account});
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  static Future<bool> delete(String account) async {
    try {
      final ok = await _channel.invokeMethod<bool>('delete', {'account': account});
      return ok ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

/// iOS Keychain 实现
class KeychainSecretVault implements SecretVault {
  @override
  Future<void> write(String account, String secret) async {
    final ok = await _KeychainChannel.write(account, secret);
    if (!ok) {
      throw SecretVaultError('Keychain 写入失败');
    }
  }

  @override
  Future<String?> read(String account) => _KeychainChannel.read(account);

  @override
  Future<void> delete(String account) async {
    final ok = await _KeychainChannel.delete(account);
    if (!ok) {
      throw SecretVaultError('Keychain 删除失败');
    }
  }
}

/// 内存实现——测试与开发
class InMemorySecretVault implements SecretVault {
  final _store = <String, String>{};

  @override
  Future<void> write(String account, String secret) async =>
      _store[account] = secret;

  @override
  Future<String?> read(String account) async => _store[account];

  @override
  Future<void> delete(String account) async => _store.remove(account);
}

class SecretVaultError implements Exception {
  final String message;
  const SecretVaultError(this.message);
  @override
  String toString() => 'SecretVaultError: $message';
}
