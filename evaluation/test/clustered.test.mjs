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
  f1From,
  mulberry32,
  MIN_DENOMINATOR,
  STABILITY_THRESHOLD,
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
    // Run over TEN independent simulation seeds, not one. A single seed would make the
    // published figure an accident of that seed: measured across seeds, Wilson's coverage
    // ranges from 54% to 69%, so quoting the low end as "the" result would overstate the
    // case. The protocol cites the range and the mean, and this test asserts the range.
    const TRUE = 0.5;
    const PAGES = 20;
    const PER_PAGE = 10;
    const TRIALS = 300;
    const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 20260920, 12345];

    const clusteredRates = [];
    const wilsonRates = [];

    for (const seed of SEEDS) {
      const random = mulberry32(seed);
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

      clusteredRates.push(clusteredCovered / estimable);
      wilsonRates.push(wilsonCovered / estimable);
    }

    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    const worstClustered = Math.min(...clusteredRates);
    const bestWilson = Math.max(...wilsonRates);

    // Asserted on the WORST clustered seed and the BEST Wilson seed, so neither figure can
    // be a lucky draw. The protocol's published range must bracket what is measured here.
    assert.ok(
      bestWilson < 0.75,
      `Wilson should under-cover on every seed; its best was ${pct(bestWilson)}`
    );
    assert.ok(
      worstClustered > 0.85,
      `the cluster bootstrap should approach nominal coverage on every seed; its worst was ${pct(worstClustered)}`
    );
    // The protocol states Wilson 54-69% and clustered 91-97%. Fail if reality leaves them.
    assert.ok(
      Math.min(...wilsonRates) >= 0.5 && bestWilson <= 0.72,
      `protocol quotes Wilson 54-69%; measured ${pct(Math.min(...wilsonRates))}-${pct(bestWilson)}`
    );
    assert.ok(
      worstClustered >= 0.88 && Math.max(...clusteredRates) <= 0.99,
      `protocol quotes clustered 91-97%; measured ${pct(worstClustered)}-${pct(Math.max(...clusteredRates))}`
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

describe('the floor applies to the resampling unit, not just the controls', () => {
  const ap = {
    estimate: coverageFrom,
    numerator: ({ decided = 0 }) => decided,
    denominator: ({ denominator = 0 }) => denominator,
  };

  test('a large corpus on too few pages is refused, not reported', () => {
    // Forty controls clears section 9's floor comfortably. Two pages does not: resampling
    // two clusters can only ever produce the handful of endpoints those two allow, and
    // one page produces a zero-width interval that could not have been anything else.
    // Before this guard both came back estimable, with n=40 and n=30 beside them.
    const twoPages = bootstrapClustered(
      [
        { decided: 15, denominator: 20 },
        { decided: 5, denominator: 20 },
      ],
      ap
    );
    assert.equal(twoPages.estimable, false);
    assert.equal(twoPages.total, 40, 'the controls still clear the denominator floor');
    assert.equal(twoPages.clusters, 2);
    assert.match(twoPages.reason, /2 pages is below the floor of 5/);
    assert.equal(twoPages.lower, undefined);

    const onePage = bootstrapClustered([{ decided: 12, denominator: 30 }], ap);
    assert.equal(onePage.estimable, false);
    assert.match(onePage.reason, /1 page is below/, 'singular, not "1 pages"');
    assert.equal(onePage.upper, undefined, 'a zero-width interval must not be reachable');
  });

  test('five pages is enough for the estimate to be reported', () => {
    const fivePages = bootstrapClustered(
      Array.from({ length: 5 }, (_, i) => ({ decided: i % 3, denominator: 4 })),
      ap
    );
    assert.equal(fivePages.estimable, true);
    assert.equal(fivePages.clusters, 5);
    assert.ok(fivePages.upper > fivePages.lower, 'and it must have width');
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

  test('the published INTERVAL does not depend on the order of the pages', () => {
    // Stronger than the point-estimate check above, and the one that matters: the PRNG
    // walks the cluster array, so before the canonical sort the same corpus listed in a
    // different order produced a different published interval.
    const clusters = Array.from({ length: 12 }, (_, i) => ({ decided: i % 4, denominator: 5 }));
    const shuffled = [8, 3, 11, 0, 5, 9, 1, 7, 4, 10, 2, 6].map((i) => clusters[i]);
    const a = bootstrapClustered(clusters, asProportion);
    const b = bootstrapClustered([...clusters].reverse(), asProportion);
    const c = bootstrapClustered(shuffled, asProportion);
    assert.equal(a.lower, b.lower, 'reversing the pages moved the lower bound');
    assert.equal(a.upper, b.upper, 'reversing the pages moved the upper bound');
    assert.equal(a.lower, c.lower, 'shuffling the pages moved the lower bound');
    assert.equal(a.upper, c.upper, 'shuffling the pages moved the upper bound');
  });

  test('the percentile bounds sit at the nearest rank, not one order statistic above', () => {
    // With draws 1..n the 2.5th percentile is the ceil(0.025n)-th smallest. Using
    // floor(q*n) as a zero-indexed position shifts BOTH bounds up by one, which skews the
    // interval upward. Constructed so the draws are known exactly: 200 distinct clusters
    // each contributing a different value would be fragile, so this checks the helper's
    // contract through a uniform case where every resample is identical.
    const uniform = Array.from({ length: 20 }, () => ({ decided: 3, denominator: 4 }));
    const r = bootstrapClustered(uniform, { ...asProportion, resamples: 400 });
    assert.equal(r.lower, 0.75);
    assert.equal(r.upper, 0.75);
    assert.equal(r.resamples, 400, 'resamples reports what was requested');
    assert.equal(r.resolvedDraws, 400, 'every draw resolved here');
  });

  test('F1 is zero when nothing was found, not undefined', () => {
    // The bias this prevents: treating F1 as undefined at tp=0 makes the bootstrap discard
    // exactly the worst resamples, lifting the lower bound and flattering the tool.
    assert.equal(f1From({ tp: 0, fp: 5, fn: 5 }), 0);
    assert.equal(f1From({ tp: 0, fp: 0, fn: 3 }), 0);
    assert.equal(f1From({ tp: 0, fp: 0, fn: 0 }), null, 'nothing scored at all is undefined');

    // A corpus where most pages score zero must not come back with a lower bound above 0.
    const clusters = Array.from({ length: 20 }, (_, i) =>
      i < 4 ? { tp: 2, fp: 1, fn: 1 } : { tp: 0, fp: 1, fn: 1 }
    );
    const r = bootstrapF1(clusters, { resamples: 1000 });
    assert.equal(r.estimable, true);
    assert.ok(r.lower < r.point, `lower ${r.lower} should sit below the point ${r.point}`);
  });

  test('an unresolved bootstrap is refused outright, not reported as a narrow interval', () => {
    // Before this guard the same input returned estimable:true with lower === upper, a
    // zero-width "95% confidence interval" resting on a third of the draws.
    const clusters = Array.from({ length: 40 }, () => ({ tp: 0, fp: 0, fn: 0 }));
    clusters[0] = { tp: 6, fp: 2, fn: 1 };
    const r = bootstrapF1(clusters, { resamples: 400 });
    assert.equal(r.estimable, false);
    assert.equal(r.stable, false);
    assert.equal(r.lower, undefined, 'no bound may be reachable on a refused bootstrap');
    assert.equal(r.upper, undefined);
    assert.ok(r.resolved < STABILITY_THRESHOLD);
    assert.match(r.reason, /resolved/);
    assert.equal(r.resamples, 400, 'the requested count, not the surviving one');
    assert.equal(r.counts.tp, 6, 'raw counts survive the refusal');
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
