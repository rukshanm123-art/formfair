import type { AnalysisResult, Finding, RuleId, Severity } from '../types.js';
import { RULES } from '../rules/index.js';

export interface RuleSummary {
  readonly rule: RuleId;
  readonly findings: number;
  readonly declined: number;
  readonly decisionCoverage: number;
}

export interface Summary {
  readonly controls: number;
  readonly totalFindings: number;
  /** Controls carrying at least one finding, so a control with three findings counts once. */
  readonly affectedControls: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  readonly byRule: readonly RuleSummary[];
  readonly catalogueVersion: string;
}

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium'];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.source.line - b.source.line ||
      a.rule.localeCompare(b.rule)
  );
}

export function summarise(result: AnalysisResult): Summary {
  const coverage = decisionCoverage(result);

  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0 };
  for (const f of result.findings) bySeverity[f.severity] += 1;

  const affected = new Set(result.findings.map((f) => `${f.source.line}:${f.source.column}`));

  const byRule = RULES.map((rule) => ({
    rule: rule.id,
    findings: result.findings.filter((f) => f.rule === rule.id).length,
    declined: result.declined.filter((d) => d.rule === rule.id).length,
    decisionCoverage: coverage[rule.id],
  }));

  return {
    controls: result.controls,
    totalFindings: result.findings.length,
    affectedControls: affected.size,
    bySeverity,
    byRule,
    catalogueVersion: result.catalogueVersion,
  };
}

/**
 * Decision coverage per rule: the proportion of controls on which a rule reached a
 * decision rather than declining. Reported alongside accuracy so that silence is
 * never read as a clean result.
 */
export function decisionCoverage(result: AnalysisResult): Record<RuleId, number> {
  const coverage = {} as Record<RuleId, number>;
  for (const rule of RULES) {
    const declines = result.declined.filter((d) => d.rule === rule.id).length;
    coverage[rule.id] = result.controls === 0 ? 1 : (result.controls - declines) / result.controls;
  }
  return coverage;
}
