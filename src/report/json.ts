import type { AnalysisResult } from '../types.js';
import type { MergedResult } from '../delegated/merge.js';
import { sortFindings, summarise, type Summary } from './summary.js';

export interface JsonReport {
  readonly schema: 'formfair/report@1';
  readonly catalogueVersion: string;
  readonly summary: Summary;
  readonly findings: readonly {
    readonly rule: string;
    readonly severity: string;
    readonly message: string;
    readonly evidence: string;
    readonly remediation: string;
    readonly basis: string;
    readonly line: number;
    readonly column: number;
    readonly snippet: string;
  }[];
  readonly declined: readonly {
    readonly rule: string;
    readonly reason: string;
    readonly line: number;
    readonly column: number;
    readonly snippet: string;
  }[];
}

/**
 * Machine-readable output. Declines are carried alongside findings rather than
 * dropped, so a consumer can tell "no anti-pattern" from "not analysed".
 */
export function toJson(result: AnalysisResult): JsonReport {
  return {
    schema: 'formfair/report@1',
    catalogueVersion: result.catalogueVersion,
    summary: summarise(result),
    findings: sortFindings(result.findings).map((f) => ({
      rule: f.rule,
      severity: f.severity,
      message: f.message,
      evidence: f.evidence,
      remediation: f.remediation,
      basis: f.basis,
      line: f.source.line,
      column: f.source.column,
      snippet: f.source.snippet,
    })),
    declined: result.declined.map((d) => ({
      rule: d.rule,
      reason: d.reason,
      line: d.source.line,
      column: d.source.column,
      snippet: d.source.snippet,
    })),
  };
}

export function toJsonString(result: AnalysisResult, indent = 2): string {
  return JSON.stringify(toJson(result), null, indent);
}

export interface JsonReportWithDelegated extends JsonReport {
  readonly delegated: {
    readonly engine: string;
    readonly engineVersion: string;
    readonly scored: false;
    readonly findings: readonly {
      readonly ruleId: string;
      readonly severity: string;
      readonly message: string;
      readonly evidence: string;
      readonly helpUrl: string;
      readonly target: string;
    }[];
  };
}

/** `scored: false` states in the artefact itself that these do not enter accuracy figures. */
export function toJsonWithDelegated(result: MergedResult): JsonReportWithDelegated {
  return {
    ...toJson(result),
    delegated: {
      engine: result.delegated.engine,
      engineVersion: result.delegated.engineVersion,
      scored: false,
      findings: result.delegated.findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        message: f.message,
        evidence: f.evidence,
        helpUrl: f.helpUrl,
        target: f.target,
      })),
    },
  };
}
