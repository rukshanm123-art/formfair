import { describe, expect, it } from 'vitest';
import { analyse } from '../src/index.js';
import { summarise, sortFindings } from '../src/report/summary.js';
import { toJson, toJsonString } from '../src/report/json.js';
import { toText } from '../src/report/text.js';
import { toHtml, escapeHtml } from '../src/report/html.js';

const OFFENDING = '<form><input name="firstName" pattern="[A-Za-z]{2,40}"></form>';
// Letters only: accepts precomposed names but rejects their decomposed forms, since a
// combining mark is \p{M} rather than \p{L}. FF-03 is expected to fire.
const LETTERS_ONLY = '<form><input name="firstName" pattern="[\\p{L}\\u0027\\u2019 -]+"></form>';
// Letters and combining marks: accepts both normalisation forms.
const CLEAN = '<form><input name="firstName" pattern="[\\p{L}\\p{M}\\u0027\\u2019 -]+"></form>';
const NO_CONTROLS = '<form><input type="email" name="email"></form>';
const DECLINED = '<form><input name="firstName" pattern="[A-Za-z]+|[0-9]+"></form>';

describe('summary', () => {
  it('counts findings by severity', () => {
    const s = summarise(analyse(OFFENDING));
    expect(s.controls).toBe(1);
    expect(s.totalFindings).toBeGreaterThan(0);
    expect(s.bySeverity.critical + s.bySeverity.high + s.bySeverity.medium).toBe(s.totalFindings);
  });

  it('counts a control once however many rules fire on it', () => {
    const s = summarise(analyse(OFFENDING));
    expect(s.totalFindings).toBeGreaterThan(1);
    expect(s.affectedControls).toBe(1);
  });

  it('reports coverage for every rule', () => {
    const s = summarise(analyse(OFFENDING));
    expect(s.byRule).toHaveLength(5);
    for (const r of s.byRule) expect(r.decisionCoverage).toBeGreaterThanOrEqual(0);
  });

  it('orders findings by severity, most serious first', () => {
    const sorted = sortFindings(analyse(OFFENDING).findings);
    const ranks = sorted.map((f) => ['critical', 'high', 'medium'].indexOf(f.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('JSON report', () => {
  it('is valid JSON carrying a schema identifier', () => {
    const parsed = JSON.parse(toJsonString(analyse(OFFENDING)));
    expect(parsed.schema).toBe('formfair/report@1');
    expect(parsed.catalogueVersion).toBeTruthy();
  });

  it('gives every finding evidence and a remediation', () => {
    for (const f of toJson(analyse(OFFENDING)).findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.remediation.length).toBeGreaterThan(0);
      expect(f.message.length).toBeGreaterThan(0);
    }
  });

  it('carries declines alongside findings rather than dropping them', () => {
    const report = toJson(analyse(DECLINED));
    expect(report.findings).toHaveLength(0);
    expect(report.declined.length).toBeGreaterThan(0);
    for (const d of report.declined) expect(d.reason).toBeTruthy();
  });
});

describe('text report', () => {
  it('labels each finding with evidence and remediation', () => {
    const out = toText(analyse(OFFENDING));
    expect(out).toContain('Evidence:');
    expect(out).toContain('Remediation:');
    expect(out).toContain('Decision coverage');
  });

  it('says so plainly when no name control is found', () => {
    expect(toText(analyse(NO_CONTROLS))).toContain('No personal-name controls identified');
  });

  it('distinguishes declined from clean', () => {
    const out = toText(analyse(DECLINED));
    expect(out).toContain('not the same as clean');
  });

  it('reports a clean control without inventing findings', () => {
    const out = toText(analyse(CLEAN));
    expect(out).toContain('0 findings');
  });

  it('still reports normalisation asymmetry on a letters-only Unicode class', () => {
    // The pattern a careful developer would reach for is not sufficient on its own:
    // \p{L} admits the precomposed letter but not the combining mark of the decomposed form.
    const result = analyse(LETTERS_ONLY);
    expect(result.findings.map((f) => f.rule)).toEqual(['FF-03']);
    expect(toText(result)).toContain('identical-looking encodings');
  });
});

describe('HTML report', () => {
  it('is a self-contained document with no external references', () => {
    const html = toHtml(analyse(OFFENDING));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<script|src=|href=/);
  });

  it('escapes markup so a snippet cannot break out of the page', () => {
    const html = toHtml(analyse(OFFENDING));
    expect(html).not.toMatch(/<pre><input/);
    expect(html).toContain('&lt;input');
  });

  it('escapes the characters that matter', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('renders the empty case without a findings table', () => {
    expect(toHtml(analyse(NO_CONTROLS))).toContain('No personal-name controls identified');
  });
});
