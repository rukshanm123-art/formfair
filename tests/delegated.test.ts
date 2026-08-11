import { describe, expect, it } from 'vitest';
import { analyse, analyseWith } from '../src/index.js';
import { axeProvider, DELEGATED_RULES } from '../src/delegated/axe.js';
import { merge, withoutDelegation, totalReportedFindings } from '../src/delegated/merge.js';
import { EMPTY_DELEGATED } from '../src/delegated/types.js';
import { toTextWithDelegated } from '../src/report/text.js';
import { toJsonWithDelegated } from '../src/report/json.js';
import { summarise } from '../src/report/summary.js';

/** A name control with a validation defect and no associated label. */
const UNLABELLED = '<form><input name="firstName" pattern="[A-Za-z]{2,40}"></form>';
const LABELLED = '<form><label for="fn">First name</label><input id="fn" name="firstName" pattern="[A-Za-z]{2,40}"></form>';

describe('merge', () => {
  it('keeps own and delegated findings in separate fields', () => {
    const own = analyse(UNLABELLED);
    const merged = merge(own, {
      engine: 'axe-core',
      engineVersion: '4.12.1',
      findings: [
        {
          origin: 'delegated',
          engine: 'axe-core',
          engineVersion: '4.12.1',
          ruleId: 'label',
          severity: 'critical',
          message: 'Form elements must have labels',
          evidence: '<input name="firstName">',
          remediation: 'Add a label',
          helpUrl: 'https://example.invalid',
          target: 'input',
        },
      ],
    });
    expect(merged.findings).toEqual(own.findings);
    expect(merged.delegated.findings).toHaveLength(1);
  });

  it('leaves accuracy figures untouched by delegated findings', () => {
    const own = analyse(UNLABELLED);
    const merged = merge(own, {
      engine: 'axe-core',
      engineVersion: '4.12.1',
      findings: [
        {
          origin: 'delegated', engine: 'axe-core', engineVersion: '4.12.1', ruleId: 'label',
          severity: 'critical', message: 'x', evidence: '', remediation: '', helpUrl: '', target: '',
        },
      ],
    });
    expect(summarise(merged).totalFindings).toBe(own.findings.length);
    expect(totalReportedFindings(merged)).toBe(own.findings.length + 1);
  });

  it('reports no delegation when no provider is given', async () => {
    const r = await analyseWith(UNLABELLED);
    expect(r.delegated).toEqual(EMPTY_DELEGATED);
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it('withoutDelegation matches a bare analysis', () => {
    const bare = withoutDelegation(analyse(UNLABELLED));
    expect(bare.delegated.findings).toHaveLength(0);
  });
});

describe('axe-core delegation', () => {
  it('requests only the rules bearing on name controls', () => {
    expect(DELEGATED_RULES).toContain('label');
    expect(DELEGATED_RULES).toContain('autocomplete-valid');
    // FF-10 has no axe equivalent and stays a FormFair rule.
    expect(DELEGATED_RULES).not.toContain('pattern');
  });

  it('detects a missing label that FormFair does not check for itself', async () => {
    const r = await analyseWith(UNLABELLED, axeProvider());
    expect(r.delegated.engine).toBe('axe-core');
    expect(r.delegated.findings.map((f) => f.ruleId)).toContain('label');
    // FormFair's own rules still fire on the same control.
    expect(r.findings.map((f) => f.rule)).toContain('FF-01');
  }, 30_000);

  it('reports no delegated finding when the control is properly labelled', async () => {
    const r = await analyseWith(LABELLED, axeProvider());
    expect(r.delegated.findings.map((f) => f.ruleId)).not.toContain('label');
  }, 30_000);

  it('records the engine version it actually ran', async () => {
    const r = await analyseWith(UNLABELLED, axeProvider());
    expect(r.delegated.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
  }, 30_000);
});

describe('delegated findings in reports', () => {
  it('labels them as excluded from accuracy figures in text', async () => {
    const out = toTextWithDelegated(await analyseWith(UNLABELLED, axeProvider()));
    expect(out).toContain('Delegated accessibility findings');
    expect(out).toContain('excluded from its accuracy figures');
  }, 30_000);

  it('marks them scored: false in JSON', async () => {
    const report = toJsonWithDelegated(await analyseWith(UNLABELLED, axeProvider()));
    expect(report.delegated.scored).toBe(false);
    expect(report.summary.totalFindings).toBe(report.findings.length);
  }, 30_000);

  it('omits the section entirely when there is nothing delegated', async () => {
    const out = toTextWithDelegated(await analyseWith(UNLABELLED));
    expect(out).not.toContain('Delegated accessibility findings');
  });
});
