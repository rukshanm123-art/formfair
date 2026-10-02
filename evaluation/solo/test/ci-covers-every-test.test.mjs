/**
 * Amendment 49, applied to the evaluation package - where the same defect was still live.
 *
 * Amendment 49 replaced `capture/package.json`'s hand-written list of ten test files with a glob,
 * after CI was found running 445 of 540 tests. The guard it added checks the capture package only,
 * so the identical list in `evaluation/package.json` went on unexamined: `test:solo` named three
 * files while five were on disk. The two it omitted were `revoked-tags.test.mjs` - the guard
 * Amendment 47 added so that a revoked tag could never be re-published, which had therefore never
 * run in CI - and the Amendment 50 barrier-recovery suite.
 *
 * That is the fourth time a hand-maintained list in this project drifted from what it enumerates,
 * and the second time the drift hid a guard written to freeze a correction. Amendment 49's own
 * reasoning applies verbatim; only its SCOPE was wrong. This test closes it, over both of the
 * evaluation package's test directories.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** Each script, and the directory whose `*.test.mjs` files it is responsible for. */
const SUITES = [
  { script: 'test', dir: new URL('../../test/', import.meta.url), glob: 'test/*.test.mjs' },
  { script: 'test:solo', dir: new URL('./', import.meta.url), glob: 'solo/test/*.test.mjs' },
];

describe('every evaluation test script runs every file in its directory', () => {
  for (const { script, dir, glob } of SUITES) {
    test(`\`${script}\` globs rather than naming files`, () => {
      const cmd = pkg.scripts[script];
      assert.ok(cmd, `there is no ${script} script`);
      assert.ok(cmd.includes(glob), `\`${script}\` is: ${cmd}`);
      const named = cmd
        .replace('node --test ', '')
        .trim()
        .split(/\s+/)
        .filter((arg) => arg.endsWith('.test.mjs') && !arg.includes('*'));
      assert.deepEqual(named, [], `\`${script}\` still names files individually: ${named.join(', ')}`);
    });

    test(`\`${script}\` leaves no file on disk unrun`, () => {
      // A glob cannot fall behind the directory. If a future edit replaces it with a list, the
      // files that list forgets are named here.
      const onDisk = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();
      assert.ok(onDisk.length > 0, 'no test files were found at all');
      const cmd = pkg.scripts[script];
      if (cmd.includes(glob)) return;
      const missing = onDisk.filter((f) => !cmd.includes(f));
      assert.deepEqual(missing, [], `${script} would not run: ${missing.join(', ')}`);
    });
  }

  test('this file is itself one of the files the glob runs', () => {
    // The guard has to be inside what it guards, or it can be dropped from CI silently - which
    // is exactly how the Amendment 47 suite stopped running.
    const onDisk = readdirSync(new URL('./', import.meta.url));
    assert.ok(onDisk.includes('ci-covers-every-test.test.mjs'));
    assert.ok(pkg.scripts['test:solo'].includes('solo/test/*.test.mjs'));
  });
});
