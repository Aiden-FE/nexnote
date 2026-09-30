import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    registerBackupExclusionChannel(
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    registerKeychainChannel(
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
  }

  /// 设备知识库排除 iCloud 备份——MOB-003
  ///
  /// App Support 下的知识库若被 iCloud 同步，整个 `.git` 目录会被文件级同步改写。
  private func registerBackupExclusionChannel(binaryMessenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: "com.nexnote.mobile/backup_exclusion",
      binaryMessenger: binaryMessenger
    )
    channel.setMethodCallHandler { call, result in
      guard
        let args = call.arguments as? [String: Any],
        let path = args["path"] as? String,
        var url = URL(fileURLWithPath: path, isDirectory: true) as URL?
      else {
        result(FlutterError(code: "BAD_ARGS", message: "缺少 path 参数", details: nil))
        return
      }
      // 确保目录已存在，否则设置资源值会失败
      try? FileManager.default.createDirectory(
        at: url,
        withIntermediateDirectories: true
      )

      switch call.method {
      case "markExcluded":
        do {
          var values = URLResourceValues()
          values.isExcludedFromBackup = true
          try url.setResourceValues(values)
          result(true)
        } catch {
          result(FlutterError(code: "MARK_FAILED", message: error.localizedDescription, details: nil))
        }
      case "isExcluded":
        do {
          let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
          result(values.isExcludedFromBackup ?? false)
        } catch {
          result(FlutterError(code: "QUERY_FAILED", message: error.localizedDescription, details: nil))
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  /// iOS Keychain 密钥存取——MOB-010
  ///
  /// 密钥字节只存 Keychain；配置文件只保存不透明 account 引用。
  private func registerKeychainChannel(binaryMessenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: "com.nexnote.mobile/keychain",
      binaryMessenger: binaryMessenger
    )
    channel.setMethodCallHandler { call, result in
      guard
        let args = call.arguments as? [String: Any],
        let account = args["account"] as? String,
        !account.isEmpty
      else {
        result(FlutterError(code: "BAD_ARGS", message: "缺少 account 参数", details: nil))
        return
      }
      let service = "com.nexnote.mobile.secrets"
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
      ]

      switch call.method {
      case "write":
        guard let secret = args["secret"] as? String else {
          result(FlutterError(code: "BAD_ARGS", message: "缺少 secret 参数", details: nil))
          return
        }
        let data = Data(secret.utf8)
        var update = query
        update[kSecValueData as String] = data
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
          var add = query
          add[kSecValueData as String] = data
          add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
          let addStatus = SecItemAdd(add as CFDictionary, nil)
          result(addStatus == errSecSuccess)
        } else {
          result(status == errSecSuccess)
        }
      case "read":
        var read = query
        read[kSecReturnData as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(read as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data {
          result(String(data: data, encoding: .utf8))
        } else if status == errSecItemNotFound {
          result(nil)
        } else {
          result(FlutterError(code: "READ_FAILED", message: "status \(status)", details: nil))
        }
      case "delete":
        let status = SecItemDelete(query as CFDictionary)
        result(status == errSecSuccess || status == errSecItemNotFound)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
