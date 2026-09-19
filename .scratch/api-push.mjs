/* eslint-disable */
// One-off offline publisher: replicate local commits through the GitHub Git Data API
// when git smart-HTTP to github.com is unreachable but api.github.com works.
import { execFileSync } from 'node:child_process';

const REPO = 'Aiden-FE/nexnote';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}
function gitBuf(args) {
  return execFileSync('git', args, { maxBuffer: 512 * 1024 * 1024 });
}
function gh(endpoint, method = 'GET', body) {
  const args = ['api', `repos/${REPO}/${endpoint}`, '-X', method];
  if (body !== undefined) args.push('--input', '-');
  const input = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const out = execFileSync('gh', args, {
        encoding: 'utf8',
        input,
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return out ? JSON.parse(out) : {};
    } catch (error) {
      const message = String(error.stderr ?? error.message);
      if (attempt === 3) throw new Error(`${endpoint} ${method} failed: ${message.slice(0, 400)}`);
      execFileSync('sleep', [String(attempt + 1)]);
    }
  }
  throw new Error('unreachable');
}
function exists(kind, sha) {
  try {
    execFileSync('gh', ['api', `repos/${REPO}/git/${kind}/${sha}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const remote = gh('git/ref/heads/master').object.sha;
const head = git(['rev-parse', 'HEAD']).trim();
console.log('remote master', remote, '-> local head', head);

// ---- blobs
const revList = git(['rev-list', '--objects', `${remote}..${head}`]);
const named = revList
  .split('\n')
  .map((line) => line.split(' ')[0])
  .filter(Boolean);
const check = gitBuf(['cat-file', '--batch-check=%(objectname) %(objecttype)'])
  ? null
  : null;
const types = new Map();
{
  const input = `${named.join('\n')}\n`;
  const out = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  for (const line of out.split('\n')) {
    const [sha, type] = line.split(' ');
    if (sha && type) types.set(sha, type);
  }
}
const localBlobs = [...types].filter(([, t]) => t === 'blob').map(([s]) => s);
const localTrees = [...types].filter(([, t]) => t === 'tree').map(([s]) => s);
console.log('new blobs', localBlobs.length, 'new root trees', localTrees.length);

let createdBlobs = 0;
for (const sha of localBlobs) {
  if (exists('blobs', sha)) continue;
  const raw = gitBuf(['cat-file', 'blob', sha]);
  const created = gh('git/blobs', 'POST', {
    content: raw.toString('base64'),
    encoding: 'base64',
  });
  if (created.sha !== sha) throw new Error(`blob mismatch ${sha} -> ${created.sha}`);
  createdBlobs += 1;
}
console.log('blobs created', createdBlobs, '(others already present)');

// ---- trees: collect every subtree, create children before parents
const entriesCache = new Map();
function entries(tree) {
  if (!entriesCache.has(tree)) {
    const out = git(['ls-tree', tree]);
    const list = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [meta, path] = line.split('\t');
      const [mode, type, sha] = meta.split(' ');
      list.push({ path, mode, type, sha });
    }
    entriesCache.set(tree, list);
  }
  return entriesCache.get(tree);
}

const allTrees = new Set();
const queue = [...localTrees];
while (queue.length) {
  const tree = queue.pop();
  if (allTrees.has(tree)) continue;
  allTrees.add(tree);
  for (const entry of entries(tree)) {
    if (entry.type === 'tree' && !allTrees.has(entry.sha)) queue.push(entry.sha);
  }
}
console.log('subtree objects to ensure:', allTrees.size);

// children-first ordering via DFS post-order
const order = [];
const seen = new Set();
function visit(tree) {
  if (seen.has(tree)) return;
  seen.add(tree);
  for (const entry of entries(tree)) if (entry.type === 'tree') visit(entry.sha);
  order.push(tree);
}
for (const tree of allTrees) visit(tree);

let createdTrees = 0;
for (const tree of order) {
  if (exists('trees', tree)) continue;
  const created = gh('git/trees', 'POST', {
    tree: entries(tree).map(({ path, mode, type, sha }) => ({ path, mode, type, sha })),
  });
  if (created.sha !== tree) throw new Error(`tree mismatch ${tree} -> ${created.sha}`);
  createdTrees += 1;
}
console.log('trees created', createdTrees);

// ---- commits
function parsePerson(raw) {
  const match = /^(.*) <([^>]*)> (\d+) ([+-])(\d{2})(\d{2})$/.exec(raw);
  if (!match) throw new Error(`cannot parse person: ${raw}`);
  const [, name, email, ts, sign, hh, mm] = match;
  const delta = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
  const date = new Date((Number(ts) + delta * 60) * 1000);
  const offset = `${sign}${hh}:${mm}`;
  const iso = `${date.toISOString().replace(/\.\d{3}Z$/, '')}${offset}`;
  return { name, email, date: iso };
}

const commits = git(['rev-list', '--reverse', '--topo-order', `${remote}..${head}`])
  .split('\n')
  .filter(Boolean);
console.log('creating commits:', commits.length);
for (const commit of commits) {
  const raw = git(['cat-file', 'commit', commit]);
  const lines = raw.split('\n');
  let tree = '';
  const parents = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('tree ')) tree = line.slice(5);
    else if (line.startsWith('parent ')) parents.push(line.slice(7));
    else if (line === '') break;
  }
  const message = `${lines.slice(i + 1).join('\n').replace(/\n+$/, '')}\n`;
  const author = parsePerson(lines.find((l) => l.startsWith('author ')).slice(7));
  const committer = parsePerson(lines.find((l) => l.startsWith('committer ')).slice(10));
  const created = gh('git/commits', 'POST', {
    message,
    tree,
    parents,
    author,
    committer,
  });
  if (created.sha !== commit) throw new Error(`commit mismatch ${commit} -> ${created.sha}`);
}
console.log('all commits replicated with identical SHAs');

const updated = gh('git/refs/heads/master', 'PATCH', { sha: head, force: false });
console.log('remote master now', updated.object.sha);

const tagObject = gh('git/tags', 'POST', {
  tag: 'v0.0.15',
  message: 'v0.0.15',
  object: git(['rev-parse', 'v0.0.15^{commit}']).trim(),
  type: 'commit',
});
console.log('annotated tag object', tagObject.sha);
