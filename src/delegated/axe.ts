import type { AccessibilityProvider, DelegatedFinding, DelegatedResult } from './types.js';
import type { Severity } from '../types.js';

/**
 * Adapter for axe-core. Only the rules bearing on personal-name controls are
 * requested: the engine has a large catalogue and running all of it would bury
 * the findings this tool is about under unrelated page-level results.
 *
 * These are the checks FF-06 to FF-09 delegate to. FF-10 has no axe-core
 * equivalent and remains a FormFair rule.
 */
export const DELEGATED_RULES = [
  'label',
  'form-field-multiple-labels',
  'autocomplete-valid',
  'aria-input-field-name',
  'select-name',
] as const;

const SEVERITY_BY_IMPACT: Readonly<Record<string, Severity>> = {
  critical: 'critical',
  serious: 'critical',
  moderate: 'high',
  minor: 'medium',
};

interface AxeNode {
  html?: string;
  target?: unknown[];
  failureSummary?: string;
}

interface AxeViolation {
  id: string;
  impact?: string | null;
  help?: string;
  description?: string;
  helpUrl?: string;
  nodes?: AxeNode[];
}

interface AxeResults {
  violations?: AxeViolation[];
}

function toFindings(results: AxeResults, version: string): DelegatedFinding[] {
  const out: DelegatedFinding[] = [];
  for (const v of results.violations ?? []) {
    for (const node of v.nodes ?? []) {
      out.push({
        origin: 'delegated',
        engine: 'axe-core',
        engineVersion: version,
        ruleId: v.id,
        severity: SEVERITY_BY_IMPACT[v.impact ?? 'moderate'] ?? 'high',
        message: v.help ?? v.description ?? v.id,
        evidence: node.html ?? '',
        remediation: node.failureSummary ?? v.description ?? '',
        helpUrl: v.helpUrl ?? '',
        target: Array.isArray(node.target) ? node.target.map(String).join(' ') : '',
      });
    }
  }
  return out;
}

/** Runs axe-core against an already-constructed Document, as a browser would. */
export async function runAxeOnDocument(
  document: Document,
  rules: readonly string[] = DELEGATED_RULES
): Promise<DelegatedResult> {
  const axe = (await import('axe-core')).default;
  const results = (await axe.run(document.documentElement, {
    runOnly: { type: 'rule', values: [...rules] },
    resultTypes: ['violations'],
  })) as unknown as AxeResults;

  return {
    engine: 'axe-core',
    engineVersion: axe.version,
    findings: toFindings(results, axe.version),
  };
}

/**
 * Node-side provider. jsdom is a development dependency, so it is imported
 * lazily: a browser build that supplies its own Document never loads it.
 */
export function axeProvider(rules: readonly string[] = DELEGATED_RULES): AccessibilityProvider {
  return {
    engine: 'axe-core',
    engineVersion: 'resolved at run time',
    async run(html: string): Promise<DelegatedResult> {
      const { JSDOM } = await import('jsdom');
      const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
      const g = globalThis as Record<string, unknown>;
      const priorWindow = g['window'];
      const priorDocument = g['document'];
      g['window'] = dom.window;
      g['document'] = dom.window.document;
      try {
        return await runAxeOnDocument(dom.window.document as unknown as Document, rules);
      } finally {
        g['window'] = priorWindow;
        g['document'] = priorDocument;
        dom.window.close();
      }
    },
  };
}
