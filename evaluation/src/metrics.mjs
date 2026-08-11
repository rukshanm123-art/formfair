/**
 * Protocol section 9.
 *
 * Three different questions are asked of the same run, and they have different
 * denominators. Keeping them apart is the point:
 *
 *   Stage one   - of the controls a human called personal-name controls, how many did
 *                 FormFair find? Denominator: every supported text/search input.
 *   Stage two   - where FormFair found the control and reached a decision, was the
 *                 decision right? Denominator: decided pairs on detected controls.
 *   End to end  - what does a user actually get? Denominator: every ground-truth
 *                 rule-control pair, including those on controls FormFair never saw.
 *
 * Stage two flatters the tool, because it conditions on the tool having succeeded
 * earlier. End to end is the honest headline. Both are reported.
 */

import { bootstrapF1, cohensKappa, wilson, f1From, MIN_DENOMINATOR } from './stats.mjs';

export const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];

const emptyCounts = () => ({ tp: 0, fp: 0, fn: 0, tn: 0, declinedOnNegative: 0, notReached: 0 });

function score(counts, clusters, label) {
  const precision = wilson(counts.tp, counts.tp + counts.fp);
  const recall = wilson(counts.tp, counts.tp + counts.fn);
  return {
    label,
    counts: { ...counts },
    precision,
    recall,
    f1: bootstrapF1(clusters),
    pointF1: f1From(counts),
  };
}

/**
 * Stage one, over every supported input in the ground truth - not merely the ones
 * FormFair returned. Scoring only what the tool found would hide exactly the failure
 * this measures, which is why the protocol requires annotating all of them.
 */
export function stageOne(pages) {
  const counts = emptyCounts();
  const clusters = [];

  for (const page of pages) {
    const cluster = { tp: 0, fp: 0, fn: 0 };
    for (const control of page.controls) {
      const truth = control.isNameControl === true;
      const found = control.detected === true;
      if (truth && found) cluster.tp += 1;
      else if (!truth && found) cluster.fp += 1;
      else if (truth && !found) cluster.fn += 1;
      else counts.tn += 1;
    }
    counts.tp += cluster.tp;
    counts.fp += cluster.fp;
    counts.fn += cluster.fn;
    clusters.push(cluster);
  }

  return score(counts, clusters, 'stage-one');
}

/**
 * Stage two for one rule, over decided pairs on controls FormFair detected.
 *
 * Declines are excluded from this denominator by construction - a decline is not a
 * wrong answer, it is the absence of one - and are reported as decision coverage.
 */
export function stageTwo(pages, rule) {
  const counts = emptyCounts();
  const clusters = [];
  let decided = 0;
  let decidable = 0;

  for (const page of pages) {
    const cluster = { tp: 0, fp: 0, fn: 0 };
    for (const control of page.controls) {
      if (control.isNameControl !== true || control.detected !== true) continue;
      const truth = control.rules?.[rule];
      const outcome = control.outcomes?.[rule];
      if (truth === undefined || outcome === undefined) continue;

      decidable += 1;
      if (outcome === 'declined') {
        if (truth === 'negative') counts.declinedOnNegative += 1;
        continue;
      }
      decided += 1;

      const fired = outcome === 'finding';
      if (truth === 'positive' && fired) cluster.tp += 1;
      else if (truth === 'negative' && fired) cluster.fp += 1;
      else if (truth === 'positive' && !fired) cluster.fn += 1;
      else counts.tn += 1;
    }
    counts.tp += cluster.tp;
    counts.fp += cluster.fp;
    counts.fn += cluster.fn;
    clusters.push(cluster);
  }

  return {
    ...score(counts, clusters, `stage-two:${rule}`),
    decisionCoverage: wilson(decided, decidable),
  };
}

/**
 * End to end for one rule, over every ground-truth pair.
 *
 * The four cases the protocol fixes:
 *   a missed name control carrying a positive rule   -> false negative
 *   a positive case FormFair declines                -> false negative
 *   a decline on a negative case                     -> neither; it reduces coverage
 *   a finding on a negative case                     -> false positive
 *
 * A negative pair on a control that was never detected is recorded as `notReached`
 * rather than a true negative. It cannot enter precision, recall or F1 in any case,
 * and counting it as a success would let a detection failure look like an accuracy.
 */
export function endToEnd(pages, rule) {
  const counts = emptyCounts();
  const clusters = [];
  let decided = 0;
  let allPairs = 0;

  for (const page of pages) {
    const cluster = { tp: 0, fp: 0, fn: 0 };
    for (const control of page.controls) {
      if (control.isNameControl !== true) continue;
      const truth = control.rules?.[rule];
      if (truth === undefined) continue;
      allPairs += 1;

      if (control.detected !== true) {
        if (truth === 'positive') cluster.fn += 1;
        else counts.notReached += 1;
        continue;
      }

      const outcome = control.outcomes?.[rule];
      if (outcome === 'declined' || outcome === undefined) {
        if (truth === 'positive') cluster.fn += 1;
        else counts.declinedOnNegative += 1;
        continue;
      }
      decided += 1;

      const fired = outcome === 'finding';
      if (truth === 'positive' && fired) cluster.tp += 1;
      else if (truth === 'negative' && fired) cluster.fp += 1;
      else if (truth === 'positive' && !fired) cluster.fn += 1;
      else counts.tn += 1;
    }
    counts.tp += cluster.tp;
    counts.fp += cluster.fp;
    counts.fn += cluster.fn;
    clusters.push(cluster);
  }

  return {
    ...score(counts, clusters, `end-to-end:${rule}`),
    decisionCoverage: wilson(decided, allPairs),
  };
}

/** Micro-aggregation: pool the pairs across rules, rather than averaging five F1s. */
export function micro(pages, scorer) {
  const counts = emptyCounts();
  const clusters = [];
  for (const page of pages) {
    const cluster = { tp: 0, fp: 0, fn: 0 };
    for (const rule of RULES) {
      const perRule = scorer([page], rule);
      cluster.tp += perRule.counts.tp;
      cluster.fp += perRule.counts.fp;
      cluster.fn += perRule.counts.fn;
      counts.tn += perRule.counts.tn;
      counts.declinedOnNegative += perRule.counts.declinedOnNegative;
      counts.notReached += perRule.counts.notReached;
    }
    counts.tp += cluster.tp;
    counts.fp += cluster.fp;
    counts.fn += cluster.fn;
    clusters.push(cluster);
  }
  return score(counts, clusters, 'micro');
}

/** Prevalence from adjudicated ground truth, at both levels the protocol asks for. */
export function prevalence(pages) {
  const nameControls = pages.flatMap((p) => p.controls.filter((c) => c.isNameControl === true));
  const perRule = {};
  for (const rule of RULES) {
    const withLabel = nameControls.filter((c) => c.rules?.[rule] !== undefined);
    const positive = withLabel.filter((c) => c.rules[rule] === 'positive');
    const pagesAffected = pages.filter((p) =>
      p.controls.some((c) => c.isNameControl === true && c.rules?.[rule] === 'positive')
    );
    perRule[rule] = {
      control: wilson(positive.length, withLabel.length),
      form: wilson(pagesAffected.length, pages.length),
    };
  }
  return {
    pages: pages.length,
    supportedInputs: pages.reduce((n, p) => n + p.controls.length, 0),
    nameControls: nameControls.length,
    perRule,
  };
}

/**
 * Advisories and delegated findings, counted but never scored. They are returned from a
 * separate function with no precision or recall so that they cannot be pooled into the
 * accuracy figures by accident.
 */
export function unscored(pages) {
  const withAdvisory = pages.filter((p) => (p.advisories?.length ?? 0) > 0);
  const delegated = pages.flatMap((p) => p.delegatedFindings ?? []);
  const byRuleId = {};
  for (const f of delegated) byRuleId[f.ruleId] = (byRuleId[f.ruleId] ?? 0) + 1;
  return {
    scored: false,
    advisories: {
      formPrevalence: wilson(withAdvisory.length, pages.length),
      total: pages.reduce((n, p) => n + (p.advisories?.length ?? 0), 0),
    },
    delegated: { total: delegated.length, byRuleId },
  };
}

/** Held-out agreement, from the two primary annotators' original independent labels. */
export function heldOutAgreement(raterA, raterB) {
  const pick = (rows, key) => rows.map((r) => r[key]);
  const out = {
    stageOne: cohensKappa(pick(raterA.stageOne, 'label'), pick(raterB.stageOne, 'label')),
    perRule: {},
  };
  const pooledA = [];
  const pooledB = [];
  for (const rule of RULES) {
    const a = pick(raterA.rules[rule] ?? [], 'label');
    const b = pick(raterB.rules[rule] ?? [], 'label');
    out.perRule[rule] = cohensKappa(a, b);
    pooledA.push(...a);
    pooledB.push(...b);
  }
  out.pooled = cohensKappa(pooledA, pooledB);
  return out;
}

export function report(pages) {
  const perRule = {};
  for (const rule of RULES) {
    perRule[rule] = { stageTwo: stageTwo(pages, rule), endToEnd: endToEnd(pages, rule) };
  }
  return {
    protocol: 'FormFair Held-Out Evaluation Protocol v1.0',
    instrument: 'evaluation-v1.0.0',
    minimumDenominator: MIN_DENOMINATOR,
    stageOne: stageOne(pages),
    perRule,
    micro: { stageTwo: micro(pages, stageTwo), endToEnd: micro(pages, endToEnd) },
    prevalence: prevalence(pages),
    unscored: unscored(pages),
  };
}
