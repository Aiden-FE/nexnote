/* eslint-env node */
/**
 * Fetch and bind reviewed QA evidence without permitting arbitrary network access.
 * Only an immutable raw GitHub blob in Aiden-FE/nexnote is accepted. The fetched
 * JSON must attest the release tag/commit/channel; this manifest adds the run ID.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, file = 'release-qa-evidence.json'] = process.argv.slice(2);
const MAX_EVIDENCE_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

function expected() {
  return {
    repository: required('GITHUB_REPOSITORY'),
    runId: required('GITHUB_RUN_ID'),
    tag: required('GITHUB_REF_NAME'),
    commit: required('GITHUB_SHA'),
    channel: required('RELEASE_CHANNEL'),
    evidenceUrl: required('QA_EVIDENCE_URL'),
    evidenceSha256: required('QA_EVIDENCE_SHA256').toLowerCase(),
    allRequiredChecksPassed: process.env.QA_ALL_REQUIRED_CHECKS_PASSED === 'true',
  };
}

export function parseImmutableEvidenceUrl(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'QA evidence URL must be plain HTTPS without credentials, port, query, or fragment',
    );
  }
  // raw.githubusercontent.com avoids mutable GitHub HTML endpoints and redirects.
  const parts = url.pathname.split('/').filter(Boolean);
  if (
    url.hostname !== 'raw.githubusercontent.com' ||
    parts.length < 4 ||
    parts[0] !== 'Aiden-FE' ||
    parts[1] !== 'nexnote'
  ) {
    throw new Error('QA evidence URL must be an immutable raw blob from Aiden-FE/nexnote');
  }
  if (!/^[0-9a-f]{40}$/i.test(parts[2]))
    throw new Error('QA evidence URL must pin a full immutable 40-character commit SHA');
  return { url, evidenceCommit: parts[2].toLowerCase() };
}

export async function fetchEvidence(rawUrl) {
  const { url, evidenceCommit } = parseImmutableEvidenceUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`QA evidence fetch failed: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length && (!Number.isSafeInteger(length) || length > MAX_EVIDENCE_BYTES))
      throw new Error('QA evidence exceeds size limit');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('QA evidence response has no body');
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_EVIDENCE_BYTES) throw new Error('QA evidence exceeds size limit');
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), evidenceCommit };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateAttestation(attestation, want, evidenceCommit) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation))
    throw new Error('QA evidence must be a JSON object');
  for (const key of ['repository', 'tag', 'commit', 'channel']) {
    if (attestation[key] !== want[key])
      throw new Error(`fetched QA evidence ${key} does not bind this release`);
  }
  // The source commit is bound by the immutable URL and manifest, not a self-referential
  // field inside the blob (a document cannot contain the hash of its own Git commit).
  if (!/^[0-9a-f]{40}$/.test(evidenceCommit))
    throw new Error('invalid immutable evidence source commit');
  if (attestation.allRequiredChecksPassed !== true || want.allRequiredChecksPassed !== true)
    throw new Error('all required QA checks must be explicitly attested');
}

export async function create(output) {
  const want = expected();
  if (want.repository !== 'Aiden-FE/nexnote')
    throw new Error('release evidence only supports canonical Aiden-FE/nexnote');
  if (!/^[0-9a-f]{64}$/.test(want.evidenceSha256))
    throw new Error('QA evidence SHA-256 must be 64 lowercase hex');
  if (!['stable', 'beta', 'alpha'].includes(want.channel))
    throw new Error('invalid release channel');
  const { body, evidenceCommit } = await fetchEvidence(want.evidenceUrl);
  const actualSha256 = createHash('sha256').update(body).digest('hex');
  if (actualSha256 !== want.evidenceSha256)
    throw new Error('fetched QA evidence SHA-256 does not match supplied digest');
  let attestation;
  try {
    attestation = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('fetched QA evidence must be UTF-8 JSON');
  }
  validateAttestation(attestation, want, evidenceCommit);
  const manifest = {
    schemaVersion: 2,
    ...want,
    evidenceCommit,
    fetchedSha256: actualSha256,
    fetchedBytes: body.byteLength,
    attestation,
  };
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`fetched and bound QA evidence for ${manifest.tag} / run ${manifest.runId}`);
}

export function validate(data) {
  const want = expected();
  if (data.schemaVersion !== 2) throw new Error('unsupported QA evidence schema');
  for (const key of [
    'repository',
    'runId',
    'tag',
    'commit',
    'channel',
    'evidenceUrl',
    'evidenceSha256',
    'allRequiredChecksPassed',
  ]) {
    if (data[key] !== want[key])
      throw new Error(`QA evidence ${key} is not bound to this release run`);
  }
  const { evidenceCommit } = parseImmutableEvidenceUrl(data.evidenceUrl);
  if (
    data.evidenceCommit !== evidenceCommit ||
    data.fetchedSha256 !== data.evidenceSha256 ||
    data.fetchedBytes > MAX_EVIDENCE_BYTES
  ) {
    throw new Error('QA evidence manifest integrity bounds failed');
  }
  validateAttestation(data.attestation, want, evidenceCommit);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  if (mode === 'create') await create(file);
  else if (mode === 'validate') validate(JSON.parse(readFileSync(file, 'utf8')));
  else throw new Error('usage: node scripts/release-evidence.mjs create|validate [file]');
}
