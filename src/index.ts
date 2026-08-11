import { findNameControls } from './parse/controls.js';
import { CATALOGUE_VERSION, RULES } from './rules/index.js';
import type { AnalysisResult, Decline, Finding } from './types.js';
import type { AccessibilityProvider } from './delegated/types.js';
import { merge, withoutDelegation, type MergedResult } from './delegated/merge.js';

export function analyse(html: string): AnalysisResult {
  const controls = findNameControls(html);
  const findings: Finding[] = [];
  const declined: Decline[] = [];

  for (const control of controls) {
    for (const rule of RULES) {
      const outcome = rule.evaluate(control);
      // The rule reports what it found; the catalogue entry supplies the basis, and
      // the control supplies the location, including for a decline.
      if (outcome.kind === 'finding') findings.push({ ...outcome.finding, basis: rule.basis });
      else if (outcome.kind === 'declined')
        declined.push({ rule: rule.id, reason: outcome.reason, source: control.source });
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
 * Runs the FormFair rules and, where a provider is supplied, the delegated
 * accessibility checks. Delegated findings are reported but never scored: the
 * accuracy evaluation covers the five cultural rules only.
 */
export async function analyseWith(
  html: string,
  provider?: AccessibilityProvider
): Promise<MergedResult> {
  const own = analyse(html);
  if (!provider) return withoutDelegation(own);
  return merge(own, await provider.run(html));
}

export { findNameControls } from './parse/controls.js';
export { analysePattern } from './parse/pattern.js';
export { utf16Bounds } from './parse/length.js';
export { RULES, CATALOGUE_VERSION } from './rules/index.js';
export { toJson, toJsonString, toJsonWithDelegated } from './report/json.js';
export { toText, toTextWithDelegated } from './report/text.js';
export { toHtml } from './report/html.js';
export { summarise, sortFindings, decisionCoverage } from './report/summary.js';
export type { Summary, RuleSummary } from './report/summary.js';
export type { JsonReport } from './report/json.js';
export { axeProvider, runAxeOnDocument, DELEGATED_RULES } from './delegated/axe.js';
export { merge, withoutDelegation, totalReportedFindings } from './delegated/merge.js';
export type { MergedResult } from './delegated/merge.js';
export type { AccessibilityProvider, DelegatedFinding, DelegatedResult } from './delegated/types.js';
export type * from './types.js';
