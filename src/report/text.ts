import type { AnalysisResult, Severity } from '../types.js';
import { sortFindings, summarise } from './summary.js';

const LABEL: Readonly<Record<Severity, string>> = {
  critical: 'CRITICAL',
  high: 'HIGH    ',
  medium: 'MEDIUM  ',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Plain-text report. Every finding carries the evidence that triggered it and a
 * concrete remediation, which the static-analysis adoption literature identifies
 * as the difference between a warning developers act on and one they dismiss.
 */
export function toText(result: AnalysisResult): string {
  const s = summarise(result);
  const out: string[] = [];

  out.push('FormFair report');
  out.push(`Rule catalogue ${s.catalogueVersion}`);
  out.push('');

  if (s.controls === 0) {
    out.push('No personal-name controls identified in this markup.');
    return out.join('\n');
  }

  out.push(
    `${s.controls} name control${s.controls === 1 ? '' : 's'} analysed. ` +
      `${s.totalFindings} finding${s.totalFindings === 1 ? '' : 's'} across ` +
      `${s.affectedControls} control${s.affectedControls === 1 ? '' : 's'}.`
  );
  out.push(
    `Critical ${s.bySeverity.critical}   High ${s.bySeverity.high}   Medium ${s.bySeverity.medium}`
  );
  out.push('');

  for (const f of sortFindings(result.findings)) {
    out.push(`${LABEL[f.severity]}  ${f.rule}  line ${f.source.line}`);
    out.push(`  ${f.message}`);
    out.push(`  Evidence:    ${f.evidence}`);
    out.push(`  Remediation: ${f.remediation}`);
    if (f.source.snippet) out.push(`  Source:      ${f.source.snippet}`);
    out.push('');
  }

  out.push('Decision coverage');
  for (const r of s.byRule) {
    const note = r.declined > 0 ? `  (${r.declined} declined)` : '';
    out.push(`  ${r.rule}  ${pct(r.decisionCoverage).padStart(4)}${note}`);
  }

  if (result.declined.length > 0) {
    out.push('');
    out.push('Declined — not analysed, which is not the same as clean:');
    const reasons = new Map<string, number>();
    for (const d of result.declined) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
    for (const [reason, n] of reasons) out.push(`  ${n} x ${reason}`);
  }

  return out.join('\n');
}
