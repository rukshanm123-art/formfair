import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSoloInstrument } from '../instrument.mjs';
import {
  FUZZ_SEED,
  runMetamorphicStudy,
  runMutationStudy,
  runPerformanceStudy,
  runRobustnessStudy,
  runSoloStudy,
} from '../study.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const { identity, core } = await loadSoloInstrument(repo, { development: true });

describe('seeded mutation experiment', () => {
  test('exercises five browser-confirmed mutation families for every rule', () => {
    const report = runMutationStudy(core.analyse);
    assert.equal(report.total, 25);
    assert.equal(report.passed, 25, report.cases.filter((c) => !c.passed).map((c) => c.id).join(', '));
    for (const [rule, row] of Object.entries(report.byRule)) {
      assert.equal(row.seeded, 5, rule);
      assert.equal(row.detected, 5, rule);
      assert.equal(row.browserConfirmed, 5, rule);
      assert.equal(row.score, 1, rule);
    }
    assert.match(report.interpretation, /not precision, recall/i);
  });
});

describe('metamorphic testing', () => {
  test('all predeclared outcome-preserving relations hold', () => {
    const report = runMetamorphicStudy(core.analyse);
    assert.equal(report.total, 5);
    assert.equal(report.passed, report.total, JSON.stringify(report.relations.filter((r) => !r.passed)));
  });
});

describe('seeded robustness testing', () => {
  test('is deterministic and does not crash or multiply outcomes', () => {
    const a = runRobustnessStudy(core.analyse, { count: 250, seed: FUZZ_SEED });
    const b = runRobustnessStudy(core.analyse, { count: 250, seed: FUZZ_SEED });
    assert.deepEqual(a, b);
    assert.equal(a.passed, true, JSON.stringify(a.failures));
    assert.ok(a.declinedCases > 0, 'the generator must exercise the decline path');
    assert.ok(a.malformedCases > 0, 'the generator must exercise malformed patterns');
  });
});

describe('finished technical report', () => {
  test('states both its supported claims and its hard limits in the artefact', () => {
    const report = runSoloStudy({ analyse: core.analyse, instrument: identity });
    assert.equal(report.passed, true);
    assert.match(report.claims.notSupported.join(' '), /precision, recall, F1/i);
    assert.match(report.claims.notSupported.join(' '), /prevalence/i);
    assert.match(report.claims.notSupported.join(' '), /cultural acceptability/i);
  });

  test('performance evidence is descriptive and has no pass threshold', () => {
    const report = runPerformanceStudy(core.analyse, { sizes: [2, 5], warmups: 1, runs: 3 });
    assert.deepEqual(report.rows.map((r) => r.controls), [2, 5]);
    assert.ok(report.rows.every((r) => r.medianMs >= 0 && r.p95Ms >= r.medianMs));
    assert.match(report.interpretation, /not a CI pass\/fail threshold/i);
  });
});

describe('the evidence path cannot silently degrade', () => {
  test('a mutation case with no recorded browser verdict throws', async () => {
    // The defect this guards: browserCheck was a Node reimplementation of constraint
    // validation while the protocol described the study as browser-confirmed. If a case is
    // added without re-running the browser, the study must stop rather than quietly
    // substituting a reimplementation - which has been wrong six times in this project.
    const { readFileSync } = await import('node:fs');
    const verdicts = JSON.parse(
      readFileSync(new URL('../browser-verdicts.json', import.meta.url), 'utf8')
    );
    const { MUTATION_CASES } = await import('../cases.mjs');
    for (const c of MUTATION_CASES) {
      assert.ok(
        verdicts.results[c.id],
        `mutation case ${c.id} has no recorded browser verdict; re-run solo/browser-verify.html`
      );
    }
    assert.equal(verdicts.cases, MUTATION_CASES.length, 'every case is recorded, and no extras');
    assert.match(verdicts.engine, /Chrome\/\d+/, 'the engine that produced the verdicts is named');
    assert.equal(verdicts.expectationsHeld, verdicts.cases, 'every seeded fault behaves as intended');
  });
});
