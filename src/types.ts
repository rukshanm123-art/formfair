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
}

/**
 * A rule returns `declined` when the control's constraints fall outside the
 * decidable subset. Silence and decline are different outcomes: decline is
 * recorded so decision coverage can be reported alongside accuracy.
 */
export type RuleOutcome =
  | { kind: 'finding'; finding: Finding }
  | { kind: 'clean' }
  | { kind: 'declined'; reason: string };

export interface NameControl {
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
  readonly declined: readonly { rule: RuleId; reason: string }[];
  readonly catalogueVersion: string;
}
