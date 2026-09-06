import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import type { Backlink, IndexStatus, PageIndexSummary, PageJumpResult, SearchHit, TagIndexEntry } from '@nexnote/shared';
import { parsePageMarkdown, type ParsedPage } from './markdown-indexer';

const SCHEMA_VERSION = 2;
type Db = Database.Database;

function emptyStatus(): IndexStatus { return { phase: 'idle', pagesTotal: 0, pagesIndexed: 0, mode: 'full' }; }
/** 用户查询 → FTS5 前缀短语表达式（去 # 前缀、引号转义、多词 AND）。 */
function escFts(value: string): string {
  return value
    .replace(/"/g, '""')
    .split(/\s+/)
    .map((t) => t.replace(/^#+/, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' AND ');
}
function stem(value: string): string { return value.replace(/\.md$/i, '').replace(/^\.\//, ''); }

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

  get status(): IndexStatus { return { ...this._status }; }
  setRoot(root: string | null): void {
    if (this.root === root) return;
    this.close(); this.root = root;
    if (root) this.openAndEnsure();
  }
  close(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); this.db?.close(); this.db = null; this.root = null; this._status = emptyStatus(); }
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
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  private allMarkdownFiles(): string[] {
    const root = this.requireRoot(); const found: string[] = [];
    const walk = (rel: string): void => { for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) { if (['.nexnote','.git','.trash','node_modules'].includes(ent.name)) continue; const next = rel ? `${rel}/${ent.name}` : ent.name; if (ent.isDirectory()) walk(next); else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) found.push(next); } };
    walk(''); return found.sort();
  }
  rebuild(): IndexStatus {
    const root = this.requireRoot(); const files = this.allMarkdownFiles(); this.publish({ phase: 'scanning', pagesTotal: files.length, pagesIndexed: 0, mode: 'full' });
    const pages = files.map((file) => parsePageMarkdown(file, readFileSync(path.join(root, file), 'utf8')));
    const db = this.db!; const run = db.transaction(() => { db.exec('DELETE FROM page_fts; DELETE FROM links; DELETE FROM tags; DELETE FROM blocks; DELETE FROM pages;'); for (const page of pages) { this.upsertPage(page, false); this._status.pagesIndexed += 1; if (this._status.pagesIndexed % 25 === 0 || this._status.pagesIndexed === files.length) this.onStatus(this.status); } this.resolveLinks(); });
    try { run(); this.publish({ phase: 'ready', pagesTotal: files.length, pagesIndexed: files.length, mode: 'full' }); } catch (e) { this.publish({ ...this._status, phase: 'error', error: e instanceof Error ? e.message : String(e) }); }
    return this.status;
  }
  /**
   * 防抖增量更新；`sourceRoot` 为事件发出时刻的 vault 根（来自 watcher / IPC），
   * 实际执行时若 root 已切换则丢弃，防止旧 vault 事件以新 root 重新索引。
   */
  scheduleUpdate(relPath: string, sourceRoot: string | null = this.root): void {
    if (!relPath.toLowerCase().endsWith('.md')) return;
    if (!sourceRoot) return;
    const prior = this.timers.get(relPath); if (prior) clearTimeout(prior);
    this.timers.set(relPath, setTimeout(() => {
      this.timers.delete(relPath);
      this.updateFile(relPath, sourceRoot);
    }, 160));
  }
  updateFile(relPath: string, sourceRoot: string | null = this.root): void {
    if (!this.root || this.root !== sourceRoot) return; // 切换/关闭后丢弃旧事件
    const root = this.requireRoot(); const abs = path.join(root, relPath); this.publish({ phase: 'scanning', pagesTotal: 1, pagesIndexed: 0, currentFile: relPath, mode: 'incremental' });
    const db = this.db!; const run = db.transaction(() => { if (!existsSync(abs)) this.deletePath(relPath); else this.upsertPage(parsePageMarkdown(relPath, readFileSync(abs, 'utf8')), true); this.resolveLinks(); });
    try { run(); this.publish({ phase: 'ready', pagesTotal: 1, pagesIndexed: 1, mode: 'incremental' }); } catch (e) { this.publish({ ...this._status, phase: 'error', error: e instanceof Error ? e.message : String(e) }); }
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
    db.prepare('INSERT INTO page_fts(path,title,aliases,tags,content) VALUES(?,?,?,?,?)').run(page.path,page.title,page.aliases.join(' '),page.tags.join(' '),page.body);
    if (resolve) this.resolveLinks();
  }
  /** Resolve target; priority required by spec: alias > title > filename/path. */
  private resolveLinks(): void {
    const db = this.db!;
    const pages = db.prepare('SELECT id,path,title,aliases FROM pages').all() as Array<{ id: number; path: string; title: string; aliases: string }>;
    const lookup = new Map<string, number>();
    // Lowest priority first; later writes override collisions.
    for (const page of pages) {
      lookup.set(stem(page.path).toLowerCase(), page.id);
      lookup.set(page.path.replace(/\.md$/i, '').toLowerCase(), page.id);
    }
    for (const page of pages) lookup.set(page.title.toLowerCase(), page.id);
    for (const page of pages) {
      for (const alias of JSON.parse(page.aliases) as string[]) lookup.set(alias.toLowerCase(), page.id);
    }
    const update = db.prepare('UPDATE links SET target_page_id=? WHERE id=?');
    for (const link of db.prepare('SELECT id,target_name FROM links').all() as Array<{ id: number; target_name: string }>) {
      update.run(lookup.get(link.target_name.toLowerCase()) ?? null, link.id);
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
   * FTS 全文搜索：
   * - 主路径 FTS5（含 LIKE 子串补偿以覆盖 unicode61 对连续中文短子串的弱支持）
   * - FTS query 抛错（malformed）不会吞掉 LIKE 结果；LIKE 路径独立 try/catch
   */
  search(query: string, limit = 50): SearchHit[] {
    const needle = query.trim().replace(/^#+/, ''); if (!needle) return [];
    const m = escFts(needle);
    const db = this.db!;
    type RawHit = { path: string; title: string; aliases: string; tags: string; content: string; snippet: string; rank: number };
    let ftsRows: RawHit[] = [];
    if (m) {
      try {
        ftsRows = db.prepare(`SELECT path,title,aliases,tags,content,snippet(page_fts,4,'','', ' … ',12) snippet,-bm25(page_fts) rank FROM page_fts WHERE page_fts MATCH ? LIMIT ?`).all(m, limit * 2) as RawHit[];
      } catch (e) {
        // 记录但不丢弃：保留 LIKE 兜底结果
        this.onStatus({ ...this._status, phase: this._status.phase, error: `search fts: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    let likeRows: RawHit[] = [];
    try {
      const like = `%${needle.toLowerCase()}%`;
      likeRows = db.prepare(`SELECT path,title,aliases,tags,content,'' snippet,0 rank FROM page_fts WHERE lower(title) LIKE ? OR lower(aliases) LIKE ? OR lower(tags) LIKE ? OR lower(content) LIKE ? LIMIT ?`).all(like, like, like, like, limit * 2) as RawHit[];
    } catch (e) {
      this.onStatus({ ...this._status, phase: this._status.phase, error: `search like: ${e instanceof Error ? e.message : String(e)}` });
    }
    const merged = new Map<string, RawHit>(); for (const r of [...ftsRows, ...likeRows]) { if (!merged.has(r.path)) merged.set(r.path, r); }
    const q = needle.toLowerCase(); const order: Record<SearchHit['tier'], number> = { title: 0, tag: 1, alias: 2, content: 3 };
    const hits = [...merged.values()].map((r): SearchHit => {
      const tier: SearchHit['tier'] = r.title.toLowerCase().includes(q) ? 'title' : r.tags.toLowerCase().includes(q) ? 'tag' : r.aliases.toLowerCase().includes(q) ? 'alias' : 'content';
      const i = r.content.toLowerCase().indexOf(q); const snippet = r.snippet || (i >= 0 ? `${i > 40 ? '…' : ''}${r.content.slice(Math.max(0, i - 40), i + q.length + 100)}` : '');
      return { path: r.path, title: r.title, tier, snippet, rank: r.rank };
    });
    return hits.sort((a, b) => order[a.tier] - order[b.tier] || b.rank - a.rank).slice(0, limit);
  }
  jumpTo(query: string, limit = 20): PageJumpResult[] {
    type JumpRow = { path: string; title: string; aliases: string };
    const lowered = query.trim().toLowerCase(); const q = `%${lowered}%`; if (!lowered) return [];
    const rows = this.db!.prepare(`SELECT path,title,aliases FROM pages WHERE lower(title) LIKE ? OR lower(aliases) LIKE ? OR lower(path) LIKE ? ORDER BY CASE WHEN lower(title) LIKE ? THEN 0 WHEN lower(aliases) LIKE ? THEN 1 ELSE 2 END,title LIMIT ?`).all(q, q, q, `${lowered}%`, `${lowered}%`, limit) as JumpRow[];
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
    return (this.db!.prepare("SELECT DISTINCT p.path FROM tags t JOIN pages p ON p.id=t.page_id WHERE t.tag_name=? OR t.tag_name LIKE ? ORDER BY p.path").all(tag, `${tag}/%`) as Array<{ path: string }>).map((row) => row.path);
  }
  pageSummary(pagePath: string): PageIndexSummary | null {
    type SummaryRow = { path: string; title: string; aliases: string; updated_at: string | null; blockCount: number; wordCount: number };
    const row = this.db!.prepare(`SELECT p.path,p.title,p.aliases,p.updated_at,COUNT(DISTINCT b.id) blockCount,COALESCE(SUM(LENGTH(b.content_text)-LENGTH(REPLACE(b.content_text,' ',''))+1),0) wordCount FROM pages p LEFT JOIN blocks b ON b.page_id=p.id WHERE p.path=? GROUP BY p.id`).get(pagePath) as SummaryRow | undefined;
    if (!row) return null;
    const tags = (this.db!.prepare('SELECT tag_name FROM tags t JOIN pages p ON p.id=t.page_id WHERE p.path=? ORDER BY tag_name').all(pagePath) as Array<{ tag_name: string }>).map((item) => item.tag_name);
    return { path: row.path, title: row.title, aliases: JSON.parse(row.aliases) as string[], tags, updatedAt: row.updated_at ?? '', wordCount: row.wordCount, blockCount: row.blockCount };
  }
  /** Testing hook: delete cache and make a new service auto rebuild at same root. */
  static removeDatabase(root: string): void { rmSync(path.join(root,'.nexnote','index.db'),{force:true}); rmSync(path.join(root,'.nexnote','index.db-wal'),{force:true}); rmSync(path.join(root,'.nexnote','index.db-shm'),{force:true}); }
}
