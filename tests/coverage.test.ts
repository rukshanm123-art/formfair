import { describe, expect, it } from 'vitest';
import { analyse, decisionCoverage } from '../src/index.js';
import { toText } from '../src/report/text.js';
import { toJson } from '../src/report/json.js';
import { toHtml } from '../src/report/html.js';
import { summarise } from '../src/report/summary.js';

function form(...patterns: string[]): string {
  const inputs = patterns
    .map((p, i) => `<input name="name${i}" ${p === '' ? '' : `pattern="${p}"`}>`)
    .join('');
  return `<form>${inputs}</form>`;
}

describe('decision coverage', () => {
  it('is complete when every control is decidable', () => {
    const result = analyse(form('[A-Za-z]+', '[A-Za-z]{2,40}'));
    expect(decisionCoverage(result)['FF-01']).toBe(1);
  });

  it('falls when a control is declined', () => {
    const result = analyse(form('[A-Za-z]+', '[A-Za-z]+|[0-9]+'));
    expect(result.controls).toBe(2);
    expect(decisionCoverage(result)['FF-01']).toBe(0.5);
  });

  it('reports per rule, since rules decline independently', () => {
    // A property escape is decidable for the pattern rules but blocks length bounds.
    const result = analyse(form('[\\p{L}]{2,40}'));
    const coverage = decisionCoverage(result);
    expect(coverage['FF-01']).toBe(1);
    expect(coverage['FF-05']).toBe(0);
  });

  it('is null, not complete, when a document contains no name controls', () => {
    // A rule that was never exercised has not decided everything put to it.
    const result = analyse('<form><input type="email" name="email"></form>');
    expect(result.controls).toBe(0);
    expect(decisionCoverage(result)['FF-01']).toBeNull();
  });

  it('renders an absent coverage figure as n/a rather than a percentage', () => {
    expect(toText(analyse('<form><input type="email" name="email"></form>'))).not.toContain('100%');
  });

  it('records a reason and a location with every decline', () => {
    const result = analyse(form('(?:ab)+'));
    expect(result.declined.length).toBeGreaterThan(0);
    for (const d of result.declined) {
      expect(d.reason).not.toHaveLength(0);
      expect(d.source.line).toBeGreaterThan(0);
    }
  });

  it('carries the published basis on every finding', () => {
    for (const f of analyse(form('[A-Za-z]{2,40}')).findings) {
      expect(f.basis).not.toHaveLength(0);
    }
  });
});

describe('advisories', () => {
  it('reports a normalisation boundary for any finite maxlength', () => {
    const r = analyse('<form><input name="firstName" maxlength="40"></form>');
    expect(r.advisories.map((a) => a.code)).toEqual(['ADV-NORM-BOUNDARY']);
  });

  it('does not raise one for maxlength zero, which is symmetric', () => {
    // It rejects every non-empty name in both encodings, so no pair is separated.
    expect(analyse('<form><input name="firstName" maxlength="0"></form>').advisories).toHaveLength(0);
  });

  it('does not raise one where no maximum is declared', () => {
    expect(analyse('<form><input name="firstName" pattern="[A-Za-z]+"></form>').advisories).toHaveLength(0);
  });

  it('is kept out of the findings, so it cannot enter precision or recall', () => {
    const r = analyse('<form><input name="firstName" maxlength="40"></form>');
    expect(r.advisories).toHaveLength(1);
    expect(r.findings).toHaveLength(0);
    expect(summarise(r).totalFindings).toBe(0);
  });

  it('is marked unscored in the JSON report and labelled in text', () => {
    const r = analyse('<form><input name="firstName" maxlength="40"></form>');
    expect(toJson(r).advisories[0]?.scored).toBe(false);
    expect(toText(r)).toContain('not scored');
  });

  it('appears in the HTML report, labelled and escaped', () => {
    const html = toHtml(analyse('<form><input name="firstName" maxlength="40"></form>'));
    expect(html).toContain('ADV-NORM-BOUNDARY');
    expect(html).toContain('Reported, not scored');
    expect(html).toContain('excluded from the accuracy figures');
    expect(html).not.toMatch(/<script|src=|href=/);
  });

  it('is absent from the HTML report when nothing raised one', () => {
    const html = toHtml(analyse('<form><input name="firstName" pattern="[A-Za-z]+"></form>'));
    expect(html).not.toContain('ADV-NORM-BOUNDARY');
    expect(html).not.toContain('<h2>Advisories</h2>');
  });

  it('does not fire FF-03 on a maximum no fixture pair straddles', () => {
    // The frozen FF-03 requires a witnessed asymmetry, not a constructible one.
    const r = analyse('<form><input name="firstName" maxlength="40"></form>');
    expect(r.findings.map((f) => f.rule)).not.toContain('FF-03');
  });

  it('still fires FF-03 where a fixture pair is witnessed to straddle the maximum', () => {
    const r = analyse('<form><input name="firstName" maxlength="7"></form>');
    expect(r.findings.map((f) => f.rule)).toEqual(['FF-03']);
  });
});

describe('the report identifies the instrument that produced it', () => {
  it('records the catalogue, the package and the dependencies that bear on results', () => {
    const { instrument } = toJson(analyse('<form><input name="firstName"></form>'));
    expect(instrument.catalogueVersion).toBe('1.0.0');
    expect(instrument.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(instrument.dependencies['parse5']).toMatch(/^\d+\.\d+\.\d+/);
    expect(instrument.dependencies['axe-core']).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('records the runtime, so a Node result is distinguishable from a browser one', () => {
    const { instrument } = toJson(analyse('<form><input name="firstName"></form>'));
    expect(instrument.runtime).toMatch(/^node \d+\./);
  });

  it('records the axe-core version the snapshot documents', () => {
    // Paired with scripts/verify-snapshot-versions.mjs: the report must name the same
    // engine release the captured catalogue evidences.
    const { instrument } = toJson(analyse('<form><input name="firstName"></form>'));
    expect(instrument.dependencies['axe-core']).toBe('4.12.1');
  });
});
