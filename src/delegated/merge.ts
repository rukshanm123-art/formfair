import type { AnalysisResult } from '../types.js';
import type { DelegatedResult } from './types.js';
import { EMPTY_DELEGATED } from './types.js';

/**
 * An analysis carrying both FormFair's own findings and an external engine's.
 * The two are kept in separate fields rather than concatenated: a developer
 * wants one report, but the evaluation must be able to score FormFair's rules
 * without an external engine's results leaking into the figures.
 */
export interface MergedResult extends AnalysisResult {
  readonly delegated: DelegatedResult;
}

export function merge(own: AnalysisResult, delegated: DelegatedResult): MergedResult {
  return { ...own, delegated };
}

export function withoutDelegation(own: AnalysisResult): MergedResult {
  return merge(own, EMPTY_DELEGATED);
}

/** Total across both sources, for display only. Never used in accuracy figures. */
export function totalReportedFindings(result: MergedResult): number {
  return result.findings.length + result.delegated.findings.length;
}
