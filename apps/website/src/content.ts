/**
 * Single source of product facts for every prototype.
 *
 * The four visual directions share this content verbatim (features, product
 * scenes, FAQ, download copy); only `directions` carries per-direction
 * narrative. Keep claims aligned with docs/faq.md and the release metadata:
 * no signing/notarization claims, no minimum OS versions, no production domain.
 */

export type Lang = 'en' | 'zh';

export const languages: Lang[] = ['en', 'zh'];

export const themes = ['editorial', 'workbench', 'graph', 'quiet'] as const;

export type ThemeId = (typeof themes)[number];

export function isThemeId(value: string | undefined): value is ThemeId {
  return value !== undefined && (themes as readonly string[]).includes(value);
}

export interface Item {
  title: string;
  body: string;
}

export interface Direction {
  name: string;
  summary: string;
  headline: string;
  visualLabel: string;
}

export interface Copy {
  htmlLang: string;
  switchLabel: string;
  siteTitle: string;
  galleryTitle: string;
  navGallery: string;
  navFeatures: string;
  navScenes: string;
  navFaq: string;
  eyebrow: string;
  lede: string;
  platformNote: string;
  download: string;
  github: string;
  exploreFeatures: string;
  backToGallery: string;
  openPrototype: string;
  featuresHeading: string;
  scenesHeading: string;
  scenesLede: string;
  faqHeading: string;
  placeholder: string;
  fitNote: string;
  ctaHeading: string;
  footerTagline: string;
  footerRights: string;
  footerNote: string;
  directionLabel: string;
  features: Item[];
  faqs: Item[];
}

export interface DirectionCopy {
  name: string;
  summary: string;
  headline: string;
}

export const directionCopy: Record<Lang, Record<ThemeId, DirectionCopy>> = {
  en: {
    editorial: {
      name: 'Editorial Knowledge',
      summary:
        'A reading room for long-form thinking: serif voices, generous margins, and references you can follow.',
      headline: 'Ideas deserve an editorial surface.',
    },
    workbench: {
      name: 'Local-first Workbench',
      summary:
        'A dependable instrument: pages, commits, keyboard-first flows, and AI actions you trigger on purpose.',
      headline: 'A workbench for knowledge you own.',
    },
    graph: {
      name: 'Graph Intelligence',
      summary:
        'The relation index in the foreground: backlinks, confidence, and recall paths you can trace.',
      headline: 'Follow the edges between your ideas.',
    },
    quiet: {
      name: 'Quiet Precision',
      summary:
        'Swiss restraint: hairlines, measured type, and no decoration that competes with your writing.',
      headline: 'Less interface. More signal.',
    },
  },
  zh: {
    editorial: {
      name: 'Editorial Knowledge',
      summary: '为长文思考准备的阅读室：衬线排版、宽阔留白，以及可以一路追随的引用。',
      headline: '想法，值得一个编辑级的界面。',
    },
    workbench: {
      name: 'Local-first Workbench',
      summary: '一件可靠的工具：页面、提交、键盘优先的流程，以及由你显式触发的 AI 操作。',
      headline: '属于你的知识工作台。',
    },
    graph: {
      name: 'Graph Intelligence',
      summary: '把关系索引放到前景：反向链接、置信度，以及可追溯的召回路径。',
      headline: '沿着想法之间的边继续走。',
    },
    quiet: {
      name: 'Quiet Precision',
      summary: '瑞士式克制：细线、精确的字体尺度，没有任何装饰与写作争夺注意力。',
      headline: '更少的界面，更多的信号。',
    },
  },
};

export const copy: Record<Lang, Copy> = {
  en: {
    htmlLang: 'en',
    switchLabel: '中文',
    siteTitle: 'NexNote — local-first knowledge',
    galleryTitle: 'NexNote — prototype gallery',
    navGallery: 'Gallery',
    navFeatures: 'Features',
    navScenes: 'Scenes',
    navFaq: 'FAQ',
    eyebrow: 'Local-first knowledge base',
    lede: 'Block editing, wikilinks, Git history, and an explicit native AI layer — in one calm desktop app that keeps every file on your disk.',
    platformNote: 'macOS (Apple Silicon / Intel) · Windows x64 · Linux x64',
    download: 'Download latest',
    github: 'View on GitHub',
    exploreFeatures: 'Explore features',
    backToGallery: 'All prototypes',
    openPrototype: 'Open prototype',
    featuresHeading: 'One knowledge base, six load-bearing parts.',
    scenesHeading: 'Product scenes',
    scenesLede:
      'Prototype-stage panels rendered from the product structure. They are labelled placeholders, not shipped screenshots.',
    faqHeading: 'Questions, answered.',
    placeholder: 'Internal prototype panel · not a screenshot',
    fitNote: 'Free of accounts, cloud sync, and telemetry.',
    ctaHeading: 'Bring your knowledge home.',
    footerTagline: 'A local-first knowledge base for people who think in links.',
    footerRights: '© 2026 NexNote',
    footerNote: 'Prototype stage — one direction will ship.',
    directionLabel: 'Direction',
    features: [
      {
        title: 'Block editor',
        body: 'Paragraphs, headings, lists, quotes, code, tables, and media behave as draggable, nestable blocks. Files stay standard Markdown on export.',
      },
      {
        title: 'Wikilinks, aliases, backlinks',
        body: 'Reference pages as [[Page|alias]], read linked mentions beside the page, and rename safely — every referring wikilink is rewritten.',
      },
      {
        title: 'Git under the hood',
        body: 'Each vault is a Git repository. Automatic snapshots stay distinguishable from manual commits, with a per-page version timeline and restore.',
      },
      {
        title: 'Native AI layer',
        body: 'Connect any OpenAI-compatible provider with your own base URL, key, and model. AI runs only on explicit intent, streams answers, and cites sources.',
      },
      {
        title: 'Progressive recall',
        body: 'Recall filters by keyword, tag, and metadata, expands through wikilink relationships, then reranks by vector. Retrieval skills are installable and composable.',
      },
      {
        title: 'Local-first format',
        body: 'Plain Markdown in a folder you own, plus a rebuildable relation index in .nexnote/. No account, no cloud sync, no telemetry.',
      },
    ],
    faqs: [
      {
        title: 'Does NexNote need an account or a connection?',
        body: 'No account, no cloud sync. Network is used only for a cloud AI provider, Git remotes, or update checks.',
      },
      {
        title: 'What exactly is a vault?',
        body: 'A normal folder holding your Markdown files, a rebuildable .nexnote/ index, and a .git directory for history.',
      },
      {
        title: 'Can I import an existing Obsidian vault?',
        body: 'Yes. Wikilinks, aliases, tags, callouts, frontmatter, and block anchors are supported; the first open initialises Git and the index without rewriting your notes.',
      },
      {
        title: 'Is my data safe if I uninstall the app?',
        body: 'Uninstalling never touches your vault. Index and AI settings live in the user config directory and can be rebuilt from your files.',
      },
      {
        title: 'How does the Git history stay readable?',
        body: 'Automatic snapshots and manual commits are prefixed differently, the timeline is per page, and automatic commits can be switched off in settings.',
      },
      {
        title: 'Where do I download it, and which platforms are supported?',
        body: 'Builds live on GitHub Releases for macOS (Apple Silicon / Intel), Windows x64, and Linux x64. If macOS blocks the first launch, use right-click → Open, or allow it in Privacy & Security.',
      },
    ],
  },
  zh: {
    htmlLang: 'zh-CN',
    switchLabel: 'English',
    siteTitle: 'NexNote — 本地优先的知识库',
    galleryTitle: 'NexNote — 原型画廊',
    navGallery: '画廊',
    navFeatures: '功能',
    navScenes: '实景',
    navFaq: 'FAQ',
    eyebrow: '本地优先的知识库',
    lede: '块编辑、双链、Git 版本底座与显式原生 AI 层，收进一个从容的桌面应用；所有文件都留在你自己的磁盘上。',
    platformNote: 'macOS（Apple Silicon / Intel）· Windows x64 · Linux x64',
    download: '下载最新版本',
    github: '在 GitHub 查看',
    exploreFeatures: '浏览功能',
    backToGallery: '全部原型',
    openPrototype: '打开原型',
    featuresHeading: '一个知识库，六根承重柱。',
    scenesHeading: '产品实景',
    scenesLede: '按产品结构渲染的原型阶段面板，均明确标注为占位，不是已发布的截图。',
    faqHeading: '常见问题，一次回答。',
    placeholder: '内部原型面板 · 非真实截图',
    fitNote: '没有账号、没有云同步、没有追踪。',
    ctaHeading: '把知识带回本地。',
    footerTagline: '为用链接思考的人打造的本地优先知识库。',
    footerRights: '© 2026 NexNote',
    footerNote: '原型阶段 —— 最终只保留一个方向。',
    directionLabel: '方向',
    features: [
      {
        title: '块编辑',
        body: '段落、标题、列表、引用、代码块、表格与媒体都是可拖拽、可嵌套的块；导出时仍然是标准 Markdown。',
      },
      {
        title: '双链、别名、反向链接',
        body: '用 [[页面|别名]] 建立引用，在页面旁查看引用位置；重命名时，全库指向它的双链会被一并改写。',
      },
      {
        title: 'Git 版本底座',
        body: '每个知识库都是一个 Git 仓库。自动快照与手动提交清晰可辨，并提供按页面的版本时间线与恢复。',
      },
      {
        title: '原生 AI 层',
        body: '接入任意兼容 OpenAI 协议的供应商，自定义 base URL、密钥与模型。只在显式意图下请求，流式返回并标注参考来源。',
      },
      {
        title: '渐进式召回',
        body: '先按关键词、标签与元数据粗筛，再沿双链关系扩展，最后向量重排。检索 Skill 可安装、可组合。',
      },
      {
        title: '本地优先的格式',
        body: 'Markdown 文件放在你自己的文件夹里，关系索引存于 .nexnote/ 且可重建。没有账号、云同步与追踪。',
      },
    ],
    faqs: [
      {
        title: 'NexNote 需要账号或联网吗？',
        body: '不需要账号，也没有云端同步。只有在使用云端 AI 供应商、Git 远程仓库或检查更新时才会联网。',
      },
      {
        title: 'vault 到底是什么？',
        body: '一个普通文件夹，里面是 Markdown 文件、可重建的 .nexnote/ 索引，以及承载历史的 .git 目录。',
      },
      {
        title: '能导入已有的 Obsidian vault 吗？',
        body: '可以。双链、别名、标签、Callout、Frontmatter 与块锚点都受支持；首次打开会初始化 Git 与索引，不会改写你的笔记。',
      },
      {
        title: '卸载应用会丢数据吗？',
        body: '不会。卸载不会触碰 vault；索引与 AI 配置存放在用户配置目录，也可以从你的文件重建。',
      },
      {
        title: 'Git 历史会不会变得难以阅读？',
        body: '自动快照与手动提交使用不同的前缀，时间线按页面呈现，自动提交也可以在设置中关闭。',
      },
      {
        title: '从哪里下载？支持哪些平台？',
        body: '构建产物位于 GitHub Releases，支持 macOS（Apple Silicon / Intel）、Windows x64 与 Linux x64。若 macOS 阻止首次打开，可右键选择“打开”，或在隐私与安全中允许。',
      },
    ],
  },
};

/** External links. No production domain is assumed anywhere on the site. */
export const links = {
  github: 'https://github.com/Aiden-FE/nexnote',
  releases: 'https://github.com/Aiden-FE/nexnote/releases/latest',
} as const;

export const productVersion = 'v0.0.11';

/** Canonical in-site path for a locale, optionally scoped to one prototype. */
export function pathFor(lang: Lang, theme?: ThemeId): string {
  const prefix = lang === 'zh' ? '/zh' : '';
  if (!theme) return prefix || '/';
  return `${prefix}/proto/${theme}`;
}

/** The same route in the other language, used by the explicit language switch. */
export function alternatePath(lang: Lang, theme?: ThemeId): string {
  return pathFor(lang === 'zh' ? 'en' : 'zh', theme);
}
