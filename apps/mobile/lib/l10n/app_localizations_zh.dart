// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appTitle => 'NexNote';

  @override
  String get navVault => '库';

  @override
  String get navSearch => '搜索';

  @override
  String get navCapture => '捕获';

  @override
  String get navAi => 'AI';

  @override
  String get navSettings => '设置';

  @override
  String get vaultTitle => '库';

  @override
  String get vaultTagFilterTooltip => '标签筛选';

  @override
  String get vaultEmpty => '设备知识库为空，先在「设置」里克隆或初始化。';

  @override
  String get vaultRootDir => '根目录';

  @override
  String get vaultUncategorized => '未分类';

  @override
  String get searchTitle => '搜索';

  @override
  String get searchHint => '搜索页面内容（支持中文子串）';

  @override
  String searchResultCount(int count) {
    return '命中 $count 个页面';
  }

  @override
  String get searchInitial => '输入关键词开始搜索';

  @override
  String get searchRebuild => '重建索引';

  @override
  String get searchNoResults => '没有命中结果';

  @override
  String get captureTitle => '捕获';

  @override
  String captureDirectory(String directory) {
    return '落点目录：$directory';
  }

  @override
  String get captureHint => '随手记下想法，首行作为标题';

  @override
  String get captureAction => '捕获';

  @override
  String captureSuccess(String title) {
    return '已捕获：$title';
  }

  @override
  String get captureOpenLast => '打开刚捕获的页面';

  @override
  String get aiTitle => 'AI 对话';

  @override
  String get aiClearTooltip => '清空';

  @override
  String get aiNoProfile => '未配置供应商 Profile（只读对话）';

  @override
  String aiReadOnlySession(String name, String model) {
    return '只读对话 · $name · $model';
  }

  @override
  String get aiEmptyHint => '提问会先做两阶段召回（关键词 + 双链扩展）';

  @override
  String get aiInputHint => '问点什么…';

  @override
  String get aiThinking => '思考中…';

  @override
  String get settingsTitle => '设置';

  @override
  String get settingsDeviceVault => '设备知识库';

  @override
  String settingsPath(String path) {
    return '路径：$path';
  }

  @override
  String settingsPageCount(int count) {
    return '页面数：$count';
  }

  @override
  String get settingsBackupOn => 'iCloud 备份排除：已生效';

  @override
  String get settingsBackupOff => 'iCloud 备份排除：未确认';

  @override
  String settingsUnpushed(int count) {
    return '有 $count 个未推送提交。设备端是这些提交的唯一副本，请尽快同步。';
  }

  @override
  String get settingsGitStatus => 'Git 状态';

  @override
  String get settingsReading => '读取中…';

  @override
  String settingsRemote(String url) {
    return '远端：$url';
  }

  @override
  String get settingsConflictBanner => '同步冲突：手机端已禁写，请在桌面端处理';

  @override
  String get settingsRemoteLabel => '测试远端（file:// 或 https://）';

  @override
  String get settingsClone => '克隆远端';

  @override
  String get settingsWriteAndCommit => '写页面并提交';

  @override
  String get settingsSyncNow => '立即同步';

  @override
  String get settingsTimeline => '版本时间线';

  @override
  String get settingsNoCommits => '（暂无提交）';

  @override
  String get settingsCaptureDir => '快速捕获目录';

  @override
  String get settingsCapturePathLabel => '知识库内相对路径';

  @override
  String get settingsSave => '保存';

  @override
  String get settingsAiProfiles => 'AI 供应商 Profile';

  @override
  String get settingsKeyConfigured => '已配置密钥';

  @override
  String get settingsKeyMissing => '未配置密钥';

  @override
  String get settingsAddProfile => '新增 Profile';

  @override
  String get settingsDiagnosticLog => '诊断日志';

  @override
  String get settingsNoLog => '（暂无日志）';

  @override
  String get settingsBackupExcludeFailed => '备份排除标记写入失败，请检查系统设置';

  @override
  String settingsActionDone(String label) {
    return '$label：完成';
  }

  @override
  String settingsActionFailed(String label, String detail) {
    return '$label：失败 $detail';
  }

  @override
  String get settingsCloneLabel => '克隆';

  @override
  String settingsCommitAppend(String sha) {
    return '提交 $sha';
  }

  @override
  String get settingsNoChange => '（无变更）';

  @override
  String settingsSyncResult(String state, String message) {
    return '同步 $state：$message';
  }

  @override
  String settingsCaptureUpdated(String dir) {
    return '捕获目录已更新为 $dir';
  }

  @override
  String get tagsTitle => '标签';

  @override
  String get tagsEmpty => '暂无标签';

  @override
  String tagsPageCount(int count) {
    return '$count 个页面';
  }

  @override
  String get graphTitle => '图谱';

  @override
  String graphSummary(int nodes, int edges, int unresolved) {
    return '页面 $nodes · 双链 $edges · 未解析 $unresolved（点击页面查看，只读浏览）';
  }

  @override
  String get readerMissing => '页面不存在';

  @override
  String readerTargetMissing(String target) {
    return '目标页面不存在：$target';
  }

  @override
  String get readerOutlineTooltip => '标题目录';

  @override
  String get readerBacklinksTooltip => '反向链接';

  @override
  String get readerTimelineTooltip => '版本时间线';

  @override
  String get readerGraphTooltip => '图谱';

  @override
  String get readerEditTooltip => '编辑';

  @override
  String readerBacklinksButton(int count) {
    return '反向链接（$count）';
  }

  @override
  String get readerNoBacklinks => '暂无反向链接';

  @override
  String get readerNoCommits => '暂无提交记录';

  @override
  String readerType(String value) {
    return '类型 $value';
  }

  @override
  String readerCreated(String value) {
    return '创建 $value';
  }

  @override
  String readerUpdated(String value) {
    return '更新 $value';
  }

  @override
  String readerAliases(String value) {
    return '别名 $value';
  }

  @override
  String readerConfidence(String value) {
    return '置信度 $value';
  }

  @override
  String get blockTitle => '块编辑';

  @override
  String get blockSwitchToSource => '切换到源码模式';

  @override
  String get blockSave => '保存';

  @override
  String get blockConflict => '同步冲突禁写中：请在桌面端解决冲突后重试';

  @override
  String blockFrontmatter(String content) {
    return '元数据头（只读）\n$content';
  }

  @override
  String blockCode(String language) {
    return '代码块$language';
  }

  @override
  String get blockImage => '图片';

  @override
  String get blockTable => '表格（只读）';

  @override
  String get blockMath => '公式（只读）';

  @override
  String get blockHtml => 'HTML（只读）';

  @override
  String get blockEditableInSource => '源码模式可编辑';

  @override
  String get sourceTitle => '源码编辑';

  @override
  String get sourceSwitchToBlock => '切换到块编辑模式';

  @override
  String get sourceSave => '保存';

  @override
  String get sourceConflict => '同步冲突禁写中：请在桌面端解决冲突后重试';

  @override
  String get sourceFrontmatter => '元数据头（只读）';

  @override
  String get saveAutoCommit => '已保存，将自动提交';

  @override
  String get saveNoChange => '内容未变化';

  @override
  String saveFailed(String message) {
    return '保存失败：$message';
  }

  @override
  String get mdMathReadonly => '公式（只读）';

  @override
  String get mdImageAlt => '图片';

  @override
  String mdImageMissing(String alt, String src) {
    return '图片：$alt（$src）';
  }

  @override
  String get mdImagePlaceholder => '[图片]';

  @override
  String mdImagePlaceholderAlt(String alt) {
    return '[图片:$alt]';
  }

  @override
  String get profileRequired => '名称与 base-url 必填';

  @override
  String get profileAdd => '新增 Profile';

  @override
  String get profileEdit => '编辑 Profile';

  @override
  String get profileName => '名称';

  @override
  String get profileModel => '模型名';

  @override
  String get profileApiKey => 'API Key';

  @override
  String get profileApiKeyKeep => 'API Key（留空则不改动）';

  @override
  String get profileCancel => '取消';

  @override
  String get profileSave => '保存';

  @override
  String get errNoProfile => '未配置供应商 Profile，请先在设置中配置';

  @override
  String get errNoApiKey => '该 Profile 未配置 API Key';

  @override
  String get syncInProgress => '同步进行中';

  @override
  String get syncFetching => '拉取远端…';

  @override
  String get syncRebasing => '整合远端变更…';

  @override
  String get syncPushing => '推送本地变更…';

  @override
  String get syncDone => '同步完成';

  @override
  String get syncUpToDate => '已是最新';

  @override
  String get syncNothingToPush => '本地无新提交';

  @override
  String get syncDirtyRejected => '知识库有未提交变更，已跳过自动同步';

  @override
  String get gitNotInitialized => '尚未初始化 Git';

  @override
  String get gitConflictSummary => '同步冲突：请在桌面端处理后重新同步';

  @override
  String gitStatusSummary(String branch, int changed, int ahead, int behind) {
    return '$branch · 变更 $changed · 领先 $ahead · 落后 $behind';
  }

  @override
  String get recallKeyword => '关键词';

  @override
  String get recallLinks => '双链扩展';

  @override
  String get captureEmpty => '内容为空';

  @override
  String get captureUntitled => '未命名捕获';

  @override
  String get settingsLanguage => '界面语言';

  @override
  String get settingsLanguageSystem => '跟随系统';

  @override
  String get settingsLanguageZh => '简体中文';

  @override
  String get settingsLanguageEn => 'English';

  @override
  String get syncStateIdle => '空闲';

  @override
  String get syncStateRunning => '进行中';

  @override
  String get syncStateUpToDate => '已是最新';

  @override
  String get syncStateAhead => '待推送';

  @override
  String get syncStateConflict => '冲突';

  @override
  String get syncStateError => '失败';

  @override
  String get gitErrNotInitialized => '知识库尚未初始化 Git';

  @override
  String get gitErrVaultNotEmpty => '知识库目录非空，拒绝 clone';

  @override
  String get gitErrNoChanges => '没有可提交的变更';

  @override
  String get gitErrConflictBlocked => '同步冲突禁写中：请在桌面端解决冲突并同步后重试';

  @override
  String get gitErrCredentialsMissing => '未配置远端凭证（请在设置中填写）';

  @override
  String get gitErrNetwork => '网络请求失败';

  @override
  String get gitErrAuth => '远端鉴权失败';

  @override
  String get gitErrCertificate => '远端主机证书或主机密钥校验失败';

  @override
  String get gitErrRemoteRejected => '远端拒绝了请求';

  @override
  String get gitErrOperation => 'Git 操作失败';

  @override
  String messageWithDetail(String message, String detail) {
    return '$message（$detail）';
  }

  @override
  String errProviderNetwork(String detail) {
    return '网络请求失败：$detail';
  }

  @override
  String errProviderHttp(String detail) {
    return '供应商返回 HTTP $detail';
  }

  @override
  String errProviderUnexpected(String detail) {
    return '供应商请求失败：$detail';
  }

  @override
  String get secretWriteFailed => '密钥写入失败';

  @override
  String get secretDeleteFailed => '密钥删除失败';

  @override
  String errUnexpected(String detail) {
    return '操作失败：$detail';
  }
}
