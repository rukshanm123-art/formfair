import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stageOne, stageTwo, endToEnd, prevalence, unscored, heldOutAgreement } from '../src/metrics.mjs';
import { f1From } from '../src/stats.mjs';

/**
 * Synthetic pages only. Protocol section 4: the harness is built and tested against
 * development material, never against a captured page.
 */
const page = (id, controls) => ({ pageId: id, controls });
const control = (id, opts) => ({ controlId: id, ...opts });

describe('stage one', () => {
  test('counts every supported input, not only what the tool returned', () => {
    // The second control is a name field the tool missed. Scoring only detected
    // controls would make this page look perfect.
    const r = stageOne([
      page('p1', [
        control('a', { isNameControl: true, detected: true }),
        control('b', { isNameControl: true, detected: false }),
        control('c', { isNameControl: false, detected: false }),
      ]),
    ]);
    assert.deepEqual(
      { tp: r.counts.tp, fp: r.counts.fp, fn: r.counts.fn, tn: r.counts.tn },
      { tp: 1, fp: 0, fn: 1, tn: 1 }
    );
    assert.equal(f1From(r.counts), (2 * 1 * 0.5) / 1.5);
  });

  test('a control detected but not a name is a false positive', () => {
    const r = stageOne([page('p1', [control('a', { isNameControl: false, detected: true })])]);
    assert.equal(r.counts.fp, 1);
  });
});

describe('stage two', () => {
  const pages = [
    page('p1', [
      control('a', {
        isNameControl: true,
        detected: true,
        rules: { 'FF-01': 'positive', 'FF-02': 'negative' },
        outcomes: { 'FF-01': 'finding', 'FF-02': 'finding' },
      }),
      control('b', {
        isNameControl: true,
        detected: true,
        rules: { 'FF-01': 'positive', 'FF-02': 'negative' },
        outcomes: { 'FF-01': 'declined', 'FF-02': 'declined' },
      }),
    ]),
  ];

  test('excludes declines from the denominator rather than scoring them', () => {
    const r = stageTwo(pages, 'FF-01');
    assert.equal(r.counts.tp, 1);
    assert.equal(r.counts.fn, 0, 'a decline is not a wrong answer at stage two');
    // Two pairs is below the reporting threshold, so the counts are the honest figure.
    assert.equal(r.decisionCoverage.successes, 1);
    assert.equal(r.decisionCoverage.total, 2);
  });

  test('a finding on a negative label is a false positive', () => {
    assert.equal(stageTwo(pages, 'FF-02').counts.fp, 1);
  });

  test('ignores controls the tool never detected', () => {
    const missed = [
      page('p1', [
        control('a', {
          isNameControl: true,
          detected: false,
          rules: { 'FF-01': 'positive' },
          outcomes: {},
        }),
      ]),
    ];
    const r = stageTwo(missed, 'FF-01');
    assert.equal(r.counts.tp + r.counts.fp + r.counts.fn + r.counts.tn, 0);
  });
});

describe('end to end', () => {
  test('a missed name control carrying a positive rule is a false negative', () => {
    const r = endToEnd(
      [
        page('p1', [
          control('a', { isNameControl: true, detected: false, rules: { 'FF-01': 'positive' } }),
        ]),
      ],
      'FF-01'
    );
    assert.equal(r.counts.fn, 1);
  });

  test('a positive case the tool declines is a false negative', () => {
    const r = endToEnd(
      [
        page('p1', [
          control('a', {
            isNameControl: true,
            detected: true,
            rules: { 'FF-01': 'positive' },
            outcomes: { 'FF-01': 'declined' },
          }),
        ]),
      ],
      'FF-01'
    );
    assert.equal(r.counts.fn, 1);
  });

  test('a decline on a negative case is neither a false positive nor a true negative', () => {
    const r = endToEnd(
      [
        page('p1', [
          control('a', {
            isNameControl: true,
            detected: true,
            rules: { 'FF-01': 'negative' },
            outcomes: { 'FF-01': 'declined' },
          }),
        ]),
      ],
      'FF-01'
    );
    assert.equal(r.counts.fp, 0);
    assert.equal(r.counts.tn, 0);
    assert.equal(r.counts.declinedOnNegative, 1);
    assert.equal(r.decisionCoverage.successes, 0, 'it reduces decision coverage instead');
    assert.equal(r.decisionCoverage.total, 1);
  });

  test('a finding on a negative case is a false positive', () => {
    const r = endToEnd(
      [
        page('p1', [
          control('a', {
            isNameControl: true,
            detected: true,
            rules: { 'FF-01': 'negative' },
            outcomes: { 'FF-01': 'finding' },
          }),
        ]),
      ],
      'FF-01'
    );
    assert.equal(r.counts.fp, 1);
  });

  test('a negative pair on an undetected control is not banked as a success', () => {
    const r = endToEnd(
      [
        page('p1', [
          control('a', { isNameControl: true, detected: false, rules: { 'FF-01': 'negative' } }),
        ]),
      ],
      'FF-01'
    );
    assert.equal(r.counts.tn, 0);
    assert.equal(r.counts.notReached, 1);
  });

  test('is never more favourable than stage two on the same data', () => {
    // Stage two conditions on detection having succeeded, so it cannot be the lower of
    // the two. This is why both are reported.
    const pages = [
      page('p1', [
        control('a', {
          isNameControl: true,
          detected: true,
          rules: { 'FF-01': 'positive' },
          outcomes: { 'FF-01': 'finding' },
        }),
        control('b', { isNameControl: true, detected: false, rules: { 'FF-01': 'positive' } }),
      ]),
    ];
    assert.ok(f1From(endToEnd(pages, 'FF-01').counts) < f1From(stageTwo(pages, 'FF-01').counts));
  });
});

describe('prevalence and unscored output', () => {
  const pages = [
    page('p1', [
      control('a', { isNameControl: true, rules: { 'FF-01': 'positive' } }),
      control('b', { isNameControl: false }),
    ]),
    page('p2', [control('c', { isNameControl: true, rules: { 'FF-01': 'negative' } })]),
  ];

  test('reports prevalence at both the control and the form level', () => {
    const p = prevalence(pages);
    assert.equal(p.nameControls, 2);
    assert.equal(p.supportedInputs, 3);
    assert.equal(p.perRule['FF-01'].control.successes, 1);
    assert.equal(p.perRule['FF-01'].control.total, 2);
    assert.equal(p.perRule['FF-01'].form.successes, 1);
    assert.equal(p.perRule['FF-01'].form.total, 2);
  });

  test('advisories and delegated findings are returned without precision or recall', () => {
    const u = unscored([
      { ...pages[0], advisories: [{ code: 'ADV-NORM-BOUNDARY' }] },
      { ...pages[1], delegatedFindings: [{ ruleId: 'label' }] },
    ]);
    assert.equal(u.scored, false);
    assert.equal(u.advisories.total, 1);
    assert.equal(u.delegated.byRuleId.label, 1);
    assert.equal(u.precision, undefined);
    assert.equal(u.recall, undefined);
  });
});

describe('held-out agreement', () => {
  test('reports stage one, each rule and the pooled pairs', () => {
    const a = {
      stageOne: [{ label: 'positive' }, { label: 'negative' }],
      rules: { 'FF-01': [{ label: 'positive' }, { label: 'negative' }] },
    };
    const b = {
      stageOne: [{ label: 'positive' }, { label: 'positive' }],
      rules: { 'FF-01': [{ label: 'positive' }, { label: 'negative' }] },
    };
    const r = heldOutAgreement(a, b);
    assert.equal(r.perRule['FF-01'].kappa, 1);
    assert.ok('pooled' in r);
    assert.ok('estimable' in r.stageOne);
  });
});

describe('nothing that looks like an estimate survives below the threshold', () => {
  test('a score below five pairs carries no point, and no interval', () => {
    const r = stageOne([
      page('p1', [control('a', { isNameControl: true, detected: true })]),
    ]);
    for (const field of ['precision', 'recall']) {
      assert.equal(r[field].estimable, false);
      assert.equal(r[field].point, undefined, `${field} must not expose a point estimate`);
      assert.equal(r[field].lower, undefined, `${field} must not expose an interval`);
      assert.equal(r[field].upper, undefined, `${field} must not expose an interval`);
    }
    assert.equal(r.f1.estimable, false);
    assert.equal(r.f1.point, undefined, 'F1 must not expose a point estimate');
    assert.equal(r.pointF1, undefined, 'no bare point estimate is emitted at all');
  });

  test('the counts and the reason are still reported, so the gap is visible', () => {
    const r = stageOne([page('p1', [control('a', { isNameControl: true, detected: true })])]);
    assert.match(r.precision.reason, /below 5/);
    assert.equal(r.precision.total, 1);
    assert.equal(r.counts.tp, 1);
  });
});

describe('decision coverage is estimable once there is enough of it', () => {
  test('reports a point and an interval above the threshold', () => {
    const pages = Array.from({ length: 8 }, (_, i) =>
      page(`p${i}`, [
        control('a', {
          isNameControl: true,
          detected: true,
          rules: { 'FF-01': 'positive' },
          outcomes: { 'FF-01': i < 6 ? 'finding' : 'declined' },
        }),
      ])
    );
    const r = stageTwo(pages, 'FF-01');
    assert.equal(r.decisionCoverage.estimable, true);
    assert.equal(r.decisionCoverage.point, 0.75);
    assert.ok(r.decisionCoverage.lower < 0.75 && r.decisionCoverage.upper > 0.75);
  });
});
