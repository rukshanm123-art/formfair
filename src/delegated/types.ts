import type { Severity } from '../types.js';

/**
 * Accessibility checks are delegated to an external engine rather than
 * reimplemented. Delegated findings are reported alongside FormFair's own so a
 * developer sees one list, but they are tagged at the type level and excluded
 * from every accuracy figure: they are not this project's contribution and
 * scoring them would inflate results with another engine's work.
 */
export interface DelegatedFinding {
  readonly origin: 'delegated';
  readonly engine: string;
  readonly engineVersion: string;
  /** The engine's own rule identifier, e.g. an axe-core rule id. */
  readonly ruleId: string;
  readonly severity: Severity;
  readonly message: string;
  readonly evidence: string;
  readonly remediation: string;
  readonly helpUrl: string;
  readonly target: string;
}

export interface DelegatedResult {
  readonly engine: string;
  readonly engineVersion: string;
  readonly findings: readonly DelegatedFinding[];
}

/**
 * Supplying the engine as a provider keeps the analyser independent of any DOM
 * implementation: the browser build can pass a live Document, Node can pass one
 * from jsdom, and the core rules stay testable without either.
 */
export interface AccessibilityProvider {
  readonly engine: string;
  readonly engineVersion: string;
  run(html: string): Promise<DelegatedResult>;
}

export const EMPTY_DELEGATED: DelegatedResult = {
  engine: 'none',
  engineVersion: '0',
  findings: [],
};
