import type { SuggestionItem } from '@nexnote/kernel';
import { invoke } from '../lib/ipc';
import { useIndexStore } from '../stores/index-store';
import { usePageTreeStore } from '../stores/page-tree-store';
import { sanitizePageTitle, titleFromPath } from './title-sync';
import type { PageCandidate } from './interactions/suggestions';

/**
 * 双链补全共用页面数据源（DEV-017 引入于块编辑、DEV-024 复用于源码模式）：
 * 页面树 .md 文件 + 关系索引的 frontmatter 别名。
 */
export function currentPageCandidates(): PageCandidate[] {
  const summaries = useIndexStore.getState().pageSummaries;
  return usePageTreeStore
    .getState()
    .entries.filter((e) => e.kind === 'file' && e.path.toLowerCase().endsWith('.md'))
    .map((e) => ({
      path: e.path,
      title: titleFromPath(e.path),
      aliases: summaries[e.path]?.aliases ?? [],
    }));
}

/**
 * 红链回车创建：原子 create-if-absent 写入 `# 标题` 初始页；已存在则不动（不覆盖）。
 * 页面创建失败不阻塞插入（链接仍指向未来的页面），但真实错误需可见。
 */
export function createRedlinkPage(item: SuggestionItem): void {
  if (item.meta !== 'uncreated') return;
  const target = item.insert?.target ?? item.id;
  const pageName = target.split('#')[0] || target;
  // 逐段清洗保留 folder/Page 嵌套路径（整体清洗会把 '/' 换成 '-'）
  const segments = pageName.split('/').map((seg) => sanitizePageTitle(seg));
  const nextPath = `${segments.join('/')}.md`;
  void invoke('fs:createTextFile', {
    path: nextPath,
    content: `# ${segments.at(-1) ?? titleFromPath(nextPath)}\n\n`,
    createParentDirs: true,
  }).catch((e) => {
    console.error('[wikilink] 红链页面创建失败', e);
  });
}
