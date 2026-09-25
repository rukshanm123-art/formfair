import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const SOLO_INSTRUMENT_TAG = 'evaluation-v1.1.0';
export const SOLO_CORPUS_TAG = 'corpus-v1.0.0';

/**
 * The sealer's own tag, attested separately from the analyser's.
 *
 * The seal and the analyser are different artefacts frozen under different tags. A manifest that
 * recorded only `evaluation-v1.1.0` said which analyser would read the corpus but not which
 * sealing rules produced it - and those rules changed materially at solo-protocol-v1.0.2, when the
 * seal began verifying exhaustion records against the capture log instead of trusting their shape.
 */
export const SOLO_SEALER_TAG = 'solo-protocol-v1.0.3';

/**
 * Identity of the checkout doing the sealing. A real seal requires it clean and tagged, on the
 * same reasoning as the analyser: a corpus sealed from a modified working tree cannot be
 * reproduced, and nothing afterwards would reveal which rules were actually applied.
 */
export function sealerIdentity(dir = null) {
  // Defaults to the checkout that CONTAINS this file, which is the code doing the sealing.
  // Passing the analyser directory made official sealing impossible: `evaluation-v1.1.0` and the
  // solo-protocol tag point at different commits, so one checkout cannot satisfy both, and
  // whichever identity was checked second always failed. The two are separate artefacts and must
  // be resolved separately.
  const at = resolve(dir ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const commit = git(at, ['rev-parse', 'HEAD']);
  const status = git(at, ['status', '--porcelain']);
  const tags = (git(at, ['tag', '--points-at', 'HEAD']) ?? '').split('\n').filter(Boolean).sort();
  return {
    directory: at,
    tag: SOLO_SEALER_TAG,
    commit,
    tagsAtCommit: tags,
    dirty: status === null ? null : status.length > 0,
    officialReady: commit !== null && status === '' && tags.includes(SOLO_SEALER_TAG),
  };
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function instrumentIdentity(dir) {
  const at = resolve(dir);
  const packagePath = join(at, 'package.json');
  const lockPath = join(at, 'package-lock.json');
  const entry = join(at, 'dist', 'index.js');
  const commit = git(at, ['rev-parse', 'HEAD']);
  const status = git(at, ['status', '--porcelain']);
  const tags = (git(at, ['tag', '--points-at', 'HEAD']) ?? '').split('\n').filter(Boolean).sort();
  const manifest = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')) : null;

  return {
    directory: at,
    tag: SOLO_INSTRUMENT_TAG,
    commit,
    tagsAtCommit: tags,
    dirty: status === null ? null : status.length > 0,
    packageVersion: manifest?.version ?? null,
    lockfileSha256: existsSync(lockPath) ? sha256(readFileSync(lockPath)) : null,
    built: existsSync(entry),
    officialReady:
      commit !== null &&
      status === '' &&
      tags.includes(SOLO_INSTRUMENT_TAG) &&
      existsSync(entry) &&
      existsSync(lockPath),
  };
}

export async function loadSoloInstrument(dir, { development = false } = {}) {
  const identity = instrumentIdentity(dir);
  if (!identity.built) {
    throw new Error(`no built instrument at ${join(identity.directory, 'dist', 'index.js')}; run npm run build`);
  }
  if (!development && !identity.officialReady) {
    throw new Error(
      `official solo evaluation requires a clean checkout tagged ${SOLO_INSTRUMENT_TAG}. ` +
        `Current identity: commit=${identity.commit ?? 'unknown'}, dirty=${identity.dirty}, ` +
        `tags=${identity.tagsAtCommit.join(',') || 'none'}`
    );
  }

  const core = await import(pathToFileURL(join(identity.directory, 'dist', 'index.js')).href);
  for (const name of ['analyse', 'analyseWith', 'findNameControls', 'toJson']) {
    if (typeof core[name] !== 'function') throw new Error(`instrument does not export ${name}`);
  }
  return { identity, core };
}

export async function loadDelegatedProvider(dir) {
  const node = await import(pathToFileURL(join(resolve(dir), 'dist', 'node.js')).href);
  if (typeof node.axeProvider !== 'function') throw new Error('instrument does not export axeProvider');
  return node.axeProvider();
}

export function verifyCorpusAttestation(repoDir, manifestPath) {
  const repo = resolve(repoDir);
  const manifest = resolve(manifestPath);
  const relativePath = manifest.startsWith(`${repo}/`) ? manifest.slice(repo.length + 1) : null;
  const problems = [];
  if (relativePath === null) problems.push('the corpus manifest is outside the harness checkout');

  const commit = git(repo, ['rev-parse', 'HEAD']);
  const tags = (git(repo, ['tag', '--points-at', 'HEAD']) ?? '').split('\n').filter(Boolean);
  if (!tags.includes(SOLO_CORPUS_TAG)) problems.push(`harness HEAD is not tagged ${SOLO_CORPUS_TAG}`);

  if (relativePath !== null) {
    const tracked = git(repo, ['ls-files', '--error-unmatch', '--', relativePath]);
    if (tracked !== relativePath) problems.push('the corpus manifest is not tracked at the corpus tag');
    const status = git(repo, ['status', '--porcelain', '--', relativePath]);
    if (status === null || status !== '') problems.push('the corpus manifest differs from the tagged bytes');
  }
  return { valid: problems.length === 0, problems, tag: SOLO_CORPUS_TAG, commit };
}
