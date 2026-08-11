/**
 * Resolves the frozen instrument, and refuses anything else.
 *
 * The harness checkout is not the instrument. Its analyser sources drift from
 * `evaluation-v1.0.0` as the harness is worked on, and the frozen instrument is not only
 * a set of rule behaviours: it includes the exact message, evidence and basis text a
 * report carries. Testing the harness against the working tree would validate it against
 * an analyser the protocol does not name.
 *
 * The instrument is supplied as a separate checkout through FORMFAIR_INSTRUMENT_DIR, and
 * its identity is asserted before anything is loaded from it.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/** The commit `evaluation-v1.0.0` points at, and the lockfile recorded in that tag. */
export const INSTRUMENT = {
  tag: 'evaluation-v1.0.0',
  commit: '9f43862d033e1b45890f977cffb89ca4a9504d40',
  lockfileSha256: '2a88d26ebeee56016b92f9a9a3f2584c99df6c77b3d01ccd753910412f626a1f',
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function commitOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Checks that a directory is the frozen instrument. Returns the problems rather than
 * throwing, so a caller can report all of them at once.
 */
export function verifyInstrumentDir(dir) {
  const problems = [];
  const at = resolve(dir);

  if (!existsSync(at)) return { valid: false, problems: [`no instrument checkout at ${at}`] };

  const commit = commitOf(at);
  if (commit === null) {
    problems.push(`${at} is not a git checkout, so its identity cannot be established`);
  } else if (commit !== INSTRUMENT.commit) {
    problems.push(
      `${at} is at commit ${commit}, not ${INSTRUMENT.commit} (${INSTRUMENT.tag}). ` +
        'The harness checkout is not the instrument: its analyser sources drift, and the ' +
        'frozen instrument includes exact message and evidence text, not only rule behaviour.'
    );
  }

  const lockfile = join(at, 'package-lock.json');
  if (!existsSync(lockfile)) {
    problems.push(`${at} has no package-lock.json`);
  } else {
    const actual = sha256(readFileSync(lockfile));
    if (actual !== INSTRUMENT.lockfileSha256) {
      problems.push(`${at} package-lock.json hashes to ${actual}, not ${INSTRUMENT.lockfileSha256}`);
    }
  }

  for (const built of ['dist/index.js', 'node_modules/parse5/package.json']) {
    if (!existsSync(join(at, built))) {
      problems.push(`${at} is missing ${built}. Run npm ci and npm run build in that checkout.`);
    }
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Loads the analyser and the parser from the verified instrument checkout.
 *
 * parse5 comes from there too, not from wherever the harness happens to resolve it: the
 * inventory's source positions must come from the same parser version the analyser uses,
 * or the join would compare positions produced by different code.
 */
export async function loadInstrument(dir) {
  const { valid, problems } = verifyInstrumentDir(dir);
  if (!valid) {
    const error = new Error(`instrument checkout rejected:\n  ${problems.join('\n  ')}`);
    error.problems = problems;
    throw error;
  }

  const at = resolve(dir);
  const require = createRequire(join(at, 'package.json'));
  const parse5 = require('parse5');
  const formfair = await import(join(at, 'dist', 'index.js'));

  return {
    dir: at,
    commit: INSTRUMENT.commit,
    tag: INSTRUMENT.tag,
    formfair,
    parse5,
    parserVersion: versionOf(require, 'parse5'),
  };
}

/** parse5 does not expose ./package.json, so resolve its entry and walk up to the manifest. */
function versionOf(require, name) {
  let dir = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (manifest.name === name) return manifest.version;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not resolve a manifest for ${name}`);
    dir = parent;
  }
}

/** The directory the caller nominated, or null when none was supplied. */
export function instrumentDirFromEnv(env = process.env) {
  return env.FORMFAIR_INSTRUMENT_DIR ?? null;
}
