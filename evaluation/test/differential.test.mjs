/**
 * The browser differential.
 *
 * This is the evaluation that needs no human ground truth. FormFair claims a control
 * excludes legitimate names; a browser is the thing that does the excluding; so each
 * finding is checked against whether a real browser, running that control's own declared
 * constraints, rejects a name the finding predicts.
 *
 * These tests guard the recorded evidence rather than re-running the browser: the browser
 * verdicts are a captured artefact, and an artefact that silently loses its shape would
 * make the comparison meaningless without failing anything.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browser = JSON.parse(readFileSync(join(here, '..', 'differential', 'browser-results.json'), 'utf8'));

describe('the recorded browser verdicts', () => {
  test('name and character grids are aligned for every control', () => {
    const n = browser.names.length;
    const c = browser.characters.length;
    for (const [id, row] of Object.entries(browser.controls)) {
      assert.equal(row.bits.length, n, `${id}: rejection bits must cover every name`);
      assert.equal(row.admit.length, c, `${id}: admission bits must cover every character`);
      assert.match(row.bits, /^[01]+$/);
      assert.match(row.admit, /^[01]+$/);
    }
    assert.equal(browser.decisions, Object.keys(browser.controls).length * n);
    assert.equal(browser.charDecisions, Object.keys(browser.controls).length * c);
  });

  test('it records which engine produced it', () => {
    // A differential whose engine is unknown cannot be reproduced or disputed.
    assert.match(browser.ua, /Chrome\/\d+/);
    assert.match(browser.capturedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(browser.harness, 'browser-differential-v2');
  });

  test('the browser confirms the HTML semantics the analyser relies on', () => {
    const at = (id) => browser.controls[id];
    const nameIdx = (pred) => browser.names.findIndex(pred);

    // An ABSENT pattern applies no constraint; a PRESENT BUT EMPTY one is compiled and
    // rejects every non-empty value. These differ, and a reimplementation got it wrong.
    assert.equal(at('H05').bits, '0'.repeat(browser.names.length), 'absent pattern rejects nothing');
    assert.equal(at('H04').bits, '1'.repeat(browser.names.length), 'empty pattern rejects everything non-empty');

    // An uncompilable pattern is IGNORED, not treated as rejecting everything.
    assert.equal(at('H06').compiles, false);
    assert.equal(at('H06').bits, '0'.repeat(browser.names.length), 'an invalid pattern applies no constraint');

    // maxlength alone splits a canonically equivalent pair: NFC fits, NFD does not.
    const nfc = nameIdx((n) => n.k === 'nfc' && n.units === 7);
    const nfd = nameIdx((n) => n.k === 'nfd' && n.units === 8);
    assert.equal(at('H12').bits[nfc], '0', 'the precomposed form fits maxlength 7');
    assert.equal(at('H12').bits[nfd], '1', 'the decomposed form does not');
  });

  test('characters witness admission that whole names cannot', () => {
    // The case that made a correct FF-02 finding look contradicted: this class admits two
    // letters outside Basic Latin while rejecting every fixture name, so only the
    // character sweep can see the admission.
    const danish = browser.controls.H09;
    const outside = browser.characters
      .map((c, i) => [c, i])
      .filter(([c]) => c.k === 'outside-fixture-set')
      .filter(([, i]) => danish.admit[i] === '1');
    assert.ok(outside.length >= 2, 'o-slash and a-ring are admitted');
    assert.equal(danish.bits.slice(1, 11), '1'.repeat(10), 'yet every fixture diacritic name is rejected');
  });
});
