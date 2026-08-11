/**
 * End-to-end tests of the command-line entry points, run as real subprocesses.
 *
 * Module tests cannot catch a script wired to a file that does not exist, a default
 * argument pointing at the wrong directory, or an exit code that reports success on
 * failure. Every one of those shipped here before these tests existed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixture = (name) => join(root, 'fixtures', 'synthetic', name);

/** Runs a CLI and returns its exit code, stdout and stderr rather than throwing. */
function run(script, args = [], options = {}) {
  try {
    const stdout = execFileSync('node', [join(root, 'src', script), ...args], {
      cwd: options.cwd ?? root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

const withTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-cli-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('every package.json script points at a file that exists', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  for (const [name, command] of Object.entries(pkg.scripts)) {
    test(`${name}: ${command}`, () => {
      // "node --test" and the like have no entry file; only check the ones that name one.
      for (const token of command.split(/\s+/)) {
        if (!token.endsWith('.mjs') && !token.endsWith('.js')) continue;
        assert.ok(
          existsSync(join(root, token)),
          `script "${name}" runs ${token}, which does not exist`
        );
      }
    });
  }

  test('every file argument in a script exists too', () => {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      for (const token of command.split(/\s+/)) {
        if (!token.includes('/') || token.startsWith('--')) continue;
        if (token.endsWith('.mjs') || token.endsWith('.js')) continue;
        assert.ok(existsSync(join(root, token)), `script "${name}" refers to ${token}, which does not exist`);
      }
    }
  });
});

describe('cli-draw-order', () => {
  test('verifies the committed order and changes nothing', () => {
    const before = readFileSync(join(root, 'frame', 'draw-order.csv'), 'utf8');
    const r = run('cli-draw-order.mjs');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /verified:\s+frame\/draw-order\.csv matches the frame/);
    assert.equal(readFileSync(join(root, 'frame', 'draw-order.csv'), 'utf8'), before);
  });

  test('reports the frozen agency count', () => {
    assert.match(run('cli-draw-order.mjs').stdout, /agencies:\s+45/);
  });

  test('fails without rewriting when the committed order does not match the frame', () =>
    withTempDir((dir) => {
      copyFileSync(join(root, 'frame', 'frame.csv'), join(dir, 'frame.csv'));
      writeFileSync(join(dir, 'order.csv'), 'position,agency,draw_key\n1,Tampered,00\n');
      const r = run('cli-draw-order.mjs', [join(dir, 'frame.csv'), join(dir, 'order.csv')]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /MISMATCH/);
      assert.match(readFileSync(join(dir, 'order.csv'), 'utf8'), /Tampered/, 'must not overwrite');
    }));

  test('creates the order only when asked with --write', () =>
    withTempDir((dir) => {
      copyFileSync(join(root, 'frame', 'frame.csv'), join(dir, 'frame.csv'));
      const out = join(dir, 'order.csv');
      const missing = run('cli-draw-order.mjs', [join(dir, 'frame.csv'), out]);
      assert.equal(missing.code, 1);
      assert.match(missing.stderr, /Pass --write to create it/);

      const written = run('cli-draw-order.mjs', [join(dir, 'frame.csv'), out, '--write']);
      assert.equal(written.code, 0, written.stderr);
      // The same frame must reproduce the committed order exactly.
      assert.equal(readFileSync(out, 'utf8'), readFileSync(join(root, 'frame', 'draw-order.csv'), 'utf8'));
    }));

  test('fails clearly when the frame is missing', () => {
    const r = run('cli-draw-order.mjs', ['frame/does-not-exist.csv']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no frame at/);
  });
});

describe('cli-metrics', () => {
  test('computes a report from the synthetic dataset', () => {
    const r = run('cli-metrics.mjs', [fixture('dataset.valid.json')]);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.protocol, 'FormFair Held-Out Evaluation Protocol v1.0');
    assert.equal(report.instrument, 'evaluation-v1.0.0');
    assert.ok(report.stageOne, 'stage one is reported');
    assert.ok(report.perRule['FF-01'].endToEnd, 'end to end is reported per rule');
    assert.equal(report.unscored.scored, false, 'advisories stay unscored');
  });

  test('writes to a file when asked', () =>
    withTempDir((dir) => {
      const out = join(dir, 'report.json');
      const r = run('cli-metrics.mjs', [fixture('dataset.valid.json'), '--out', out]);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(JSON.parse(readFileSync(out, 'utf8')).stageOne);
    }));

  test('refuses a dataset that does not match the frozen schema', () => {
    // Scoring a malformed dataset would produce numbers that look like results.
    const r = run('cli-metrics.mjs', [fixture('dataset.invalid.json')]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /does not match the frozen schema/);
    assert.match(r.stderr, /detected must be a boolean/);
  });

  test('fails on a missing dataset rather than reporting nothing', () => {
    const r = run('cli-metrics.mjs', ['does-not-exist.json']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot read the dataset/);
  });

  test('prints usage when given no dataset', () => {
    const r = run('cli-metrics.mjs');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /usage:/);
  });

  test('the synthetic dataset exercises every end-to-end case in the protocol', () => {
    const report = JSON.parse(run('cli-metrics.mjs', [fixture('dataset.valid.json')]).stdout);
    const counts = Object.values(report.perRule).map((r) => r.endToEnd.counts);
    const total = counts.reduce(
      (a, c) => ({
        tp: a.tp + c.tp,
        fp: a.fp + c.fp,
        fn: a.fn + c.fn,
        declinedOnNegative: a.declinedOnNegative + c.declinedOnNegative,
        notReached: a.notReached + c.notReached,
      }),
      { tp: 0, fp: 0, fn: 0, declinedOnNegative: 0, notReached: 0 }
    );
    for (const [key, value] of Object.entries(total)) {
      assert.ok(value > 0, `the fixture never produces a ${key}, so that path is untested`);
    }
  });
});

describe('cli-seal', () => {
  test('refuses to pass when there is no seal manifest', () => {
    const r = run('cli-seal.mjs', ['does-not-exist.json']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /must not be run on a held-out page/);
  });

  test('passes on a complete manifest', () =>
    withTempDir((dir) => {
      const files = {};
      for (const key of ['annotatorA', 'annotatorB', 'kappa', 'adjudication']) {
        const path = join(dir, `${key}.json`);
        writeFileSync(path, JSON.stringify({ key }));
        files[key] = { path: `${key}.json`, sha256: hashOf(path) };
      }
      const manifest = join(dir, 'seal.json');
      writeFileSync(manifest, JSON.stringify({ instrument: 'evaluation-v1.0.0', files }));
      const r = run('cli-seal.mjs', [manifest]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /seal valid/);
    }));
});

function hashOf(path) {
  return execFileSync('shasum', ['-a', '256', path], { encoding: 'utf8' }).split(' ')[0];
}

describe('build-frame', () => {
  test('reproduces the committed frame byte for byte', () =>
    withTempDir((dir) => {
      const page = 'cwac-website-scores-2026-08-11.html';
      copyFileSync(join(root, 'frame', page), join(dir, page));
      const r = run('build-frame.mjs', [join(dir, page)]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(
        readFileSync(join(dir, 'frame.csv'), 'utf8'),
        readFileSync(join(root, 'frame', 'frame.csv'), 'utf8')
      );
    }));

  test('refuses to build a frame whose counts disagree with the archived page', () =>
    withTempDir((dir) => {
      const page = join(dir, 'page.html');
      // Half a page: the parse will find fewer agencies than the frame recorded.
      const full = readFileSync(join(root, 'frame', 'cwac-website-scores-2026-08-11.html'), 'utf8');
      writeFileSync(page, full.slice(0, Math.floor(full.length / 2)));
      const r = run('build-frame.mjs', [page]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /frame parse mismatch/);
    }));
});
