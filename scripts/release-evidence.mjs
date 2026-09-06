/* eslint-env node */
/** Create and validate the machine-readable manual-QA evidence bound to a release run. */
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, file = 'release-qa-evidence.json'] = process.argv.slice(2);
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

function expected() {
  return {
    schemaVersion: 1,
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

function validate(data) {
  const want = expected();
  if (data.schemaVersion !== 1) throw new Error('unsupported QA evidence schema');
  for (const key of ['repository', 'runId', 'tag', 'commit', 'channel']) {
    if (data[key] !== want[key]) throw new Error(`QA evidence ${key} is not bound to this release run`);
  }
  if (!['stable', 'beta', 'alpha'].includes(data.channel)) throw new Error('invalid release channel');
  if (!/^https:\/\/github\.com\/Aiden-FE\/nexnote\//.test(data.evidenceUrl) || data.evidenceUrl !== want.evidenceUrl) {
    throw new Error('QA evidence URL must be the submitted canonical repository HTTPS URL');
  }
  if (!/^[0-9a-f]{64}$/.test(data.evidenceSha256) || data.evidenceSha256 !== want.evidenceSha256) throw new Error('QA evidence SHA-256 must be the submitted 64-hex digest');
  if (data.allRequiredChecksPassed !== true || want.allRequiredChecksPassed !== true) throw new Error('all required QA checks must be explicitly attested');
}

if (mode === 'create') {
  const data = expected();
  validate(data);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`created QA evidence manifest for ${data.tag} / run ${data.runId}`);
} else if (mode === 'validate') {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  validate(data);
  console.log(`validated QA evidence manifest for ${data.tag} / run ${data.runId}`);
} else {
  throw new Error('usage: node scripts/release-evidence.mjs create|validate [file]');
}
