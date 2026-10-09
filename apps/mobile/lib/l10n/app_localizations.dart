import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('zh'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In zh, this message translates to:
  /// **'NexNote'**
  String get appTitle;

  /// No description provided for @navVault.
  ///
  /// In zh, this message translates to:
  /// **'库'**
  String get navVault;

  /// No description provided for @navSearch.
  ///
  /// In zh, this message translates to:
  /// **'搜索'**
  String get navSearch;

  /// No description provided for @navCapture.
  ///
  /// In zh, this message translates to:
  /// **'捕获'**
  String get navCapture;

  /// No description provided for @navAi.
  ///
  /// In zh, this message translates to:
  /// **'AI'**
  String get navAi;

  /// No description provided for @navSettings.
  ///
  /// In zh, this message translates to:
  /// **'设置'**
  String get navSettings;

  /// No description provided for @vaultTitle.
  ///
  /// In zh, this message translates to:
  /// **'库'**
  String get vaultTitle;

  /// No description provided for @vaultTagFilterTooltip.
  ///
  /// In zh, this message translates to:
  /// **'标签筛选'**
  String get vaultTagFilterTooltip;

  /// No description provided for @vaultEmpty.
  ///
  /// In zh, this message translates to:
  /// **'设备知识库为空，先在「设置」里克隆或初始化。'**
  String get vaultEmpty;

  /// No description provided for @vaultRootDir.
  ///
  /// In zh, this message translates to:
  /// **'根目录'**
  String get vaultRootDir;

  /// No description provided for @vaultUncategorized.
  ///
  /// In zh, this message translates to:
  /// **'未分类'**
  String get vaultUncategorized;

  /// No description provided for @searchTitle.
  ///
  /// In zh, this message translates to:
  /// **'搜索'**
  String get searchTitle;

  /// No description provided for @searchHint.
  ///
  /// In zh, this message translates to:
  /// **'搜索页面内容（支持中文子串）'**
  String get searchHint;

  /// No description provided for @searchResultCount.
  ///
  /// In zh, this message translates to:
  /// **'命中 {count} 个页面'**
  String searchResultCount(int count);

  /// No description provided for @searchInitial.
  ///
  /// In zh, this message translates to:
  /// **'输入关键词开始搜索'**
  String get searchInitial;

  /// No description provided for @searchRebuild.
  ///
  /// In zh, this message translates to:
  /// **'重建索引'**
  String get searchRebuild;

  /// No description provided for @searchNoResults.
  ///
  /// In zh, this message translates to:
  /// **'没有命中结果'**
  String get searchNoResults;

  /// No description provided for @captureTitle.
  ///
  /// In zh, this message translates to:
  /// **'捕获'**
  String get captureTitle;

  /// No description provided for @captureDirectory.
  ///
  /// In zh, this message translates to:
  /// **'落点目录：{directory}'**
  String captureDirectory(String directory);

  /// No description provided for @captureHint.
  ///
  /// In zh, this message translates to:
  /// **'随手记下想法，首行作为标题'**
  String get captureHint;

  /// No description provided for @captureAction.
  ///
  /// In zh, this message translates to:
  /// **'捕获'**
  String get captureAction;

  /// No description provided for @captureSuccess.
  ///
  /// In zh, this message translates to:
  /// **'已捕获：{title}'**
  String captureSuccess(String title);

  /// No description provided for @captureOpenLast.
  ///
  /// In zh, this message translates to:
  /// **'打开刚捕获的页面'**
  String get captureOpenLast;

  /// No description provided for @aiTitle.
  ///
  /// In zh, this message translates to:
  /// **'AI 对话'**
  String get aiTitle;

  /// No description provided for @aiClearTooltip.
  ///
  /// In zh, this message translates to:
  /// **'清空'**
  String get aiClearTooltip;

  /// No description provided for @aiNoProfile.
  ///
  /// In zh, this message translates to:
  /// **'未配置供应商 Profile（只读对话）'**
  String get aiNoProfile;

  /// No description provided for @aiReadOnlySession.
  ///
  /// In zh, this message translates to:
  /// **'只读对话 · {name} · {model}'**
  String aiReadOnlySession(String name, String model);

  /// No description provided for @aiEmptyHint.
  ///
  /// In zh, this message translates to:
  /// **'提问会先做两阶段召回（关键词 + 双链扩展）'**
  String get aiEmptyHint;

  /// No description provided for @aiInputHint.
  ///
  /// In zh, this message translates to:
  /// **'问点什么…'**
  String get aiInputHint;

  /// No description provided for @aiThinking.
  ///
  /// In zh, this message translates to:
  /// **'思考中…'**
  String get aiThinking;

  /// No description provided for @settingsTitle.
  ///
  /// In zh, this message translates to:
  /// **'设置'**
  String get settingsTitle;

  /// No description provided for @settingsDeviceVault.
  ///
  /// In zh, this message translates to:
  /// **'设备知识库'**
  String get settingsDeviceVault;

  /// No description provided for @settingsPath.
  ///
  /// In zh, this message translates to:
  /// **'路径：{path}'**
  String settingsPath(String path);

  /// No description provided for @settingsPageCount.
  ///
  /// In zh, this message translates to:
  /// **'页面数：{count}'**
  String settingsPageCount(int count);

  /// No description provided for @settingsBackupOn.
  ///
  /// In zh, this message translates to:
  /// **'iCloud 备份排除：已生效'**
  String get settingsBackupOn;

  /// No description provided for @settingsBackupOff.
  ///
  /// In zh, this message translates to:
  /// **'iCloud 备份排除：未确认'**
  String get settingsBackupOff;

  /// No description provided for @settingsUnpushed.
  ///
  /// In zh, this message translates to:
  /// **'有 {count} 个未推送提交。设备端是这些提交的唯一副本，请尽快同步。'**
  String settingsUnpushed(int count);

  /// No description provided for @settingsGitStatus.
  ///
  /// In zh, this message translates to:
  /// **'Git 状态'**
  String get settingsGitStatus;

  /// No description provided for @settingsReading.
  ///
  /// In zh, this message translates to:
  /// **'读取中…'**
  String get settingsReading;

  /// No description provided for @settingsRemote.
  ///
  /// In zh, this message translates to:
  /// **'远端：{url}'**
  String settingsRemote(String url);

  /// No description provided for @settingsConflictBanner.
  ///
  /// In zh, this message translates to:
  /// **'同步冲突：手机端已禁写，请在桌面端处理'**
  String get settingsConflictBanner;

  /// No description provided for @settingsRemoteLabel.
  ///
  /// In zh, this message translates to:
  /// **'测试远端（file:// 或 https://）'**
  String get settingsRemoteLabel;

  /// No description provided for @settingsClone.
  ///
  /// In zh, this message translates to:
  /// **'克隆远端'**
  String get settingsClone;

  /// No description provided for @settingsWriteAndCommit.
  ///
  /// In zh, this message translates to:
  /// **'写页面并提交'**
  String get settingsWriteAndCommit;

  /// No description provided for @settingsSyncNow.
  ///
  /// In zh, this message translates to:
  /// **'立即同步'**
  String get settingsSyncNow;

  /// No description provided for @settingsTimeline.
  ///
  /// In zh, this message translates to:
  /// **'版本时间线'**
  String get settingsTimeline;

  /// No description provided for @settingsNoCommits.
  ///
  /// In zh, this message translates to:
  /// **'（暂无提交）'**
  String get settingsNoCommits;

  /// No description provided for @settingsCaptureDir.
  ///
  /// In zh, this message translates to:
  /// **'快速捕获目录'**
  String get settingsCaptureDir;

  /// No description provided for @settingsCapturePathLabel.
  ///
  /// In zh, this message translates to:
  /// **'知识库内相对路径'**
  String get settingsCapturePathLabel;

  /// No description provided for @settingsSave.
  ///
  /// In zh, this message translates to:
  /// **'保存'**
  String get settingsSave;

  /// No description provided for @settingsAiProfiles.
  ///
  /// In zh, this message translates to:
  /// **'AI 供应商 Profile'**
  String get settingsAiProfiles;

  /// No description provided for @settingsKeyConfigured.
  ///
  /// In zh, this message translates to:
  /// **'已配置密钥'**
  String get settingsKeyConfigured;

  /// No description provided for @settingsKeyMissing.
  ///
  /// In zh, this message translates to:
  /// **'未配置密钥'**
  String get settingsKeyMissing;

  /// No description provided for @settingsAddProfile.
  ///
  /// In zh, this message translates to:
  /// **'新增 Profile'**
  String get settingsAddProfile;

  /// No description provided for @settingsDiagnosticLog.
  ///
  /// In zh, this message translates to:
  /// **'诊断日志'**
  String get settingsDiagnosticLog;

  /// No description provided for @settingsNoLog.
  ///
  /// In zh, this message translates to:
  /// **'（暂无日志）'**
  String get settingsNoLog;

  /// No description provided for @settingsBackupExcludeFailed.
  ///
  /// In zh, this message translates to:
  /// **'备份排除标记写入失败，请检查系统设置'**
  String get settingsBackupExcludeFailed;

  /// No description provided for @settingsActionDone.
  ///
  /// In zh, this message translates to:
  /// **'{label}：完成'**
  String settingsActionDone(String label);

  /// No description provided for @settingsActionFailed.
  ///
  /// In zh, this message translates to:
  /// **'{label}：失败 {detail}'**
  String settingsActionFailed(String label, String detail);

  /// No description provided for @settingsCloneLabel.
  ///
  /// In zh, this message translates to:
  /// **'克隆'**
  String get settingsCloneLabel;

  /// No description provided for @settingsCommitAppend.
  ///
  /// In zh, this message translates to:
  /// **'提交 {sha}'**
  String settingsCommitAppend(String sha);

  /// No description provided for @settingsNoChange.
  ///
  /// In zh, this message translates to:
  /// **'（无变更）'**
  String get settingsNoChange;

  /// No description provided for @settingsSyncResult.
  ///
  /// In zh, this message translates to:
  /// **'同步 {state}：{message}'**
  String settingsSyncResult(String state, String message);

  /// No description provided for @settingsCaptureUpdated.
  ///
  /// In zh, this message translates to:
  /// **'捕获目录已更新为 {dir}'**
  String settingsCaptureUpdated(String dir);

  /// No description provided for @tagsTitle.
  ///
  /// In zh, this message translates to:
  /// **'标签'**
  String get tagsTitle;

  /// No description provided for @tagsEmpty.
  ///
  /// In zh, this message translates to:
  /// **'暂无标签'**
  String get tagsEmpty;

  /// No description provided for @tagsPageCount.
  ///
  /// In zh, this message translates to:
  /// **'{count} 个页面'**
  String tagsPageCount(int count);

  /// No description provided for @graphTitle.
  ///
  /// In zh, this message translates to:
  /// **'图谱'**
  String get graphTitle;

  /// No description provided for @graphSummary.
  ///
  /// In zh, this message translates to:
  /// **'页面 {nodes} · 双链 {edges} · 未解析 {unresolved}（点击页面查看，只读浏览）'**
  String graphSummary(int nodes, int edges, int unresolved);

  /// No description provided for @readerMissing.
  ///
  /// In zh, this message translates to:
  /// **'页面不存在'**
  String get readerMissing;

  /// No description provided for @readerTargetMissing.
  ///
  /// In zh, this message translates to:
  /// **'目标页面不存在：{target}'**
  String readerTargetMissing(String target);

  /// No description provided for @readerOutlineTooltip.
  ///
  /// In zh, this message translates to:
  /// **'标题目录'**
  String get readerOutlineTooltip;

  /// No description provided for @readerBacklinksTooltip.
  ///
  /// In zh, this message translates to:
  /// **'反向链接'**
  String get readerBacklinksTooltip;

  /// No description provided for @readerTimelineTooltip.
  ///
  /// In zh, this message translates to:
  /// **'版本时间线'**
  String get readerTimelineTooltip;

  /// No description provided for @readerGraphTooltip.
  ///
  /// In zh, this message translates to:
  /// **'图谱'**
  String get readerGraphTooltip;

  /// No description provided for @readerEditTooltip.
  ///
  /// In zh, this message translates to:
  /// **'编辑'**
  String get readerEditTooltip;

  /// No description provided for @readerBacklinksButton.
  ///
  /// In zh, this message translates to:
  /// **'反向链接（{count}）'**
  String readerBacklinksButton(int count);

  /// No description provided for @readerNoBacklinks.
  ///
  /// In zh, this message translates to:
  /// **'暂无反向链接'**
  String get readerNoBacklinks;

  /// No description provided for @readerNoCommits.
  ///
  /// In zh, this message translates to:
  /// **'暂无提交记录'**
  String get readerNoCommits;

  /// No description provided for @readerType.
  ///
  /// In zh, this message translates to:
  /// **'类型 {value}'**
  String readerType(String value);

  /// No description provided for @readerCreated.
  ///
  /// In zh, this message translates to:
  /// **'创建 {value}'**
  String readerCreated(String value);

  /// No description provided for @readerUpdated.
  ///
  /// In zh, this message translates to:
  /// **'更新 {value}'**
  String readerUpdated(String value);

  /// No description provided for @readerAliases.
  ///
  /// In zh, this message translates to:
  /// **'别名 {value}'**
  String readerAliases(String value);

  /// No description provided for @readerConfidence.
  ///
  /// In zh, this message translates to:
  /// **'置信度 {value}'**
  String readerConfidence(String value);

  /// No description provided for @blockTitle.
  ///
  /// In zh, this message translates to:
  /// **'块编辑'**
  String get blockTitle;

  /// No description provided for @blockSwitchToSource.
  ///
  /// In zh, this message translates to:
  /// **'切换到源码模式'**
  String get blockSwitchToSource;

  /// No description provided for @blockSave.
  ///
  /// In zh, this message translates to:
  /// **'保存'**
  String get blockSave;

  /// No description provided for @blockConflict.
  ///
  /// In zh, this message translates to:
  /// **'同步冲突禁写中：请在桌面端解决冲突后重试'**
  String get blockConflict;

  /// No description provided for @blockFrontmatter.
  ///
  /// In zh, this message translates to:
  /// **'元数据头（只读）\n{content}'**
  String blockFrontmatter(String content);

  /// No description provided for @blockCode.
  ///
  /// In zh, this message translates to:
  /// **'代码块{language}'**
  String blockCode(String language);

  /// No description provided for @blockImage.
  ///
  /// In zh, this message translates to:
  /// **'图片'**
  String get blockImage;

  /// No description provided for @blockTable.
  ///
  /// In zh, this message translates to:
  /// **'表格（只读）'**
  String get blockTable;

  /// No description provided for @blockMath.
  ///
  /// In zh, this message translates to:
  /// **'公式（只读）'**
  String get blockMath;

  /// No description provided for @blockHtml.
  ///
  /// In zh, this message translates to:
  /// **'HTML（只读）'**
  String get blockHtml;

  /// No description provided for @blockEditableInSource.
  ///
  /// In zh, this message translates to:
  /// **'源码模式可编辑'**
  String get blockEditableInSource;

  /// No description provided for @sourceTitle.
  ///
  /// In zh, this message translates to:
  /// **'源码编辑'**
  String get sourceTitle;

  /// No description provided for @sourceSwitchToBlock.
  ///
  /// In zh, this message translates to:
  /// **'切换到块编辑模式'**
  String get sourceSwitchToBlock;

  /// No description provided for @sourceSave.
  ///
  /// In zh, this message translates to:
  /// **'保存'**
  String get sourceSave;

  /// No description provided for @sourceConflict.
  ///
  /// In zh, this message translates to:
  /// **'同步冲突禁写中：请在桌面端解决冲突后重试'**
  String get sourceConflict;

  /// No description provided for @sourceFrontmatter.
  ///
  /// In zh, this message translates to:
  /// **'元数据头（只读）'**
  String get sourceFrontmatter;

  /// No description provided for @saveAutoCommit.
  ///
  /// In zh, this message translates to:
  /// **'已保存，将自动提交'**
  String get saveAutoCommit;

  /// No description provided for @saveNoChange.
  ///
  /// In zh, this message translates to:
  /// **'内容未变化'**
  String get saveNoChange;

  /// No description provided for @saveFailed.
  ///
  /// In zh, this message translates to:
  /// **'保存失败：{message}'**
  String saveFailed(String message);

  /// No description provided for @mdMathReadonly.
  ///
  /// In zh, this message translates to:
  /// **'公式（只读）'**
  String get mdMathReadonly;

  /// No description provided for @mdImageAlt.
  ///
  /// In zh, this message translates to:
  /// **'图片'**
  String get mdImageAlt;

  /// No description provided for @mdImageMissing.
  ///
  /// In zh, this message translates to:
  /// **'图片：{alt}（{src}）'**
  String mdImageMissing(String alt, String src);

  /// No description provided for @mdImagePlaceholder.
  ///
  /// In zh, this message translates to:
  /// **'[图片]'**
  String get mdImagePlaceholder;

  /// No description provided for @mdImagePlaceholderAlt.
  ///
  /// In zh, this message translates to:
  /// **'[图片:{alt}]'**
  String mdImagePlaceholderAlt(String alt);

  /// No description provided for @profileRequired.
  ///
  /// In zh, this message translates to:
  /// **'名称与 base-url 必填'**
  String get profileRequired;

  /// No description provided for @profileAdd.
  ///
  /// In zh, this message translates to:
  /// **'新增 Profile'**
  String get profileAdd;

  /// No description provided for @profileEdit.
  ///
  /// In zh, this message translates to:
  /// **'编辑 Profile'**
  String get profileEdit;

  /// No description provided for @profileName.
  ///
  /// In zh, this message translates to:
  /// **'名称'**
  String get profileName;

  /// No description provided for @profileModel.
  ///
  /// In zh, this message translates to:
  /// **'模型名'**
  String get profileModel;

  /// No description provided for @profileApiKey.
  ///
  /// In zh, this message translates to:
  /// **'API Key'**
  String get profileApiKey;

  /// No description provided for @profileApiKeyKeep.
  ///
  /// In zh, this message translates to:
  /// **'API Key（留空则不改动）'**
  String get profileApiKeyKeep;

  /// No description provided for @profileCancel.
  ///
  /// In zh, this message translates to:
  /// **'取消'**
  String get profileCancel;

  /// No description provided for @profileSave.
  ///
  /// In zh, this message translates to:
  /// **'保存'**
  String get profileSave;

  /// No description provided for @errNoProfile.
  ///
  /// In zh, this message translates to:
  /// **'未配置供应商 Profile，请先在设置中配置'**
  String get errNoProfile;

  /// No description provided for @errNoApiKey.
  ///
  /// In zh, this message translates to:
  /// **'该 Profile 未配置 API Key'**
  String get errNoApiKey;

  /// No description provided for @syncInProgress.
  ///
  /// In zh, this message translates to:
  /// **'同步进行中'**
  String get syncInProgress;

  /// No description provided for @syncFetching.
  ///
  /// In zh, this message translates to:
  /// **'拉取远端…'**
  String get syncFetching;

  /// No description provided for @syncRebasing.
  ///
  /// In zh, this message translates to:
  /// **'整合远端变更…'**
  String get syncRebasing;

  /// No description provided for @syncPushing.
  ///
  /// In zh, this message translates to:
  /// **'推送本地变更…'**
  String get syncPushing;

  /// No description provided for @syncDone.
  ///
  /// In zh, this message translates to:
  /// **'同步完成'**
  String get syncDone;

  /// No description provided for @syncUpToDate.
  ///
  /// In zh, this message translates to:
  /// **'已是最新'**
  String get syncUpToDate;

  /// No description provided for @syncNothingToPush.
  ///
  /// In zh, this message translates to:
  /// **'本地无新提交'**
  String get syncNothingToPush;

  /// No description provided for @syncDirtyRejected.
  ///
  /// In zh, this message translates to:
  /// **'知识库有未提交变更，已跳过自动同步'**
  String get syncDirtyRejected;

  /// No description provided for @gitNotInitialized.
  ///
  /// In zh, this message translates to:
  /// **'尚未初始化 Git'**
  String get gitNotInitialized;

  /// No description provided for @gitConflictSummary.
  ///
  /// In zh, this message translates to:
  /// **'同步冲突：请在桌面端处理后重新同步'**
  String get gitConflictSummary;

  /// No description provided for @gitStatusSummary.
  ///
  /// In zh, this message translates to:
  /// **'{branch} · 变更 {changed} · 领先 {ahead} · 落后 {behind}'**
  String gitStatusSummary(String branch, int changed, int ahead, int behind);

  /// No description provided for @recallKeyword.
  ///
  /// In zh, this message translates to:
  /// **'关键词'**
  String get recallKeyword;

  /// No description provided for @recallLinks.
  ///
  /// In zh, this message translates to:
  /// **'双链扩展'**
  String get recallLinks;

  /// No description provided for @captureEmpty.
  ///
  /// In zh, this message translates to:
  /// **'内容为空'**
  String get captureEmpty;

  /// No description provided for @captureUntitled.
  ///
  /// In zh, this message translates to:
  /// **'未命名捕获'**
  String get captureUntitled;

  /// No description provided for @settingsLanguage.
  ///
  /// In zh, this message translates to:
  /// **'界面语言'**
  String get settingsLanguage;

  /// No description provided for @settingsLanguageSystem.
  ///
  /// In zh, this message translates to:
  /// **'跟随系统'**
  String get settingsLanguageSystem;

  /// No description provided for @settingsLanguageZh.
  ///
  /// In zh, this message translates to:
  /// **'简体中文'**
  String get settingsLanguageZh;

  /// No description provided for @settingsLanguageEn.
  ///
  /// In zh, this message translates to:
  /// **'English'**
  String get settingsLanguageEn;

  /// No description provided for @syncStateIdle.
  ///
  /// In zh, this message translates to:
  /// **'空闲'**
  String get syncStateIdle;

  /// No description provided for @syncStateRunning.
  ///
  /// In zh, this message translates to:
  /// **'进行中'**
  String get syncStateRunning;

  /// No description provided for @syncStateUpToDate.
  ///
  /// In zh, this message translates to:
  /// **'已是最新'**
  String get syncStateUpToDate;

  /// No description provided for @syncStateAhead.
  ///
  /// In zh, this message translates to:
  /// **'待推送'**
  String get syncStateAhead;

  /// No description provided for @syncStateConflict.
  ///
  /// In zh, this message translates to:
  /// **'冲突'**
  String get syncStateConflict;

  /// No description provided for @syncStateError.
  ///
  /// In zh, this message translates to:
  /// **'失败'**
  String get syncStateError;

  /// No description provided for @gitErrNotInitialized.
  ///
  /// In zh, this message translates to:
  /// **'知识库尚未初始化 Git'**
  String get gitErrNotInitialized;

  /// No description provided for @gitErrVaultNotEmpty.
  ///
  /// In zh, this message translates to:
  /// **'知识库目录非空，拒绝 clone'**
  String get gitErrVaultNotEmpty;

  /// No description provided for @gitErrNoChanges.
  ///
  /// In zh, this message translates to:
  /// **'没有可提交的变更'**
  String get gitErrNoChanges;

  /// No description provided for @gitErrConflictBlocked.
  ///
  /// In zh, this message translates to:
  /// **'同步冲突禁写中：请在桌面端解决冲突并同步后重试'**
  String get gitErrConflictBlocked;

  /// No description provided for @gitErrCredentialsMissing.
  ///
  /// In zh, this message translates to:
  /// **'未配置远端凭证（请在设置中填写）'**
  String get gitErrCredentialsMissing;

  /// No description provided for @gitErrNetwork.
  ///
  /// In zh, this message translates to:
  /// **'网络请求失败'**
  String get gitErrNetwork;

  /// No description provided for @gitErrAuth.
  ///
  /// In zh, this message translates to:
  /// **'远端鉴权失败'**
  String get gitErrAuth;

  /// No description provided for @gitErrCertificate.
  ///
  /// In zh, this message translates to:
  /// **'远端主机证书或主机密钥校验失败'**
  String get gitErrCertificate;

  /// No description provided for @gitErrRemoteRejected.
  ///
  /// In zh, this message translates to:
  /// **'远端拒绝了请求'**
  String get gitErrRemoteRejected;

  /// No description provided for @gitErrOperation.
  ///
  /// In zh, this message translates to:
  /// **'Git 操作失败'**
  String get gitErrOperation;

  /// No description provided for @messageWithDetail.
  ///
  /// In zh, this message translates to:
  /// **'{message}（{detail}）'**
  String messageWithDetail(String message, String detail);

  /// No description provided for @errProviderNetwork.
  ///
  /// In zh, this message translates to:
  /// **'网络请求失败：{detail}'**
  String errProviderNetwork(String detail);

  /// No description provided for @errProviderHttp.
  ///
  /// In zh, this message translates to:
  /// **'供应商返回 HTTP {detail}'**
  String errProviderHttp(String detail);

  /// No description provided for @errProviderUnexpected.
  ///
  /// In zh, this message translates to:
  /// **'供应商请求失败：{detail}'**
  String errProviderUnexpected(String detail);

  /// No description provided for @secretWriteFailed.
  ///
  /// In zh, this message translates to:
  /// **'密钥写入失败'**
  String get secretWriteFailed;

  /// No description provided for @secretDeleteFailed.
  ///
  /// In zh, this message translates to:
  /// **'密钥删除失败'**
  String get secretDeleteFailed;

  /// No description provided for @errUnexpected.
  ///
  /// In zh, this message translates to:
  /// **'操作失败：{detail}'**
  String errUnexpected(String detail);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'zh'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
