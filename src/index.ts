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

export { findNameControls } from './parse/controls.js';
export { analysePattern } from './parse/pattern.js';
export { utf16Bounds } from './parse/length.js';
export { RULES, CATALOGUE_VERSION } from './rules/index.js';
export { toJson, toJsonString } from './report/json.js';
export { toText } from './report/text.js';
export { toHtml } from './report/html.js';
export { summarise, sortFindings, decisionCoverage } from './report/summary.js';
export type { Summary, RuleSummary } from './report/summary.js';
export type { JsonReport } from './report/json.js';
export type * from './types.js';
