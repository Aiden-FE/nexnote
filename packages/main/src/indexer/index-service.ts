import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import type { Backlink, GraphSnapshot, IndexStatus, PageIndexSummary, PageJumpResult, SearchHit, TagIndexEntry } from '@nexnote/shared';
import { parsePageMarkdown, type ParsedPage } from './markdown-indexer';

const SCHEMA_VERSION = 3;
type Db = Database.Database;

function emptyStatus(): IndexStatus { return { phase: 'idle', pagesTotal: 0, pagesIndexed: 0, mode: 'full' }; }
function escLike(value: string): string { return value.replace(/[\\%_]/g, (char) => `\\${char}`); }

// ── CJK/拉丁 FTS 分析器 ─────────────────────────────────────────
// unicode61 把连续中文当作一个 token，子串（如“搜索基准”里的“基准”）无法前缀命中。
// 为 CJK run 建 unigram + bigram 索引，查询用 bigram AND，既支持中文子串又走 FTS（无全表 LIKE 扫描）。
const CJK = '\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF';
const TOKEN_RE = new RegExp(`([${CJK}]+)|([a-z0-9]+)`, 'g');
function quoteToken(token: string): string { return `"${token.replace(/"/g, '""')}"`; }
/** 索引侧：CJK run → unigram+bigram；拉丁/数字 → 小写词。 */
function ftsIndexTokens(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(lower)) !== null) {
    if (m[1]) {
      const run = m[1];
      for (let i = 0; i < run.length; i += 1) tokens.push(run[i]!);
      for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run.slice(i, i + 2));
    } else if (m[2]) {
      tokens.push(m[2]);
    }
  }
  return tokens;
}
/** 查询侧：CJK run（≥2）→ bigram AND；单字 → unigram；拉丁词 → 前缀匹配。 */
function ftsQueryExpr(query: string): string {
  const terms: string[] = [];
  const lower = query.toLowerCase();
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(lower)) !== null) {
    if (m[1]) {
      const run = m[1];
      if (run.length === 1) terms.push(quoteToken(run));
      else for (let i = 0; i + 1 < run.length; i += 1) terms.push(quoteToken(run.slice(i, i + 2)));
    } else if (m[2]) {
      terms.push(`${quoteToken(m[2])}*`);
    }
  }
  return terms.join(' AND ');
}
/** 在命中块内容中按词定位，返回 block-local 上下文片段。 */
function blockLocalSnippet(content: string, terms: string[]): string {
  if (!content) return '';
  const lower = content.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at >= 0 && (idx === -1 || at < idx)) idx = at;
  }
  if (idx === -1) return '';
  const lead = 40;
  const start = Math.max(0, idx - lead);
  const end = Math.min(content.length, idx + terms[0]!.length + 100);
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
}


/** Canonical vault-relative path, or null for absolute/traversal input. */
function vaultRelativePath(root: string, relPath: string): string | null {
  if (!relPath || path.isAbsolute(relPath)) return null;
  const resolved = path.resolve(root, relPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/** 围绕 source_text 在 source_block.content_text 中取 ±60 字符的上下文片段。 */
function snippetAround(blockText: string, sourceText: string): string {
  if (!blockText) return sourceText;
  const i = blockText.indexOf(sourceText);
  const center = i >= 0 ? i : 0;
  const start = Math.max(0, center - 60);
  const end = Math.min(blockText.length, center + sourceText.length + 60);
  return `${start > 0 ? '…' : ''}${blockText.slice(start, end)}${end < blockText.length ? '…' : ''}`;
}

export class LinkIndexService {
  private db: Db | null = null;
  private root: string | null = null;
  private _status: IndexStatus = emptyStatus();

  constructor(private readonly onStatus: (status: IndexStatus) => void = () => undefined) {}

  private publish(status: IndexStatus): void {
    this._status = status;
    this.onStatus(this.status);
  }
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private rebuildScheduled = false;
  private pendingPaths = new Set<string>();

  get status(): IndexStatus { return { ...this._status }; }
  setRoot(root: string | null): void {
    if (this.root === root) return;
    this.close(); this.root = root;
    if (root) this.openAndEnsure();
  }
  close(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); this.pendingPaths.clear(); this.rebuildScheduled = false; this.db?.close(); this.db = null; this.root = null; this._status = emptyStatus(); }
  private requireRoot(): string { if (!this.root) throw Object.assign(new Error('尚未打开任何 vault'), { code: 'NO_VAULT' }); return this.root; }
  private openAndEnsure(): void {
    const root = this.requireRoot(); const dir = path.join(root, '.nexnote'); mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'index.db'); this.db = new Database(dbPath); this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.migrate();
    // 派生缓存：每次打开 vault 与文件系统做一次权威全量同步。
    this.rebuild();
  }
  private migrate(): void {
    const db = this.db!; const version = db.pragma('user_version', { simple: true }) as number;
    if (version >= SCHEMA_VERSION) return;
    if (version < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', created_at TEXT, updated_at TEXT, hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, source_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, target_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL, target_raw TEXT NOT NULL, target_name TEXT NOT NULL, link_type TEXT NOT NULL DEFAULT 'wiki', anchor TEXT);
        CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, tag_name TEXT NOT NULL, tag_path TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS blocks (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, block_id TEXT, block_type TEXT NOT NULL, content_text TEXT NOT NULL, position INTEGER NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS pages_path_idx ON pages(path);
        CREATE INDEX IF NOT EXISTS links_target_idx ON links(target_page_id);
        CREATE INDEX IF NOT EXISTS links_source_idx ON links(source_page_id);
        CREATE INDEX IF NOT EXISTS tags_name_idx ON tags(tag_name);
        CREATE INDEX IF NOT EXISTS blocks_id_idx ON blocks(block_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(path UNINDEXED, title, aliases, tags, content);
      `);
    }
    if (version < 2) {
      // 反链上下文与同名标签去重需要的扩展列。旧库加列后立即 REBUILD 重建。
      db.exec(`
        ALTER TABLE links ADD COLUMN source_block_id INTEGER REFERENCES blocks(id) ON DELETE SET NULL;
        ALTER TABLE links ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
        UPDATE links SET source_text = target_raw WHERE source_text = '';
      `);
    }
    if (version < 3) {
      // 派生缓存可重建：升级为「原始列 UNINDEXED + CJK 感知 tok 列」的 FTS 表。
      db.exec(`
        DROP TABLE IF EXISTS page_fts;
        CREATE VIRTUAL TABLE page_fts USING fts5(path UNINDEXED, title UNINDEXED, aliases UNINDEXED, tags UNINDEXED, content UNINDEXED, tok);
      `);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  private allMarkdownFiles(): string[] {
    const root = this.requireRoot(); const found: string[] = [];
    const walk = (rel: string): void => { for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) { if (['.nexnote','.git','.trash','node_modules'].includes(ent.name)) continue; const next = rel ? `${rel}/${ent.name}` : ent.name; if (ent.isDirectory()) walk(next); else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) found.push(next); } };
    walk(''); return found.sort();
  }
  rebuild(): IndexStatus {
    const root = this.requireRoot();
    let files: string[];
    try { files = this.allMarkdownFiles(); }
    catch (e) { this.publish({ phase: 'error', pagesTotal: 0, pagesIndexed: 0, mode: 'full', error: e instanceof Error ? e.message : String(e) }); return this.status; }
    this.publish({ phase: 'scanning', pagesTotal: files.length, pagesIndexed: 0, mode: 'full' });
    // 单个文件读取/解析失败不阻断全库重建（派生缓存尽力而为），错误集中到 transaction/边界。
    const pages: ParsedPage[] = [];
    for (const file of files) {
      try { pages.push(parsePageMarkdown(file, readFileSync(path.join(root, file), 'utf8'))); }
      catch { /* 跳过不可读/损坏文件 */ }
    }
    const db = this.db!; const run = db.transaction(() => { db.exec('DELETE FROM page_fts; DELETE FROM links; DELETE FROM tags; DELETE FROM blocks; DELETE FROM pages;'); for (const page of pages) { this.upsertPage(page, false); this._status.pagesIndexed += 1; if (this._status.pagesIndexed % 25 === 0 || this._status.pagesIndexed === files.length) this.onStatus(this.status); } this.resolveLinks(); });
    try { run(); this.publish({ phase: 'ready', pagesTotal: files.length, pagesIndexed: files.length, mode: 'full' }); } catch (e) { this.publish({ ...this._status, phase: 'error', error: e instanceof Error ? e.message : String(e) }); }
    return this.status;
  }
  /**
   * 防抖增量更新；`sourceRoot` 为事件发出时刻的 vault 根（来自 watcher / IPC），
   * 实际执行时若 root 已切换则丢弃，防止旧 vault 事件以新 root 重新索引。
   */
  scheduleUpdate(relPath: string, sourceRoot: string | null = this.root): void {
    if (!sourceRoot) return;
    const safePath = vaultRelativePath(sourceRoot, relPath);
    if (!safePath || !safePath.toLowerCase().endsWith('.md') || this.rebuildScheduled) return;
    this.pendingPaths.add(safePath);
    const key = '__updates__'; const prior = this.timers.get(key); if (prior) clearTimeout(prior);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      const paths = [...this.pendingPaths]; this.pendingPaths.clear();
      this.updateFiles(paths, sourceRoot);
    }, 160));
  }
  /** Coalesce directory churn into one rebuild rather than resolving links per descendant. */
  scheduleRebuild(sourceRoot: string | null = this.root): void {
    if (!sourceRoot) return;
    this.rebuildScheduled = true;
    this.pendingPaths.clear();
    const updateTimer = this.timers.get('__updates__'); if (updateTimer) clearTimeout(updateTimer); this.timers.delete('__updates__');
    const key = '__rebuild__'; const prior = this.timers.get(key); if (prior) clearTimeout(prior);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      try { if (this.root === sourceRoot) this.rebuild(); } finally { this.rebuildScheduled = false; }
    }, 200));
  }
  updateFile(relPath: string, sourceRoot: string | null = this.root): void { this.updateFiles([relPath], sourceRoot); }
  private updateFiles(relPaths: string[], sourceRoot: string | null): void {
    if (!this.root || this.root !== sourceRoot) return; // switch/close drops stale batches
    const root = this.requireRoot();
    const paths = [...new Set(relPaths.map((value) => vaultRelativePath(root, value)).filter((value): value is string => !!value && value.toLowerCase().endsWith('.md')))];
    if (paths.length === 0) return;
    this.publish({ phase: 'scanning', pagesTotal: paths.length, pagesIndexed: 0, currentFile: paths[0], mode: 'incremental' });
    const db = this.db!;
    const run = db.transaction(() => {
      for (const safePath of paths) {
        const abs = path.join(root, safePath);
        if (!existsSync(abs)) this.deletePath(safePath);
        else {
          try { this.upsertPage(parsePageMarkdown(safePath, readFileSync(abs, 'utf8')), false); }
          catch { /* 跳过不可读/损坏文件，其余批次照常 */ }
        }
      }
      this.resolveLinks(); // once per debounce batch, not once per file
    });
    try { run(); this.publish({ phase: 'ready', pagesTotal: paths.length, pagesIndexed: paths.length, mode: 'incremental' }); } catch (e) { this.publish({ ...this._status, phase: 'error', error: e instanceof Error ? e.message : String(e) }); }
  }
  private deletePath(relPath: string): void { const db = this.db!; const row = db.prepare('SELECT id FROM pages WHERE path=?').get(relPath) as { id: number } | undefined; if (!row) return; db.prepare('DELETE FROM page_fts WHERE path=?').run(relPath); db.prepare('DELETE FROM pages WHERE id=?').run(row.id); }
  private upsertPage(page: ParsedPage, resolve = true): void {
    const db = this.db!; const old = db.prepare('SELECT id, hash FROM pages WHERE path=?').get(page.path) as { id:number; hash:string } | undefined; if (old?.hash === page.hash) return;
    if (old) { db.prepare('DELETE FROM page_fts WHERE path=?').run(page.path); db.prepare('DELETE FROM links WHERE source_page_id=?').run(old.id); db.prepare('DELETE FROM tags WHERE page_id=?').run(old.id); db.prepare('DELETE FROM blocks WHERE page_id=?').run(old.id); }
    db.prepare(`INSERT INTO pages(path,title,aliases,created_at,updated_at,hash) VALUES(?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET title=excluded.title,aliases=excluded.aliases,created_at=excluded.created_at,updated_at=excluded.updated_at,hash=excluded.hash`).run(page.path,page.title,JSON.stringify(page.aliases),page.createdAt,page.updatedAt,page.hash);
    const id = (db.prepare('SELECT id FROM pages WHERE path=?').get(page.path) as {id:number}).id;
    const block = db.prepare('INSERT INTO blocks(page_id,block_id,block_type,content_text,position) VALUES(?,?,?,?,?)');
    const blockIdRows: number[] = []; // index = position
    for (const item of page.blocks) {
      const result = block.run(id,item.blockId,item.blockType,item.content,item.position);
      blockIdRows[item.position] = Number(result.lastInsertRowid);
    }
    const linkInsert = db.prepare('INSERT INTO links(source_page_id,target_page_id,target_raw,target_name,link_type,anchor,source_block_id,source_text) VALUES(?,?,?,?,?,?,?,?)');
    for (const item of page.links) {
      const sourceBlockId = blockIdRows[item.sourceBlockIndex] ?? null;
      linkInsert.run(id,null,item.targetRaw,item.targetName,item.linkType,item.anchor,sourceBlockId,item.sourceText);
    }
    const tag = db.prepare('INSERT INTO tags(page_id,tag_name,tag_path) VALUES(?,?,?)'); for (const value of page.tags) tag.run(id,value,value);
    const tok = ftsIndexTokens([page.title, page.aliases.join(' '), page.tags.join(' '), page.body].join('\n')).join(' ');
    db.prepare('INSERT INTO page_fts(path,title,aliases,tags,content,tok) VALUES(?,?,?,?,?,?)').run(page.path,page.title,page.aliases.join(' '),page.tags.join(' '),page.body,tok);
    if (resolve) this.resolveLinks();
  }
  /** Resolve target; priority required by spec: alias > title > filename/path. */
  private resolveLinks(): void {
    const db = this.db!;
    const pages = db.prepare('SELECT id,path,title,aliases FROM pages').all() as Array<{ id: number; path: string; title: string; aliases: string }>;
    // 精确 vault 相对 stem（含子目录）→ id。普通链接已归一化到 stem，wiki 的 [[dir/name]] 也走这里。
    const byPath = new Map<string, number>();
    for (const page of pages) byPath.set(page.path.replace(/\.md$/i, '').toLowerCase(), page.id);
    // basename：同名 basename 跨多个目录时为歧义，不武断 last-win（保持红链）。
    const basenameOwners = new Map<string, Set<number>>();
    const ownerOf = (map: Map<string, Set<number>>, key: string, id: number): void => {
      let set = map.get(key); if (!set) { set = new Set(); map.set(key, set); }
      set.add(id);
    };
    for (const page of pages) ownerOf(basenameOwners, path.posix.basename(page.path, path.posix.extname(page.path)).toLowerCase(), page.id);
    const uniqueBasename = new Map<string, number>();
    for (const [key, owners] of basenameOwners) if (owners.size === 1) uniqueBasename.set(key, [...owners][0]!);
    // alias / title：多页声明同名时为歧义，唯一时才解析（优先级 alias > title）。
    const aliasOwners = new Map<string, Set<number>>();
    const titleOwners = new Map<string, Set<number>>();
    for (const page of pages) {
      ownerOf(titleOwners, page.title.toLowerCase(), page.id);
      for (const alias of JSON.parse(page.aliases) as string[]) ownerOf(aliasOwners, alias.toLowerCase(), page.id);
    }
    const unique = (map: Map<string, Set<number>>, key: string): number | null => {
      const owners = map.get(key); return owners && owners.size === 1 ? [...owners][0]! : null;
    };
    const update = db.prepare('UPDATE links SET target_page_id=? WHERE id=?');
    for (const link of db.prepare('SELECT id,target_name FROM links').all() as Array<{ id: number; target_name: string }>) {
      const name = link.target_name.toLowerCase();
      let target: number | null;
      if (name.includes('/')) {
        // 路径化目标：仅精确 stem 命中，绝不 basename 误匹配其他目录。
        target = byPath.get(name) ?? null;
      } else {
        // 短名：alias > title > 唯一 basename；歧义一律留红链。
        target = unique(aliasOwners, name) ?? unique(titleOwners, name) ?? uniqueBasename.get(name) ?? null;
      }
      update.run(target, link.id);
    }
  }
  backlinks(pagePath: string): Backlink[] {
    const db = this.db!;
    const target = db.prepare('SELECT id FROM pages WHERE path=?').get(pagePath) as { id: number } | undefined;
    if (!target) return [];
    type Row = {
      fromPath: string;
      fromTitle: string;
      linkType: 'wiki' | 'normal';
      anchor: string | null;
      sourceText: string;
      sourceBlockId: number | null;
      blockContent: string | null;
      blockId: string | null;
      blockPosition: number | null;
    };
    const rows = db.prepare(`SELECT p.path fromPath,p.title fromTitle,l.link_type linkType,COALESCE(l.anchor,'') anchor,COALESCE(l.source_text,'') sourceText,l.source_block_id sourceBlockId,b.content_text blockContent,b.block_id blockId,b.position blockPosition FROM links l JOIN pages p ON p.id=l.source_page_id LEFT JOIN blocks b ON b.id=l.source_block_id WHERE l.target_page_id=? ORDER BY p.title, COALESCE(b.position,-1)`).all(target.id) as Row[];
    return rows.map((row) => {
      const blockText = row.blockContent ?? '';
      const sourceText = row.sourceText || row.fromPath;
      return {
        fromPath: row.fromPath,
        fromTitle: row.fromTitle,
        snippet: snippetAround(blockText, sourceText),
        blockId: row.blockId,
        blockPosition: row.blockPosition ?? -1,
        sourceText,
        linkType: row.linkType,
        anchor: row.anchor ?? '',
        targetExists: true,
      };
    });
  }
  /**
   * FTS 全文搜索（CJK 感知）：
   * - 主路径 FTS5（tok 列：CJK unigram+bigram、拉丁前缀），中文子串也走 FTS，无全表 LIKE 扫描。
   * - 仅当 FTS 抛错（malformed）才回退有界 LIKE；FTS 成功（即使 0 行）不做 unbounded leading-wildcard LIKE。
   * - tier 为 term-wise：每个词按 title>tag>alias>content 累积命中；排序前不 cap，最后才 slice(limit)。
   */
  search(query: string, limit = 50): SearchHit[] {
    const needle = query.trim().replace(/^#+/, '');
    if (!needle) return [];
    const db = this.db!;
    type RawHit = { path: string; title: string; aliases: string; tags: string; content: string; rank: number };
    let rows: RawHit[] = [];
    let ftsOk = false;
    const expr = ftsQueryExpr(needle);
    if (expr) {
      try {
        rows = db.prepare('SELECT path,title,aliases,tags,content,-bm25(page_fts) rank FROM page_fts WHERE page_fts MATCH ?').all(expr) as RawHit[];
        ftsOk = true;
      } catch (e) {
        this.onStatus({ ...this._status, phase: this._status.phase, error: 'search fts: ' + (e instanceof Error ? e.message : String(e)) });
      }
    }
    if (!ftsOk) {
      // 仅 FTS 异常时的兼容回退（FTS 正常不触发，避免千页级全表 %LIKE% 扫描）。
      try {
        const lt = needle.toLowerCase().split(/\s+/).filter(Boolean);
        const clauses = lt.map(() => "(lower(title) LIKE ? ESCAPE '\\' OR lower(aliases) LIKE ? ESCAPE '\\' OR lower(tags) LIKE ? ESCAPE '\\' OR lower(content) LIKE ? ESCAPE '\\')").join(' AND ');
        const values = lt.flatMap((term) => Array(4).fill('%' + escLike(term) + '%'));
        rows = db.prepare('SELECT path,title,aliases,tags,content,0 rank FROM page_fts WHERE ' + clauses).all(...values) as RawHit[];
      } catch (e) {
        this.onStatus({ ...this._status, phase: this._status.phase, error: 'search like: ' + (e instanceof Error ? e.message : String(e)) });
      }
    }
    const merged = new Map<string, RawHit>();
    for (const r of rows) {
      if (!merged.has(r.path)) merged.set(r.path, r);
    }
    const terms = needle.toLowerCase().split(/\s+/).filter(Boolean);
    const every = (field: string): boolean => terms.every((t) => field.includes(t));
    const order: Record<SearchHit['tier'], number> = { title: 0, tag: 1, alias: 2, content: 3 };
    // term-wise 分层（排序前不 cap），随后一次性批量取正文块（单查询，避免 N+1）。
    const prelim = [...merged.values()].map((r) => {
      const title = r.title.toLowerCase();
      const tags = title + '\n' + r.tags.toLowerCase();
      const aliases = tags + '\n' + r.aliases.toLowerCase();
      const tier: SearchHit['tier'] = every(title) ? 'title' : every(tags) ? 'tag' : every(aliases) ? 'alias' : 'content';
      return { r, tier };
    });
    const blockMap = this.contentBlocksFor(db, prelim.filter((p) => p.tier === 'content').map((p) => p.r.path), terms);
    const hits = prelim.map(({ r, tier }): SearchHit => {
      const block = tier === 'content' ? blockMap.get(r.path) : undefined;
      const content = block?.content ?? r.content;
      const snippet = blockLocalSnippet(content, terms);
      return { path: r.path, title: r.title, tier, snippet, blockId: block?.blockId ?? undefined, rank: r.rank };
    });
    return hits.sort((a, b) => order[a.tier] - order[b.tier] || b.rank - a.rank).slice(0, limit);
  }

  /** 单查询批量取命中正文块：范围仅限候选页（有界），块需包含全部词（CJK 子串 LIKE）。 */
  private contentBlocksFor(db: Db, paths: string[], terms: string[]): Map<string, { blockId: string | null; content: string }> {
    const map = new Map<string, { blockId: string | null; content: string }>();
    if (paths.length === 0 || terms.length === 0) return map;
    const placeholders = paths.map(() => '?').join(',');
    const termClauses = terms.map(() => "lower(b.content_text) LIKE ? ESCAPE '\\'").join(' AND ');
    const sql = 'SELECT p.path path, b.block_id blockId, b.content_text content FROM blocks b JOIN pages p ON p.id = b.page_id WHERE p.path IN (' + placeholders + ') AND ' + termClauses + ' ORDER BY p.path, b.position';
    const values = [...paths, ...terms.map((t) => '%' + escLike(t) + '%')];
    for (const row of db.prepare(sql).all(...values) as Array<{ path: string; blockId: string | null; content: string }>) {
      if (!map.has(row.path)) map.set(row.path, { blockId: row.blockId, content: row.content });
    }
    return map;
  }

  jumpTo(query: string, limit = 20): PageJumpResult[] {
    type JumpRow = { path: string; title: string; aliases: string };
    const lowered = query.trim().toLowerCase(); if (!lowered) return [];
    const escaped = escLike(lowered); const q = `%${escaped}%`; const prefix = `${escaped}%`;
    const rows = this.db!.prepare("SELECT path,title,aliases FROM pages WHERE lower(title) LIKE ? ESCAPE '\\' OR lower(aliases) LIKE ? ESCAPE '\\' OR lower(path) LIKE ? ESCAPE '\\' ORDER BY CASE WHEN lower(title) LIKE ? ESCAPE '\\' THEN 0 WHEN lower(aliases) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,title LIMIT ?").all(q, q, q, prefix, prefix, limit) as JumpRow[];
    return rows.map((page) => ({ path: page.path, title: page.title, subtitle: page.path, match: page.title.toLowerCase().includes(lowered) ? 'title' : (JSON.parse(page.aliases) as string[]).some((alias) => alias.toLowerCase().includes(lowered)) ? 'alias' : 'path' }));
  }
  tags(flat = false): TagIndexEntry[] {
    const db = this.db!;
    const leafRows = db.prepare('SELECT tag_name tag,COUNT(DISTINCT page_id) pageCount FROM tags GROUP BY tag_name').all() as Array<{ tag: string; pageCount: number }>;
    // nodeToPages: 每个节点(叶或中间前缀) → 命中该 tag 或其后代的 distinct page 集合
    const nodeToPages = new Map<string, Set<number>>();
    const pagesByTag = db.prepare('SELECT DISTINCT page_id, tag_name FROM tags').all() as Array<{ page_id: number; tag_name: string }>;
    for (const { page_id, tag_name } of pagesByTag) {
      const parts = tag_name.split('/');
      let acc = '';
      for (let i = 0; i < parts.length; i += 1) {
        acc = i === 0 ? parts[i] ?? '' : `${acc}/${parts[i] ?? ''}`;
        let set = nodeToPages.get(acc); if (!set) { set = new Set(); nodeToPages.set(acc, set); }
        set.add(page_id);
      }
    }
    if (flat) return leafRows.map((r) => ({ tag: r.tag, pageCount: r.pageCount, descendantPageCount: r.pageCount, path: r.tag.split('/') }));
    const out = new Map<string, TagIndexEntry>();
    for (const r of leafRows) {
      out.set(r.tag, { tag: r.tag, pageCount: r.pageCount, descendantPageCount: r.pageCount, path: r.tag.split('/') });
    }
    for (const [prefix, pages] of nodeToPages) {
      const existing = out.get(prefix);
      if (existing) existing.descendantPageCount = Math.max(existing.descendantPageCount, pages.size);
      else out.set(prefix, { tag: prefix, pageCount: 0, descendantPageCount: pages.size, path: prefix.split('/'), isIntermediate: true });
    }
    return [...out.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  }
  /** 返回命中该 tag 或其任意后代 tag 的页面路径（子树过滤）。 */
  tagPages(tag: string): string[] {
    return (this.db!.prepare("SELECT DISTINCT p.path FROM tags t JOIN pages p ON p.id=t.page_id WHERE t.tag_name=? OR t.tag_name LIKE ? ESCAPE '\\' ORDER BY p.path").all(tag, `${escLike(tag)}/%`) as Array<{ path: string }>).map((row) => row.path);
  }
  pageSummary(pagePath: string): PageIndexSummary | null {
    type SummaryRow = { id: number; path: string; title: string; aliases: string; updated_at: string | null; blockCount: number; wordCount: number };
    const row = this.db!.prepare(`SELECT p.id id,p.path path,p.title title,p.aliases aliases,p.updated_at updated_at,COUNT(DISTINCT b.id) blockCount,COALESCE(SUM(LENGTH(b.content_text)-LENGTH(REPLACE(b.content_text,' ',''))+1),0) wordCount FROM pages p LEFT JOIN blocks b ON b.page_id=p.id WHERE p.path=? GROUP BY p.id`).get(pagePath) as SummaryRow | undefined;
    if (!row) return null;
    const tags = (this.db!.prepare('SELECT tag_name FROM tags t JOIN pages p ON p.id=t.page_id WHERE p.path=? ORDER BY tag_name').all(pagePath) as Array<{ tag_name: string }>).map((item) => item.tag_name);
    const inboundLinks = (this.db!.prepare('SELECT COUNT(DISTINCT source_page_id) c FROM links WHERE target_page_id=?').get(row.id) as { c: number }).c;
    const outboundLinks = (this.db!.prepare('SELECT COUNT(DISTINCT target_page_id) c FROM links WHERE source_page_id=? AND target_page_id IS NOT NULL').get(row.id) as { c: number }).c;
    return { path: row.path, title: row.title, aliases: JSON.parse(row.aliases) as string[], tags, updatedAt: row.updated_at ?? '', wordCount: row.wordCount, blockCount: row.blockCount, inboundLinks, outboundLinks };
  }

  graph(): GraphSnapshot {
    const db = this.db;
    if (!db) return { pages: [], links: [] };
    type PageRow = {
      path: string;
      title: string;
      tags: string | null;
      inboundLinks: number;
      outboundLinks: number;
    };
    const pages = (
      db.prepare(`
        SELECT p.path, p.title,
          (SELECT GROUP_CONCAT(DISTINCT t.tag_name) FROM tags t WHERE t.page_id = p.id) tags,
          (SELECT COUNT(DISTINCT l.source_page_id) FROM links l WHERE l.target_page_id = p.id) inboundLinks,
          (SELECT COUNT(DISTINCT l.target_page_id) FROM links l WHERE l.source_page_id = p.id AND l.target_page_id IS NOT NULL) outboundLinks
        FROM pages p
        ORDER BY p.path
      `).all() as PageRow[]
    ).map((row) => ({
      path: row.path,
      title: row.title,
      folder: row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '',
      tags: row.tags ? row.tags.split(',').filter(Boolean).sort() : [],
      inboundLinks: row.inboundLinks ?? 0,
      outboundLinks: row.outboundLinks ?? 0,
    }));
    type LinkRow = { source: string; target: string };
    const links = db.prepare(`
      SELECT DISTINCT source.path source, target.path target
      FROM links l
      JOIN pages source ON source.id = l.source_page_id
      JOIN pages target ON target.id = l.target_page_id
      ORDER BY source.path, target.path
    `).all() as LinkRow[];
    return { pages, links };
  }

  /** Testing hook: delete cache and make a new service auto rebuild at same root. */
  static removeDatabase(root: string): void { rmSync(path.join(root,'.nexnote','index.db'),{force:true}); rmSync(path.join(root,'.nexnote','index.db-wal'),{force:true}); rmSync(path.join(root,'.nexnote','index.db-shm'),{force:true}); }
}
