import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, cohensKappa, bootstrapF1, f1From, mulberry32 } from '../src/stats.mjs';

describe('Wilson interval', () => {
  test('brackets the point estimate and stays inside [0,1]', () => {
    const r = wilson(7, 10);
    assert.equal(r.estimable, true);
    assert.ok(r.lower < r.point && r.point < r.upper);
    assert.ok(r.lower >= 0 && r.upper <= 1);
  });

  test('does not run below zero at a boundary, unlike the normal approximation', () => {
    const r = wilson(0, 20);
    assert.equal(r.point, 0);
    assert.ok(r.lower >= 0);
    assert.ok(r.upper > 0, 'an interval at zero successes should still have width');
  });

  test('matches the published value for 10 of 20', () => {
    const r = wilson(10, 20);
    assert.ok(Math.abs(r.lower - 0.299) < 0.002, `lower was ${r.lower}`);
    assert.ok(Math.abs(r.upper - 0.701) < 0.002, `upper was ${r.upper}`);
  });

  test('refuses to report a denominator below five', () => {
    const r = wilson(2, 4);
    assert.equal(r.estimable, false);
    assert.match(r.reason, /below 5/);
  });

  test('is not estimable with no observations', () => {
    assert.equal(wilson(0, 0).estimable, false);
  });
});

describe("Cohen's kappa", () => {
  test('is 1 for perfect agreement', () => {
    const labels = ['positive', 'negative', 'positive', 'negative'];
    assert.equal(cohensKappa(labels, labels).kappa, 1);
  });

  test('is 0 when agreement is exactly what chance predicts', () => {
    const a = ['positive', 'positive', 'negative', 'negative'];
    const b = ['positive', 'negative', 'positive', 'negative'];
    assert.equal(cohensKappa(a, b).kappa, 0);
  });

  test('is negative when agreement is worse than chance', () => {
    const a = ['positive', 'positive', 'negative', 'negative'];
    const b = ['negative', 'negative', 'positive', 'positive'];
    assert.ok(cohensKappa(a, b).kappa < 0);
  });

  test('is not estimable when both annotators used one category', () => {
    const all = ['positive', 'positive', 'positive'];
    const r = cohensKappa(all, all);
    assert.equal(r.estimable, false);
    assert.match(r.reason, /single category/);
    assert.equal(r.percentageAgreement, 1, 'agreement is still reported');
  });

  test('reports percentage agreement and label counts alongside', () => {
    const r = cohensKappa(
      ['positive', 'negative', 'positive'],
      ['positive', 'negative', 'negative']
    );
    assert.equal(r.percentageAgreement, 2 / 3);
    assert.equal(r.counts.disagreements, 1);
    assert.equal(r.counts.n, 3);
  });
});

describe('bootstrap F1', () => {
  // Heterogeneous on purpose: identical clusters make every resample identical, so the
  // interval collapses to a point and no seed can move it.
  const clusters = Array.from({ length: 12 }, (_, i) => ({
    tp: 3 + (i % 3),
    fp: i % 2,
    fn: (i + 1) % 2,
  }));
  const totals = clusters.reduce(
    (acc, c) => ({ tp: acc.tp + c.tp, fp: acc.fp + c.fp, fn: acc.fn + c.fn }),
    { tp: 0, fp: 0, fn: 0 }
  );

  test('brackets the point estimate', () => {
    const r = bootstrapF1(clusters);
    assert.equal(r.estimable, true);
    assert.ok(Math.abs(r.point - f1From(totals)) < 1e-12);
    assert.ok(r.lower <= r.point && r.point <= r.upper);
  });

  test('collapses to a point when every cluster is identical', () => {
    // Not a defect: with no between-page variation there is nothing to resample.
    const uniform = Array.from({ length: 12 }, () => ({ tp: 3, fp: 1, fn: 1 }));
    const r = bootstrapF1(uniform, { resamples: 200 });
    assert.equal(r.lower, r.upper);
  });

  test('is reproducible from the seed', () => {
    const a = bootstrapF1(clusters, { resamples: 500 });
    const b = bootstrapF1(clusters, { resamples: 500 });
    assert.deepEqual([a.lower, a.upper], [b.lower, b.upper]);
  });

  test('a different seed gives a different interval', () => {
    const a = bootstrapF1(clusters, { resamples: 500, seed: 'one' });
    const b = bootstrapF1(clusters, { resamples: 500, seed: 'two' });
    assert.notDeepEqual([a.lower, a.upper], [b.lower, b.upper]);
  });

  test('resamples pages, so within-page correlation widens the interval', () => {
    // The same 40 pairs, concentrated on 4 pages rather than spread over 40. Clustered
    // data carries less information and the interval must reflect that.
    const spread = Array.from({ length: 40 }, (_, i) =>
      i < 30 ? { tp: 1, fp: 0, fn: 0 } : { tp: 0, fp: 1, fn: 0 }
    );
    const clumped = [
      { tp: 10, fp: 0, fn: 0 },
      { tp: 10, fp: 0, fn: 0 },
      { tp: 10, fp: 0, fn: 0 },
      { tp: 0, fp: 10, fn: 0 },
    ];
    const widthOf = (r) => r.upper - r.lower;
    assert.ok(widthOf(bootstrapF1(clumped)) > widthOf(bootstrapF1(spread)));
  });

  test('is not estimable below the minimum denominator', () => {
    assert.equal(bootstrapF1([{ tp: 1, fp: 1, fn: 1 }]).estimable, false);
  });
});

describe('the PRNG', () => {
  test('stays in [0,1) and does not immediately repeat', () => {
    const random = mulberry32(12345);
    const draws = Array.from({ length: 1000 }, random);
    assert.ok(draws.every((d) => d >= 0 && d < 1));
    assert.ok(new Set(draws).size > 990);
  });
});
