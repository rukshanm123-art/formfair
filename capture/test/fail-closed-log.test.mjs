/**
 * Amendment 52: a missing capture log is refused, never invented.
 *
 * `readLog` returned `emptyLog()` for a path that did not exist. A mistyped `--out` therefore did
 * not fail - it produced a confident wrong answer about a scan five agencies further on. The
 * command that exposed it was
 *
 *   npm --prefix capture run approve-set -- --out evaluation/data/capture ...
 *
 * which looks right from the repository root and is not: `npm run` executes with the package
 * directory as its cwd, so the path resolved to `capture/evaluation/data/capture`. The approval
 * reported "no candidate set", and the same mistake on a read-only command reported
 *
 *   agency:   Te Puni Kokiri
 *   category: account-registration
 *   next:     record discovered candidates, then lock the set
 *
 * which is agency 1 of the frozen draw order, finished five agencies earlier, presented as current
 * work. Nothing was written that time. A write command would have begun a second log in the wrong
 * place, and a discovery command would have fetched robots.txt and issued permits against it - and
 * a log that believes nothing has happened yet has no record of the politeness already spent.
 *
 * This is the same defect family as the drifted lists: a default that makes a wrong input look like
 * a valid state. The repair is to fail closed, and to make starting a scan an explicit act.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const captureDir = join(here, '..');
const cli = join(captureDir, 'cli-capture.mjs');

/** The CLI, run exactly as a shell would, with no network available to it. */
const run = (args, { cwd = captureDir } = {}) =>
  spawnSync('node', [cli, ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    // A command that reaches the network despite a missing log would try to resolve a host; this
    // makes any such attempt fail loudly rather than quietly succeed on a live connection.
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
  });

const inTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-failclosed-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('the mistake that prompted this', () => {
  test('the exact npm --prefix relative path is refused, not answered', () => {
    // Run from `capture/`, which is where `npm --prefix capture run` puts the cwd, with the
    // repository-root-relative path that looked correct.
    const shadow = join(captureDir, 'evaluation');
    assert.equal(existsSync(shadow), false, 'the shadow directory must not exist before the test');
    const r = run(['status', '--out', 'evaluation/data/capture']);
    try {
      assert.notEqual(r.status, 0, `it must fail, but exited 0 with:\n${r.stdout}`);
      // The old behaviour: a clean exit describing agency 1 of the draw order.
      assert.doesNotMatch(`${r.stdout}`, /Te Puni/);
      assert.doesNotMatch(`${r.stdout}`, /attempts\s+0/);
      // It must name the path it actually looked at, resolved - the whole point is that the
      // operator cannot see the resolution in the command they typed.
      assert.match(r.stderr, /no capture log at /);
      assert.match(r.stderr, new RegExp(resolve(captureDir, 'evaluation/data/capture/capture-log.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(r.stderr, /\binit\b/);
      // And it must not have created what it was looking for.
      assert.equal(existsSync(shadow), false, 'a refusal must create no directory');
    } finally {
      rmSync(shadow, { recursive: true, force: true });
    }
  });
});

describe('read-only commands fail rather than describe an empty scan', () => {
  for (const args of [['status'], ['next'], ['budget', '--agency', 'Te Puni Kōkiri'],
    ['packet', '--agency', 'Te Puni Kōkiri', '--category', 'account-registration']]) {
    test(`${args[0]} refuses`, () => inTempDir((dir) => {
      const out = join(dir, 'nothing-here');
      const r = run([...args, '--out', out]);
      assert.notEqual(r.status, 0, `${args[0]} exited 0 with:\n${r.stdout}`);
      assert.match(r.stderr, /no capture log at /);
      assert.doesNotMatch(`${r.stdout}`, /Te Puni/);
      assert.equal(existsSync(out), false, `${args[0]} created ${out}`);
    }));
  }
});

describe('write and network commands do nothing at all', () => {
  const WRITES = [
    ['capture', '--agency', 'A', '--website', 'https://a.govt.nz/', '--url', 'https://a.govt.nz/c',
      '--page-id', 'a-c', '--category', 'enquiry-or-contact', '--evidence', 'x'],
    ['preflight-discovery', '--agency', 'A', '--website', 'https://a.govt.nz/',
      '--url', 'https://a.govt.nz/', '--category', 'enquiry-or-contact', '--set-version', '1'],
    // Named explicitly because these are the paths that would otherwise spend politeness
    // against a log with no record of what has already been spent.
    ['discovery', '--agency', 'A', '--website', 'https://a.govt.nz/', '--url', 'https://a.govt.nz/',
      '--permit-id', 'p-0001', '--method', 'navigation', '--outcome', 'no-candidates',
      '--category', 'enquiry-or-contact', '--set-version', '1',
      '--navigated-at', '2026-10-02T00:00:00Z'],
    ['render-discovery', '--agency', 'A', '--website', 'https://a.govt.nz/',
      '--url', 'https://a.govt.nz/', '--permit-id', 'p-0001', '--method', 'navigation',
      '--category', 'enquiry-or-contact', '--set-version', '1'],
    ['recheck-robots', '--origin', 'https://a.govt.nz'],
    ['candidates', '--agency', 'A', '--category', 'enquiry-or-contact', '--none'],
    ['approve-set', '--agency', 'A', '--category', 'enquiry-or-contact'],
    ['exhaust'],
  ];
  for (const args of WRITES) {
    test(`${args[0]} writes nothing and requests nothing`, () => inTempDir((dir) => {
      const out = join(dir, 'nothing-here');
      const r = run([...args, '--out', out]);
      assert.notEqual(r.status, 0, `${args[0]} exited 0`);
      assert.match(r.stderr, /no capture log at /);
      // No log, no captures/ or rendered/ directory, and nothing else either: the whole path
      // is still absent, so no permit can have been issued and no robots.txt fetched.
      assert.equal(existsSync(out), false, `${args[0]} created ${out}`);
      assert.deepEqual(readdirSync(dir), [], `${args[0]} left files behind`);
    }));
  }
});

describe('init is the one way to start a scan', () => {
  test('it creates an empty log that the other commands then accept', () => inTempDir((dir) => {
    const out = join(dir, 'fresh');
    const i = run(['init', '--out', out]);
    assert.equal(i.status, 0, i.stderr);
    assert.match(i.stdout, /initialised/);
    const logPath = join(out, 'capture-log.json');
    assert.ok(existsSync(logPath));
    const log = JSON.parse(readFileSync(logPath, 'utf8'));
    assert.deepEqual(log.attempts, []);
    assert.deepEqual(log.exhausted, []);
    // Atomic: the temporary file it writes through is not left behind.
    assert.deepEqual(readdirSync(out).sort(), ['capture-log.json']);
    // And now the commands that just refused work, and name the first agency.
    const n = run(['next', '--out', out]);
    assert.equal(n.status, 0, n.stderr);
    assert.match(n.stdout, /Te Puni/);
    const s = run(['status', '--out', out]);
    assert.equal(s.status, 0, s.stderr);
  }));

  test('it refuses a directory that already holds a log', () => inTempDir((dir) => {
    const out = join(dir, 'fresh');
    assert.equal(run(['init', '--out', out]).status, 0);
    const again = run(['init', '--out', out]);
    assert.notEqual(again.status, 0, 'init overwrote an existing log');
    assert.match(again.stderr, /already/);
    // The existing log is untouched.
    assert.ok(existsSync(join(out, 'capture-log.json')));
  }));

  test('it refuses artefacts sitting beside no log', () => inTempDir((dir) => {
    // This state means a log was lost or the path is wrong. Writing a fresh log here would
    // produce one that disclaims the evidence next to it.
    const out = join(dir, 'half');
    mkdirSync(join(out, 'captures'), { recursive: true });
    writeFileSync(join(out, 'captures', 'g-0001.html'), '<!doctype html>', 'utf8');
    const r = run(['init', '--out', out]);
    assert.notEqual(r.status, 0, 'init wrote a log beside orphaned captures');
    assert.match(r.stderr, /captures/);
    assert.equal(existsSync(join(out, 'capture-log.json')), false);
  }));

  test('it is a command of its own, not a flag on another one', () => {
    // A general `--init` could ride along with any operation and create the very log that
    // operation was supposed to find.
    const r = run(['status', '--init', '--out', join(tmpdir(), 'formfair-should-not-exist')]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no capture log at /);
    assert.equal(existsSync(join(tmpdir(), 'formfair-should-not-exist')), false);
  });
});

describe('the refusal cannot drift behind a side effect', () => {
  test('no command acts before it has read the log', () => {
    // A structural check, in the spirit of Amendment 49: the ordering is derived from the source
    // rather than trusted. Every `do*` function must reach `readLog` before it creates a
    // directory, writes a file, launches a browser or fetches anything.
    const src = readFileSync(join(captureDir, 'cli-capture.mjs'), 'utf8').split('\n');
    const SIDE_EFFECT = /mkdirSync|writeFileSync|writeLog\(|capturePage|recordExamination|launch\(|robotsFor|fetchRobots|fetch\(/;
    const starts = [];
    src.forEach((line, i) => {
      const m = /^(?:async )?function (do\w+)\(/.exec(line);
      if (m) starts.push({ name: m[1], line: i });
    });
    assert.ok(starts.length > 20, `only found ${starts.length} commands`);
    starts.push({ name: '<end>', line: src.length });
    const offenders = [];
    for (let k = 0; k < starts.length - 1; k++) {
      const body = src.slice(starts[k].line, starts[k + 1].line);
      const firstRead = body.findIndex((l) => l.includes('readLog(') || l.includes('initLog('));
      body.forEach((l, j) => {
        if (!SIDE_EFFECT.test(l)) return;
        if (firstRead === -1 || j < firstRead) {
          offenders.push(`${starts[k].name}: ${l.trim().slice(0, 70)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `these act before reading the log:\n  ${offenders.join('\n  ')}`);
  });
});
