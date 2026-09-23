import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FUZZ_PATTERNS, METAMORPHIC_CASES, MUTATION_CASES, RULE_IDS, form } from './cases.mjs';

export const SOLO_PROTOCOL = 'solo-protocol-v1.0.0';
export const FUZZ_SEED = 'formfair-solo-v1.0.0';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function outcomes(result) {
  return {
    controls: result.controls,
    findings: result.findings.map((f) => f.rule).sort(),
    declined: result.declined.map((d) => `${d.rule}:${d.reason}`).sort(),
    advisories: result.advisories.map((a) => a.code).sort(),
  };
}

/**
 * Browser verdicts, recorded from a real browser rather than recomputed here.
 *
 * This was a Node reimplementation of constraint validation - V8's regex engine, not a
 * browser's - while SOLO-PROTOCOL.md described the mutation study as browser-confirmed.
 * Reimplementing these semantics by hand has been wrong six separate times in this
 * project, most importantly on the case that matters here: a pattern that does not
 * compile is IGNORED by constraint validation, so the field accepts everything, whereas a
 * reimplementation naturally reports that its own check failed.
 *
 * `solo/browser-verdicts.json` is produced by opening `solo/browser-verify.html` in a
 * browser. A case with no recorded verdict THROWS rather than falling back, so the
 * evidence path cannot silently degrade to a reimplementation again.
 */
const VERDICTS = JSON.parse(
  readFileSync(new URL('./browser-verdicts.json', import.meta.url), 'utf8')
);

function browserCheck(spec, caseId) {
  const recorded = VERDICTS.results?.[caseId];
  if (!recorded) {
    throw new Error(
      `no recorded browser verdict for mutation case ${caseId}. ` +
        'Run `node solo/build-browser-verify.mjs`, open solo/browser-verify.html in a ' +
        'browser, and record the result in solo/browser-verdicts.json. This study will ' +
        'not substitute a Node reimplementation of constraint validation.'
    );
  }
  return {
    passed: recorded.expectationHolds,
    engine: VERDICTS.engine,
    capturedAt: VERDICTS.capturedAt,
    assertions: recorded.assertions,
    acceptsConfirmed: recorded.acceptsConfirmed,
    rejectsConfirmed: recorded.rejectsConfirmed,
  };
}

export function runMutationStudy(analyse) {
  const cases = MUTATION_CASES.map((testCase) => {
    const baseline = analyse(testCase.baselineHtml);
    const mutant = analyse(testCase.mutantHtml);
    const baselineClean =
      !baseline.findings.some((f) => f.rule === testCase.rule) &&
      !baseline.declined.some((d) => d.rule === testCase.rule);
    const mutantDetected = mutant.findings.some((f) => f.rule === testCase.rule);
    const browser = browserCheck(testCase.browser, testCase.id);
    return {
      id: testCase.id,
      rule: testCase.rule,
      family: testCase.family,
      baselineClean,
      mutantDetected,
      browserBehaviourConfirmed: browser.passed,
      passed: baselineClean && mutantDetected && browser.passed,
      browser,
    };
  });

  const byRule = Object.fromEntries(
    RULE_IDS.map((rule) => {
      const rows = cases.filter((c) => c.rule === rule);
      return [rule, {
        seeded: rows.length,
        detected: rows.filter((c) => c.mutantDetected).length,
        browserConfirmed: rows.filter((c) => c.browserBehaviourConfirmed).length,
        passed: rows.filter((c) => c.passed).length,
        score: rows.length === 0 ? null : rows.filter((c) => c.passed).length / rows.length,
      }];
    })
  );

  return {
    interpretation: 'Seeded-fault detection score; not precision, recall, or real-world accuracy.',
    total: cases.length,
    passed: cases.filter((c) => c.passed).length,
    score: cases.length === 0 ? null : cases.filter((c) => c.passed).length / cases.length,
    byRule,
    cases,
  };
}

export function runMetamorphicStudy(analyse) {
  const relations = METAMORPHIC_CASES.map((relation) => {
    const source = outcomes(analyse(relation.source));
    const followUp = outcomes(analyse(relation.followUp));
    const passed = JSON.stringify(source) === JSON.stringify(followUp);
    return { id: relation.id, relation: relation.relation, passed, source, followUp };
  });
  return {
    interpretation: 'Relations that should preserve the catalogue outcome without using a second human label.',
    total: relations.length,
    passed: relations.filter((r) => r.passed).length,
    relations,
  };
}

function seededRandom(seed) {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function runRobustnessStudy(analyse, { count = 1000, seed = FUZZ_SEED } = {}) {
  const random = seededRandom(seed);
  const failures = [];
  let declinedCases = 0;
  let malformedCases = 0;

  for (let i = 0; i < count; i++) {
    const pattern = FUZZ_PATTERNS[Math.floor(random() * FUZZ_PATTERNS.length)];
    const min = Math.floor(random() * 4);
    const max = min + Math.floor(random() * 10);
    const patternAttr = pattern === undefined ? '' : `pattern="${pattern}"`;
    const html = form(`${patternAttr} minlength="${min}" maxlength="${max}"`, i);
    try {
      const first = analyse(html);
      const second = analyse(html);
      const stable = JSON.stringify(first) === JSON.stringify(second);
      const bounded =
        first.controls === 1 &&
        first.findings.length <= RULE_IDS.length &&
        first.declined.length <= RULE_IDS.length;
      if (first.declined.length > 0) declinedCases += 1;
      if (pattern !== undefined && ['[', "[A-Za-z' -]+"].includes(pattern)) malformedCases += 1;
      if (!stable || !bounded) failures.push({ index: i, stable, bounded, pattern });
    } catch (error) {
      failures.push({ index: i, pattern, error: error.message });
    }
  }

  return {
    interpretation: 'Seeded robustness and determinism exercise; generated cases are not a population sample.',
    seed,
    cases: count,
    declinedCases,
    malformedCases,
    failures,
    passed: failures.length === 0,
  };
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};

export function runPerformanceStudy(analyse, { sizes = [10, 100, 1000], warmups = 3, runs = 15 } = {}) {
  const rows = sizes.map((size) => {
    const controls = Array.from({ length: size }, (_, i) =>
      form(i % 2 === 0 ? 'pattern="[A-Za-z]+"' : String.raw`pattern="[\p{L}\p{M}\u0027\u2019 \x2D]+"`, i)
    ).join('');
    for (let i = 0; i < warmups; i++) analyse(controls);
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      analyse(controls);
      samples.push(performance.now() - start);
    }
    return {
      controls: size,
      runs,
      medianMs: Number(quantile(samples, 0.5).toFixed(3)),
      p95Ms: Number(quantile(samples, 0.95).toFixed(3)),
      minMs: Number(Math.min(...samples).toFixed(3)),
      maxMs: Number(Math.max(...samples).toFixed(3)),
    };
  });
  return {
    interpretation: 'Descriptive runtime evidence only. Timings are not a CI pass/fail threshold.',
    rows,
  };
}

export function runSoloStudy({ analyse, instrument, includePerformance = false }) {
  const mutation = runMutationStudy(analyse);
  const metamorphic = runMetamorphicStudy(analyse);
  const robustness = runRobustnessStudy(analyse);
  const report = {
    schema: 'formfair/solo-technical-study@1',
    protocol: SOLO_PROTOCOL,
    instrument,
    claims: {
      supported: [
        'conformance to predeclared catalogue cases',
        'detection of seeded constraint faults',
        'specified metamorphic relations',
        'determinism and no-crash robustness over the seeded generator',
      ],
      notSupported: [
        'precision, recall, F1, or Cohen kappa against independent human ground truth',
        'prevalence of confirmed defects in New Zealand government forms',
        'cultural acceptability as judged by affected people or communities',
      ],
    },
    mutation,
    metamorphic,
    robustness,
    passed:
      mutation.passed === mutation.total &&
      metamorphic.passed === metamorphic.total &&
      robustness.passed,
  };
  if (includePerformance) report.performance = runPerformanceStudy(analyse);
  return report;
}
