import { findNameControls } from './parse/controls.js';
import { CATALOGUE_VERSION, RULES } from './rules/index.js';
import type { AnalysisResult, Finding, RuleId } from './types.js';

export function analyse(html: string): AnalysisResult {
  const controls = findNameControls(html);
  const findings: Finding[] = [];
  const declined: { rule: RuleId; reason: string }[] = [];

  for (const control of controls) {
    for (const rule of RULES) {
      const outcome = rule.evaluate(control);
      if (outcome.kind === 'finding') findings.push(outcome.finding);
      else if (outcome.kind === 'declined') declined.push({ rule: rule.id, reason: outcome.reason });
    }
  }

  return {
    controls: controls.length,
    findings,
    declined,
    catalogueVersion: CATALOGUE_VERSION,
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

export { findNameControls } from './parse/controls.js';
export { analysePattern } from './parse/pattern.js';
export { utf16Bounds } from './parse/length.js';
export { RULES, CATALOGUE_VERSION } from './rules/index.js';
export type * from './types.js';
