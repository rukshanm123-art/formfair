/**
 * The report must name the statistics that produced it. Protocol and analyser are not
 * enough: the same labels give different intervals under harness-v1.0.6 and v1.1.0.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { harnessRef, HARNESS_VERSION } from '../src/harness-ref.mjs';
import { report } from '../src/metrics.mjs';
import { MIN_DENOMINATOR, STABILITY_THRESHOLD } from '../src/stats.mjs';

describe('harness provenance', () => {
  test('a report identifies the harness that produced it', () => {
    const r = report([]);
    assert.equal(r.harness.version, 'harness-v1.1.0');
    assert.equal(r.protocol, 'FormFair Held-Out Evaluation Protocol v1.0');
    assert.equal(r.instrument, 'evaluation-v1.0.0', 'the analyser tag is untouched');
  });

  test('the method is identifiable from the report alone, without the repository', () => {
    // A reader who has the JSON and not the git history must still be able to tell which
    // statistics ran. These constants, not the commit, are what determine the numbers.
    const m = harnessRef().intervalMethod;
    assert.equal(m.controlLevelProportions, 'page-cluster bootstrap');
    assert.equal(m.formLevelProportions, 'Wilson score interval');
    assert.equal(m.quantile, 'nearest rank');
    assert.equal(m.resamples, 2000);
    assert.equal(m.seed, 'evaluation-v1.0.0');
    assert.equal(m.minimumDenominator, MIN_DENOMINATOR);
    assert.equal(m.minimumContributingPages, MIN_DENOMINATOR);
    assert.equal(m.stabilityThreshold, STABILITY_THRESHOLD);
  });

  test('it reports whether the working tree was clean, not merely the commit', () => {
    // A commit alone does not prove the tree matched it. An official run generated from
    // uncommitted edits has to say so.
    const ref = harnessRef();
    assert.ok(ref.commit === null || /^[0-9a-f]{40}$/.test(ref.commit));
    assert.ok(ref.dirty === null || typeof ref.dirty === 'boolean');
    assert.equal(ref.taggedAtThisCommit, ref.tag === HARNESS_VERSION);
  });
});
