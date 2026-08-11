import { describe, expect, it } from 'vitest';
import { analyse, decisionCoverage } from '../src/index.js';
import { toText } from '../src/report/text.js';

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
