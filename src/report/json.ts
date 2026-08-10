import type { AnalysisResult } from '../types.js';
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
    readonly line: number;
    readonly column: number;
    readonly snippet: string;
  }[];
  readonly declined: readonly { readonly rule: string; readonly reason: string }[];
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
      line: f.source.line,
      column: f.source.column,
      snippet: f.source.snippet,
    })),
    declined: result.declined.map((d) => ({ rule: d.rule, reason: d.reason })),
  };
}

export function toJsonString(result: AnalysisResult, indent = 2): string {
  return JSON.stringify(toJson(result), null, indent);
}
