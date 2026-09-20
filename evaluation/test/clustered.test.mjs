/**
 * Amendment harness-v1.1.0: the generalised page-cluster bootstrap.
 *
 * These tests exist to attack the amendment rather than to demonstrate it. The claim
 * being made is narrow and falsifiable: where several observations share a page, a Wilson
 * interval on the pooled counts is too narrow, and resampling whole pages fixes it. If
 * that claim is wrong the amendment has no justification, so it is measured here rather
 * than asserted in prose.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapClustered,
  bootstrapF1,
  wilson,
  precisionFrom,
  recallFrom,
  coverageFrom,
  mulberry32,
  MIN_DENOMINATOR,
} from '../src/stats.mjs';

const asProportion = {
  estimate: coverageFrom,
  numerator: ({ decided = 0 }) => decided,
  denominator: ({ denominator = 0 }) => denominator,
};

describe('the amendment is justified, not merely asserted', () => {
  test('Wilson under-covers clustered data and the cluster bootstrap does not', () => {
    // The whole basis of harness-v1.1.0. Pages carry a rate drawn from Beta(1/2,1/2) -
    // the arcsine distribution, whose inverse CDF is sin^2(pi*u/2) - and controls within
    // a page share it. That is exactly the correlation Wilson assumes away. The true
    // population proportion is 0.5 by construction, so coverage can be counted.
    const TRUE = 0.5;
    const PAGES = 20;
    const PER_PAGE = 10;
    const TRIALS = 300;
    const random = mulberry32(20260920); // fixed: this test must not flake

    let estimable = 0;
    let clusteredCovered = 0;
    let wilsonCovered = 0;

    for (let t = 0; t < TRIALS; t++) {
      const clusters = [];
      for (let i = 0; i < PAGES; i++) {
        const rate = Math.sin((Math.PI * random()) / 2) ** 2;
        let decided = 0;
        for (let k = 0; k < PER_PAGE; k++) if (random() < rate) decided += 1;
        clusters.push({ decided, denominator: PER_PAGE });
      }

      const clustered = bootstrapClustered(clusters, {
        ...asProportion,
        resamples: 400,
        seed: `sim-${t}`,
      });
      if (!clustered.estimable) continue;
      estimable += 1;

      // Wilson gets the identical pooled counts, which is the point: same data, and the
      // only difference is what the interval assumes about how it was generated.
      const pooled = wilson(clustered.successes, clustered.total);
      if (clustered.lower <= TRUE && TRUE <= clustered.upper) clusteredCovered += 1;
      if (pooled.lower <= TRUE && TRUE <= pooled.upper) wilsonCovered += 1;
    }

    const clusteredRate = clusteredCovered / estimable;
    const wilsonRate = wilsonCovered / estimable;

    assert.ok(
      wilsonRate < 0.75,
      `a nominal 95% Wilson interval should badly under-cover here; it covered ${(wilsonRate * 100).toFixed(1)}%`
    );
    assert.ok(
      clusteredRate > 0.85,
      `the cluster bootstrap should approach nominal coverage; it covered ${(clusteredRate * 100).toFixed(1)}%`
    );
  });

  test('it does not simply widen everything - one observation per page stays close to Wilson', () => {
    // The guard against overcorrection. With a single observation per page there is no
    // within-page correlation to absorb, so the amendment must not inflate the interval;
    // if it did, the retained Wilson at form-level prevalence would be inconsistent.
    const clusters = Array.from({ length: 60 }, (_, i) => ({
      decided: i % 3 === 0 ? 1 : 0,
      denominator: 1,
    }));
    const clustered = bootstrapClustered(clusters, { ...asProportion, resamples: 2000 });
    const pooled = wilson(clustered.successes, clustered.total);

    assert.equal(clustered.successes, 20);
    assert.equal(clustered.total, 60);
    const clusteredWidth = clustered.upper - clustered.lower;
    const wilsonWidth = pooled.upper - pooled.lower;
    assert.ok(
      clusteredWidth < wilsonWidth * 1.35,
      `unclustered data should not be inflated: ${clusteredWidth.toFixed(3)} vs Wilson ${wilsonWidth.toFixed(3)}`
    );
  });
});

describe('the clustered result is interchangeable with a Wilson result', () => {
  const clusters = Array.from({ length: 10 }, (_, i) => ({
    decided: i % 2 === 0 ? 3 : 1,
    denominator: 4,
  }));

  test('it reports the same raw counts a Wilson interval would', () => {
    // The protocol requires raw counts beside every figure. A caller that swapped Wilson
    // for this must not silently lose them.
    const r = bootstrapClustered(clusters, asProportion);
    assert.equal(r.successes, 20);
    assert.equal(r.total, 40);
    assert.ok(Math.abs(r.point - 0.5) < 1e-12);
  });

  test('counts survive every not-estimable path, as they do for Wilson', () => {
    const belowFloor = bootstrapClustered([{ decided: 1, denominator: 2 }], asProportion);
    assert.equal(belowFloor.estimable, false);
    assert.equal(belowFloor.successes, 1);
    assert.equal(belowFloor.total, 2);

    const nothing = bootstrapClustered([], asProportion);
    assert.equal(nothing.estimable, false);
    assert.equal(nothing.total, 0);
  });

  test('no point estimate is reachable when the figure is not estimable', () => {
    // The rule wilson() enforces: a number sitting next to estimable:false is one
    // property access away from being printed as a result.
    for (const bad of [
      bootstrapClustered([{ decided: 1, denominator: 2 }], asProportion),
      bootstrapClustered([], asProportion),
      bootstrapClustered([{ decided: 0, denominator: 0 }], asProportion),
    ]) {
      assert.equal(bad.estimable, false);
      assert.equal(bad.point, undefined);
      assert.equal(bad.lower, undefined);
      assert.equal(bad.upper, undefined);
      assert.ok(typeof bad.reason === 'string' && bad.reason.length > 0);
    }
  });

  test('successes never exceed the total, for any measure', () => {
    const mixed = [
      { tp: 4, fp: 1, fn: 2 },
      { tp: 0, fp: 3, fn: 1 },
      { tp: 7, fp: 0, fn: 0 },
    ];
    const precision = bootstrapClustered(mixed, {
      estimate: precisionFrom,
      numerator: ({ tp = 0 }) => tp,
      denominator: ({ tp = 0, fp = 0 }) => tp + fp,
    });
    const recall = bootstrapClustered(mixed, {
      estimate: recallFrom,
      numerator: ({ tp = 0 }) => tp,
      denominator: ({ tp = 0, fn = 0 }) => tp + fn,
    });
    assert.ok(precision.successes <= precision.total);
    assert.ok(recall.successes <= recall.total);
    assert.equal(precision.total, 15); // 11 tp + 4 fp
    assert.equal(recall.total, 14); // 11 tp + 3 fn
  });

  test('F1 reports a total but no successes, because it is not a proportion', () => {
    // Reading `successes` off an F1 and treating it as a numerator would be wrong, so
    // the field is absent rather than plausible.
    const r = bootstrapF1([
      { tp: 4, fp: 1, fn: 2 },
      { tp: 3, fp: 2, fn: 1 },
    ]);
    assert.equal(r.successes, undefined);
    assert.equal(r.total, 13);
  });
});

describe('the estimability floor applies per measure', () => {
  test('precision can be refused while recall on the same counts is reported', () => {
    // Each measure has its own denominator, so one can be below the floor while the
    // other is not. Applying a single floor to both would publish a figure resting on
    // four observations.
    const clusters = Array.from({ length: 8 }, () => ({ tp: 0, fp: 0, fn: 3 }));
    clusters[0] = { tp: 2, fp: 2, fn: 3 };

    const precision = bootstrapClustered(clusters, {
      estimate: precisionFrom,
      numerator: ({ tp = 0 }) => tp,
      denominator: ({ tp = 0, fp = 0 }) => tp + fp,
    });
    const recall = bootstrapClustered(clusters, {
      estimate: recallFrom,
      numerator: ({ tp = 0 }) => tp,
      denominator: ({ tp = 0, fn = 0 }) => tp + fn,
    });

    assert.equal(precision.total, 4);
    assert.equal(precision.estimable, false);
    assert.match(precision.reason, new RegExp(`below ${MIN_DENOMINATOR}`));
    assert.equal(recall.estimable, true);
    assert.equal(recall.total, 26);
  });
});

describe('it refuses to be fooled by the input', () => {
  test('malformed clusters are dropped rather than poisoning the sums', () => {
    const r = bootstrapClustered(
      [
        { decided: 3, denominator: 5 },
        null,
        undefined,
        'a page',
        42,
        { decided: 2, denominator: 5 },
        { decided: Number.NaN, denominator: Number.POSITIVE_INFINITY },
      ],
      asProportion
    );
    assert.equal(r.successes, 5);
    assert.equal(r.total, 10);
    assert.equal(r.clusters, 3, 'the NaN page counts as a cluster, but contributes nothing');
  });

  test('a missing estimate or denominator is a programming error, not a silent zero', () => {
    assert.throws(() => bootstrapClustered([{ decided: 1, denominator: 1 }]), TypeError);
    assert.throws(
      () => bootstrapClustered([{ decided: 1, denominator: 1 }], { estimate: coverageFrom }),
      TypeError
    );
  });

  test('the point estimate does not depend on the order of the pages', () => {
    const clusters = Array.from({ length: 12 }, (_, i) => ({
      decided: i % 4,
      denominator: 5,
    }));
    const reversed = [...clusters].reverse();
    const a = bootstrapClustered(clusters, asProportion);
    const b = bootstrapClustered(reversed, asProportion);
    assert.equal(a.point, b.point);
    assert.equal(a.successes, b.successes);
    assert.equal(a.total, b.total);
  });

  test('a bootstrap that mostly fails to resolve is marked unstable, not narrow', () => {
    // One page carries every scored observation. Most resamples draw none of it, so the
    // estimate is undefined and the surviving draws are all identical - an interval of
    // zero width that means nothing. The protocol wants that flagged.
    const clusters = Array.from({ length: 40 }, () => ({ tp: 0, fp: 0, fn: 0 }));
    clusters[0] = { tp: 6, fp: 2, fn: 1 };
    const r = bootstrapF1(clusters, { resamples: 400 });
    assert.ok(r.resolved < 0.95, `resolved was ${r.resolved}`);
    assert.equal(r.stable, false);
  });

  test('a fully resolved bootstrap is marked stable', () => {
    const clusters = Array.from({ length: 12 }, (_, i) => ({
      tp: 3 + (i % 3),
      fp: i % 2,
      fn: (i + 1) % 2,
    }));
    const r = bootstrapF1(clusters, { resamples: 400 });
    assert.equal(r.resolved, 1);
    assert.equal(r.stable, true);
  });

  test('the interval is reproducible from the seed alone', () => {
    const clusters = Array.from({ length: 15 }, (_, i) => ({
      decided: i % 5,
      denominator: 6,
    }));
    const a = bootstrapClustered(clusters, { ...asProportion, resamples: 500, seed: 'held-out' });
    const b = bootstrapClustered(clusters, { ...asProportion, resamples: 500, seed: 'held-out' });
    const c = bootstrapClustered(clusters, { ...asProportion, resamples: 500, seed: 'other' });
    assert.deepEqual([a.lower, a.upper], [b.lower, b.upper]);
    assert.notDeepEqual([a.lower, a.upper], [c.lower, c.upper]);
    assert.equal(a.method, 'page-cluster bootstrap');
    assert.equal(a.seed, 'held-out');
  });
});
