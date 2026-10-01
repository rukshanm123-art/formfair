/**
 * Amendment 49: the test script must run every test file, not a list someone remembered to extend.
 *
 * `capture/package.json` named ten files explicitly, and CI runs that script. Seven newer files were
 * never added to it, so the job executed 445 tests while the suite contained 540 — including the
 * Amendment 48 regression suite written to hold the repair the same tags were created to freeze. No
 * test failed; the green badge simply proved less than it appeared to.
 *
 * This is the third time in this project that a hand-maintained list drifted from the thing it was
 * meant to enumerate: `capture-blocked` missing from the status totals, then `retrieved`, then
 * `eligible-not-selected`. The repair each time is the same — derive the list instead of retyping it
 * — and this test is the derivation checking itself.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const script = pkg.scripts.test;
const onDisk = readdirSync(new URL('.', import.meta.url))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

describe('the capture test script', () => {
  test('runs every test file by pattern, naming none individually', () => {
    // A glob cannot fall behind the directory; a list can, and did.
    assert.match(script, /node --test test\/\*\.test\.mjs/, `the test script is: ${script}`);
    const named = script
      .replace('node --test ', '')
      .trim()
      .split(/\s+/)
      .filter((arg) => arg.endsWith('.test.mjs') && !arg.includes('*'));
    assert.deepEqual(named, [], `the script still names files individually: ${named.join(', ')}`);
  });

  test('the suite it would run covers every file present', () => {
    // Belt and braces: if a future edit replaces the glob with a list, this fails too.
    const pattern = /test\/\*\.test\.mjs/.test(script);
    const covered = pattern
      ? onDisk
      : script.replace('node --test ', '').trim().split(/\s+/).map((a) => a.replace(/^test\//, ''));
    for (const file of onDisk) {
      assert.ok(covered.includes(file), `${file} is on disk but the test script would not run it`);
    }
  });

  test('this file is itself in the suite, so the guard cannot be skipped', () => {
    assert.ok(onDisk.includes('ci-covers-every-test.test.mjs'));
    assert.ok(onDisk.length >= 17, `only ${onDisk.length} test files found`);
  });
});
