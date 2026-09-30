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
}
