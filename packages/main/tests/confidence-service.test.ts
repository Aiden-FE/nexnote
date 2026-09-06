import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultVaultConfig } from '@nexnote/shared';
import { GitService } from '../src/git/git-service';
import { LinkIndexService } from '../src/indexer/index-service';
import { computeConfidenceResults, ConfidenceService } from '../src/confidence/confidence-service';
import { writeVaultConfig } from '../src/vault/vault-manager';

const tempDirs: string[] = [];

async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nexnote-confidence-'));
  tempDirs.push(root);
  return root;
}

async function page(root: string, relativePath: string, body: string): Promise<void> {
  const file = path.join(root, relativePath);
  await writeFile(file, body, 'utf8');
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function commit(root: string, message: string): void {
  git(root, ['add', '.']);
  git(root, ['commit', '-m', message, '--allow-empty']);
}

async function freshVaultWithHistory(): Promise<{ root: string; index: LinkIndexService; git: GitService }> {
  const root = await makeVault();
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Author One']);
  git(root, ['config', 'user.email', 'one@example.com']);
  await page(root, 'target.md', '---\nconfidence_boost: 20\n---\n# Target\n\nstable line\n');
  await page(root, 'source.md', '# Source\n\n[[Target]]\n');
  commit(root, 'initial');
  const index = new LinkIndexService();
  const gitService = new GitService({ useSystemGit: true });
  index.setRoot(root);
  gitService.setRoot(root);
  return { root, index, git: gitService };
}

function factor(result: NonNullable<ReturnType<LinkIndexService['confidence']>>, key: string) {
  return result.factors.find((item) => item.key === key)!;
}

describe('DEV-008 confidence engine', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('caches six factors, authority, and getConfidence(pageId)', async () => {
    const { index, git } = await freshVaultWithHistory();
    const service = new ConfidenceService(index, git, () => undefined, (error) => { throw error; });
    await service.refresh();
    const pageId = index.pageSummary('target.md')!.pageId;
    const result = index.confidence(pageId);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('target.md');
    expect(result!.score).toBeGreaterThanOrEqual(0);
    expect(result!.score).toBeLessThanOrEqual(100);
    expect(result!.factors.map((item) => item.key)).toEqual([
      'stability',
      'review_count',
      'author_count',
      'age',
      'link_authority',
      'manual_boost',
    ]);
    expect(factor(result!, 'manual_boost').score).toBeCloseTo(0.2, 3);
    expect(factor(result!, 'link_authority').score).toBeGreaterThan(0);
    index.close();
    git.setRoot(null);
  });

  it('recalculates stability and manual boost incrementally after modified history', async () => {
    const { root, index, git } = await freshVaultWithHistory();
    const service = new ConfidenceService(index, git);
    await service.refresh();
    const pageId = index.pageSummary('target.md')!.pageId;
    const before = index.confidence(pageId)!;

    await page(root, 'target.md', `---\nconfidence_boost: 80\n---\n# Target\n\n${'changed\n'.repeat(400)}`);
    commit(root, 'nexnote:manual: major rewrite');
    index.updateFile('target.md');
    await service.refresh(['target.md']);
    const after = index.confidence(pageId)!;

    expect(after.computedAt >= before.computedAt).toBe(true);
    expect(factor(after, 'manual_boost').score).toBeCloseTo(0.8, 3);
    expect(factor(after, 'stability').score).toBeLessThan(factor(before, 'stability').score);
    expect(factor(after, 'stability').detail).toContain('2 次历史改动');
    index.close();
    git.setRoot(null);
  });

  it('gives every page a score in a vault without Git history', async () => {
    const root = await makeVault();
    await page(root, 'a.md', '# A\n');
    await page(root, 'b.md', '# B\n');
    const index = new LinkIndexService();
    const git = new GitService({ useSystemGit: true });
    index.setRoot(root);
    git.setRoot(root);
    const service = new ConfidenceService(index, git);
    await service.refresh();
    const values = [
      index.pageSummary('a.md')!.pageId,
      index.pageSummary('b.md')!.pageId,
    ].map((pageId) => index.confidence(pageId));
    expect(values).toHaveLength(2);
    for (const result of values) {
      expect(result!.score).toBeGreaterThan(0);
      expect(result!.score).toBeLessThanOrEqual(100);
    }
    index.close();
    git.setRoot(null);
  });

  it('does not write frontmatter by default, but writes score when explicitly enabled', async () => {
    const defaultVault = await freshVaultWithHistory();
    const defaultService = new ConfidenceService(defaultVault.index, defaultVault.git, () => undefined, (error) => { throw error; });
    await defaultService.refresh();
    const defaultTarget = await readFile(path.join(defaultVault.root, 'target.md'), 'utf8');
    expect(defaultTarget).not.toContain('confidence:');
    expect(defaultTarget).toContain('confidence_boost: 20');
    defaultVault.index.close();
    defaultVault.git.setRoot(null);

    const enabled = await freshVaultWithHistory();
    const config = defaultVaultConfig();
    config.features.confidenceFrontmatter = true;
    await writeVaultConfig(enabled.root, {
      ...config,
      features: { confidenceFrontmatter: true },
    });
    const enabledService = new ConfidenceService(enabled.index, enabled.git, () => undefined, (error) => { throw error; });
    await enabledService.refresh();
    const syncedTarget = await readFile(path.join(enabled.root, 'target.md'), 'utf8');
    expect(syncedTarget).toMatch(/^---\nconfidence_boost: 20\nconfidence: \d+\n---/);
    enabled.index.close();
    enabled.git.setRoot(null);
  });

  it('full refresh computes 1,000 indexed pages in under the 10-second reference target', async () => {
    const root = await makeVault();
    await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        page(root, `page-${index}.md`, `# Page ${index}\n\n[[page-${(index + 1) % 1_000}]]\n`),
      ),
    );
    const index = new LinkIndexService();
    const git = new GitService({ useSystemGit: true });
    index.setRoot(root);
    git.setRoot(root);
    const service = new ConfidenceService(index, git, () => undefined, (error) => { throw error; });
    const started = performance.now();
    await service.refresh();
    const elapsed = performance.now() - started;
    const pages = index.confidencePages();
    expect(pages).toHaveLength(1_000);
    expect(index.getConfidence(pages[0]!.id)).not.toBeNull();
    expect(elapsed).toBeLessThan(10_000);
    index.close();
    git.setRoot(null);
  });

  it('pure factor computation for 1,000 pages stays bounded', async () => {
    const pages = Array.from({ length: 1_000 }, (_, index) => ({
      id: index + 1,
      path: `page-${index}.md`,
      createdAt: '2025-01-01T00:00:00.000Z',
      confidenceBoost: null,
    }));
    const histories = new Map(
      pages.map((page) => [page.path, {
        commits: 2,
        authors: 1,
        firstCommitAt: '2025-01-01T00:00:00.000Z',
        lastCommitAt: '2025-02-01T00:00:00.000Z',
        events: [{ date: '2025-02-01T00:00:00.000Z', additions: 5, deletions: 2 }],
      }]),
    );
    const started = performance.now();
    const results = computeConfidenceResults({
      pages,
      graph: { pages: pages.map((page) => ({ path: page.path, title: page.path, folder: '', tags: [], inboundLinks: 0, outboundLinks: 0 })), links: [] },
      histories,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(results).toHaveLength(1_000);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
