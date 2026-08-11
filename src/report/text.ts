import type { AnalysisResult, Severity } from '../types.js';
import type { MergedResult } from '../delegated/merge.js';
import { sortFindings, summarise } from './summary.js';

const LABEL: Readonly<Record<Severity, string>> = {
  critical: 'CRITICAL',
  high: 'HIGH    ',
  medium: 'MEDIUM  ',
};

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${Math.round(n * 100)}%`;
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
    out.push(`  Basis:       ${f.basis}`);
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
    const reasons = new Map<string, number[]>();
    for (const d of result.declined) {
      const lines = reasons.get(d.reason) ?? [];
      lines.push(d.source.line);
      reasons.set(d.reason, lines);
    }
    for (const [reason, lines] of reasons) {
      const where = [...new Set(lines)].sort((a, b) => a - b).join(', ');
      out.push(`  ${lines.length} x ${reason} (line${lines.length === 1 ? '' : 's'} ${where})`);
    }
  }

  return out.join('\n');
}

/**
 * Appends the delegated engine's findings under their own heading. They are kept
 * visually separate and labelled with the engine and version, so a reader is never
 * left thinking FormFair detected something another tool did.
 */
export function toTextWithDelegated(result: MergedResult): string {
  const out = [toText(result)];
  const d = result.delegated;
  if (d.findings.length === 0) return out.join('\n');

  out.push('');
  out.push(`Delegated accessibility findings (${d.engine} ${d.engineVersion})`);
  out.push('Reported for completeness. Not part of the FormFair rule catalogue and');
  out.push('excluded from its accuracy figures.');
  out.push('');
  for (const f of d.findings) {
    out.push(`  ${f.ruleId}  ${f.target}`);
    out.push(`    ${f.message}`);
    if (f.evidence) out.push(`    Evidence: ${f.evidence}`);
  }
  return out.join('\n');
}
