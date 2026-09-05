import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultFsService } from '../src/fs/fs-service';
import {
  createNote,
  defaultNoteFrontmatter,
  extractInlineTags,
  nextUntitledName,
  parseFrontmatterTags,
  renameWithLinks,
  rewriteWikilinks,
  scanTags,
  splitFrontmatter,
} from '../src/fs/page-ops';

let tmp: string;
let vaultRoot: string;
let service: VaultFsService;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-pageops-test-'));
  vaultRoot = path.join(tmp, 'vault');
  await mkdir(vaultRoot, { recursive: true });
  service = new VaultFsService(() => vaultRoot);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('createNote 新建笔记', () => {
  it('生成 .md 文件，frontmatter 含 created 与 id', async () => {
    const info = await createNote(service, '', '第一条笔记');
    expect(info.path).toBe('第一条笔记.md');
    const content = await service.readTextFile('第一条笔记.md');
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/^created: \d{4}-\d{2}-\d{2}T/m);
    expect(content).toMatch(/^id: [0-9a-f-]{36}$/m);
  });

  it('自动补 .md 后缀（用户输入带后缀也接受）', async () => {
    await createNote(service, 'docs', '带后缀.md');
    const stat = await service.stat('docs/带后缀.md');
    expect(stat?.kind).toBe('file');
  });

  it('名称缺省时自动生成「未命名 N」序列', async () => {
    await createNote(service, '');
    await createNote(service, '');
    const name = await nextUntitledName(service, '');
    expect(name).toBe('未命名 3');
    const entries = await service.listTree(true);
    expect(entries.map((e) => e.path).sort()).toEqual(['未命名 2.md', '未命名.md']);
  });

  it('非法名称被拒绝', async () => {
    await expect(createNote(service, '', 'a/b')).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(createNote(service, '', '.hidden')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });

  it('同名冲突被拒绝；父目录自动创建', async () => {
    await createNote(service, 'sub/dir', 'note');
    await expect(createNote(service, 'sub/dir', 'note')).rejects.toMatchObject({
      code: 'TARGET_EXISTS',
    });
  });

  it('自定义 content 追加在 frontmatter 之后', async () => {
    await createNote(service, '', '有正文', '# 标题\n\n正文');
    const content = await service.readTextFile('有正文.md');
    const { frontmatter, body } = splitFrontmatter(content);
    expect(frontmatter).toBeTruthy();
    expect(body).toContain('# 标题');
    expect(body).toContain('正文');
  });

  it('defaultNoteFrontmatter 可被解析（id 为 UUID）', () => {
    const fm = defaultNoteFrontmatter(new Date('2026-09-05T00:00:00.000Z'));
    expect(fm).toContain('created: 2026-09-05T00:00:00.000Z');
    expect(fm).toMatch(/id: [0-9a-f-]{36}/);
  });
});

describe('rewriteWikilinks wikilink 简单替换', () => {
  it('[[旧名]] → [[新名]]', () => {
    const r = rewriteWikilinks('看 [[old]] 与 [[other]]', 'old', 'new');
    expect(r.changed).toBe(true);
    expect(r.content).toBe('看 [[new]] 与 [[other]]');
  });

  it('保留别名与标题：[[old|别名]] / [[old#标题]] / [[old#^blockid]]', () => {
    const r = rewriteWikilinks('[[old|别名]] [[old#标题]] [[old#^abc123]]', 'old', 'new');
    expect(r.content).toBe('[[new|别名]] [[new#标题]] [[new#^abc123]]');
  });

  it('带目录前缀的完整路径引用被整体替换（文件移动）', () => {
    const r = rewriteWikilinks('[[dir/old]] 和 [[dir/old#h]]', 'dir/old', 'dir2/new');
    expect(r.content).toBe('[[dir2/new]] 和 [[dir2/new#h]]');
  });

  it('目录重命名按前缀替换子页面引用', () => {
    const r = rewriteWikilinks('[[olddir/a]] [[olddir/b#h]] [[other/a]]', 'olddir', 'newdir');
    expect(r.content).toBe('[[newdir/a]] [[newdir/b#h]] [[other/a]]');
  });

  it('短名（basename）引用跟随改名：dir/old → dir/new 时 [[old]] → [[new]]', () => {
    const r = rewriteWikilinks('[[old]]', 'dir/old', 'dir/new');
    expect(r.content).toBe('[[new]]');
  });

  it('移动但名字不变时短名引用保持原样（最短形式仍可解析）', () => {
    const r = rewriteWikilinks('[[old]] 与 [[olddir/old]]', 'olddir/old', 'sub/old');
    expect(r.content).toBe('[[old]] 与 [[sub/old]]');
  });

  it('嵌入语法 ![[old]] 同样处理', () => {
    const r = rewriteWikilinks('![[old]]', 'old', 'new');
    expect(r.content).toBe('![[new]]');
  });

  it('大小写敏感：[[Old]] 不被 [[old]] 的重命名误伤（已知限制内）', () => {
    const r = rewriteWikilinks('[[Old]]', 'old', 'new');
    expect(r.changed).toBe(false);
  });

  it('归一化 ./ 前缀：[[./old]] 也被替换', () => {
    const r = rewriteWikilinks('[[./old]]', 'old', 'new');
    expect(r.content).toBe('[[new]]');
  });

  it('不相关 wikilink 与 markdown 链接不受影响', () => {
    const src = '[[oldness]] [[my-old]] [text](old.md) [[sub/oldx]]';
    const r = rewriteWikilinks(src, 'old', 'new');
    expect(r.content).toBe(src);
  });

  it('from === to 时无改动', () => {
    const r = rewriteWikilinks('[[old]]', 'old', 'old');
    expect(r.changed).toBe(false);
  });
});

describe('renameWithLinks 重命名/移动 + 全库链接更新（真实临时目录）', () => {
  beforeEach(async () => {
    await service.writeTextFile('index.md', '链接 [[b]] 与 [[dir/b|别名]]');
    await service.writeTextFile('b.md', '---\ntags: [inbox]\n---\n\n# B\n\n[[index]]');
    await mkdir(path.join(vaultRoot, 'dir'), { recursive: true });
  });

  it('重命名 .md 后全库 [[b]] → [[newname]]', async () => {
    const r = await renameWithLinks(service, 'b.md', 'newname.md');
    expect(r.info.path).toBe('newname.md');
    expect(r.updatedFiles).toEqual(['index.md']);
    expect(await service.readTextFile('index.md')).toBe('链接 [[newname]] 与 [[dir/b|别名]]');
  });

  it('移动+改名时短名与完整路径引用同步更新', async () => {
    await service.writeTextFile('dir/b.md', '目录里的页面');
    await service.writeTextFile('index.md', '链接 [[b]] 与 [[dir/b|别名]]');
    const r = await renameWithLinks(service, 'dir/b.md', 'c.md');
    expect(r.updatedFiles).toEqual(['index.md']);
    expect(await service.readTextFile('index.md')).toBe('链接 [[c]] 与 [[c|别名]]');
  });

  it('目录重命名更新其内页面的路径引用', async () => {
    await service.writeTextFile('dir/b.md', '目录页面');
    await service.writeTextFile('index.md', '[[dir/b]]');
    const r = await renameWithLinks(service, 'dir', 'renamed');
    expect(r.info.kind).toBe('directory');
    expect(r.updatedFiles).toEqual(['index.md']);
    expect(await service.readTextFile('index.md')).toBe('[[renamed/b]]');
  });

  it('目标已存在时拒绝（不静默覆盖）', async () => {
    await service.writeTextFile('c.md', '已存在');
    await expect(renameWithLinks(service, 'b.md', 'c.md')).rejects.toMatchObject({
      code: 'TARGET_EXISTS',
    });
    // 源文件应原样保留
    expect(await service.exists('b.md')).toBe(true);
  });

  it('拒绝把目录移入自身子目录', async () => {
    await mkdir(path.join(vaultRoot, 'dir', 'child'), { recursive: true });
    await expect(renameWithLinks(service, 'dir', 'dir/child/moved')).rejects.toMatchObject({
      code: 'INVALID_MOVE',
    });
  });

  it('拒绝移动到自身相同路径', async () => {
    await expect(renameWithLinks(service, 'b.md', 'b.md')).rejects.toMatchObject({
      code: 'SAME_PATH',
    });
  });

  it('源不存在时报错', async () => {
    await expect(renameWithLinks(service, 'nope.md', 'x.md')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('.nexnote 内部文件不参与链接更新', async () => {
    await mkdir(path.join(vaultRoot, '.nexnote'), { recursive: true });
    await writeFile(path.join(vaultRoot, '.nexnote', 'config.json'), '{}');
    await service.writeTextFile('.trash.md', '[[b]]'); // .trash.md 是普通文件，会被更新
    await renameWithLinks(service, 'b.md', 'z.md');
    expect(await service.readTextFile('.trash.md')).toBe('[[z]]');
  });
});

describe('标签扫描', () => {
  describe('parseFrontmatterTags', () => {
    it('块列表写法', () => {
      expect(parseFrontmatterTags('tags:\n  - inbox\n  - draft')).toEqual(['inbox', 'draft']);
    });

    it('行内数组与引号值', () => {
      expect(parseFrontmatterTags('tags: [a, "b c", \'d\']')).toEqual(['a', 'b c', 'd']);
    });

    it('单值与 tag: 别名', () => {
      expect(parseFrontmatterTags('tag: solo')).toEqual(['solo']);
    });

    it('列表写法在遇到非列表行时停止', () => {
      expect(parseFrontmatterTags('tags:\n  - a\nother: 1\n  - b')).toEqual(['a']);
    });
  });

  describe('extractInlineTags', () => {
    it('提取 #tag 与 Unicode 标签；# 前是文字时不视为标签（与 Obsidian 一致）', () => {
      expect(extractInlineTags('正文 #inbox 与 #项目/子标签 以及#紧贴')).toEqual([
        'inbox',
        '项目/子标签',
      ]);
    });

    it('排除 #^blockid、#heading 引用、数字开头与代码', () => {
      const body = '# 标题\n[[a#^blk]] #^ref\n`#fake` #123abc\n```\n#incode\n```';
      expect(extractInlineTags(body)).toEqual([]);
    });

    it('## 二级标题不算标签，行首 #tag 算', () => {
      expect(extractInlineTags('## 小节\n#todo')).toEqual(['todo']);
    });
  });

  it('splitFrontmatter 分离与无 frontmatter 情况', () => {
    const { frontmatter, body } = splitFrontmatter('---\ntags: [x]\n---\n正文 #y');
    expect(frontmatter).toBe('tags: [x]');
    expect(body).toBe('正文 #y');
    const plain = splitFrontmatter('只是正文');
    expect(plain.frontmatter).toBeNull();
    expect(plain.body).toBe('只是正文');
  });

  it('scanTags 聚合全库标签（frontmatter + 内联，含文件归属）', async () => {
    await service.writeTextFile(
      'a.md',
      '---\ntags:\n  - inbox\n  - project/a\n---\n\n# A\n\n提到 #draft 与 #inbox',
    );
    await service.writeTextFile('sub/b.md', '正文 #draft #inbox');
    await mkdir(path.join(vaultRoot, '.nexnote'), { recursive: true });
    await service.writeTextFile('.nexnote/ignore.md', '#hidden'); // 内部目录不扫描

    const stats = await scanTags(service);
    expect(stats).toEqual([
      { tag: 'draft', files: ['a.md', 'sub/b.md'] },
      { tag: 'inbox', files: ['a.md', 'sub/b.md'] },
      { tag: 'project/a', files: ['a.md'] },
    ]);
  });

  it('scanTags 空库返回空数组', async () => {
    expect(await scanTags(service)).toEqual([]);
  });
});

describe('listTree', () => {
  it('默认隐藏非 .md；始终排除 .nexnote/.git/.trash', async () => {
    await service.writeTextFile('a.md', 'x');
    await service.writeTextFile('img.png', 'binary');
    await mkdir(path.join(vaultRoot, '.git'), { recursive: true });
    await mkdir(path.join(vaultRoot, '.nexnote'), { recursive: true });
    const entries = await service.listTree(false);
    expect(entries.map((e) => e.path)).toEqual(['a.md']);
    const all = await service.listTree(true);
    expect(all.map((e) => e.path)).toContain('img.png');
    expect(all.map((e) => e.path)).not.toContain('.git');
  });

  it('目录先于文件、同层按名称排序', async () => {
    await service.writeTextFile('z.md', 'x');
    await mkdir(path.join(vaultRoot, 'adir'), { recursive: true });
    await service.writeTextFile('adir/x.md', 'x');
    await service.writeTextFile('a.md', 'x');
    const entries = await service.listTree(false);
    expect(entries.map((e) => e.path)).toEqual(['a.md', 'adir', 'adir/x.md', 'z.md']);
  });

  it('未打开 vault 时报错', async () => {
    const noVault = new VaultFsService(() => null);
    await expect(noVault.listTree()).rejects.toMatchObject({ code: 'NO_VAULT' });
  });
});
