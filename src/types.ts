export type Severity = 'critical' | 'high' | 'medium';

export type RuleId = 'FF-01' | 'FF-02' | 'FF-03' | 'FF-04' | 'FF-05';

export interface SourceRef {
  line: number;
  column: number;
  snippet: string;
}

export interface Finding {
  readonly rule: RuleId;
  readonly severity: Severity;
  readonly message: string;
  readonly evidence: string;
  readonly remediation: string;
  readonly source: SourceRef;
  /** The published guidance the rule rests on, carried so a reader can check it. */
  readonly basis: string;
}

/**
 * What a rule itself returns. The basis belongs to the catalogue entry rather than to
 * the individual finding, so it is attached once by the caller rather than restated
 * at every call site, where the two could drift apart.
 */
export type RuleFinding = Omit<Finding, 'basis'>;

/** A control a rule could not decide, recorded with the location it was declined at. */
export interface Decline {
  readonly rule: RuleId;
  readonly reason: string;
  readonly source: SourceRef;
}

/**
 * A rule returns `declined` when the control's constraints fall outside the
 * decidable subset. Silence and decline are different outcomes: decline is
 * recorded so decision coverage can be reported alongside accuracy.
 */
export type RuleOutcome =
  | { kind: 'finding'; finding: RuleFinding }
  | { kind: 'clean' }
  | { kind: 'declined'; reason: string };

/** Why a control was taken to be a personal-name field, and how strongly. */
export interface Detection {
  readonly score: number;
  readonly signals: readonly string[];
}

export interface NameControl {
  readonly detection: Detection;
  readonly pattern: string | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly required: boolean;
  readonly source: SourceRef;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface Rule {
  readonly id: RuleId;
  readonly severity: Severity;
  readonly basis: string;
  evaluate(control: NameControl): RuleOutcome;
}

export interface AnalysisResult {
  readonly controls: number;
  readonly findings: readonly Finding[];
  readonly declined: readonly Decline[];
  readonly catalogueVersion: string;
}
