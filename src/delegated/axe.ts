import type { AccessibilityProvider, DelegatedFinding, DelegatedResult } from './types.js';
import type { Severity } from '../types.js';

/**
 * Adapter for axe-core. Only the rules bearing on personal-name controls are
 * requested: the engine has a large catalogue and running all of it would bury
 * the findings this tool is about under unrelated page-level results.
 *
 * These cover whether a name control is labelled and named. They are reported but
 * never scored: the accuracy figures belong to FF-01 to FF-05, which are about what a
 * control accepts rather than how it is announced. Nothing here checks error-message
 * association, and no FormFair rule delegates to axe-core.
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

type JsdomConstructor = new (html: string, options: { runScripts: 'outside-only' }) => JsdomInstance;

interface JsdomInstance {
  window: Window & typeof globalThis & { eval(code: string): unknown; close(): void };
}

/**
 * Builds the window a document is analysed in.
 *
 * `runScripts: 'outside-only'` supplies the `eval` needed to load the accessibility
 * engine while leaving every script carried by the analysed markup unexecuted. This
 * tool reads other people's pages, and it must not run them.
 */
function buildWindow(JSDOM: JsdomConstructor, html: string): JsdomInstance {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: 'outside-only',
  });
}

/**
 * Internal. Exported so the no-script-execution guarantee can be asserted against the
 * window the provider actually builds; it is not re-exported from `formfair/node` and
 * is not public API.
 *
 * @internal
 */
export async function createAnalysisWindow(html: string): Promise<JsdomInstance> {
  const { JSDOM } = await import('jsdom');
  return buildWindow(JSDOM as unknown as JsdomConstructor, html);
}

interface AxeGlobal {
  version: string;
  run(context: unknown, options: unknown): Promise<AxeResults>;
}

/**
 * Node-side provider, reached through the `formfair/node` entry point. jsdom is an
 * optional peer dependency and is imported lazily, so the core package neither carries
 * it nor requires the newer Node it needs.
 *
 * axe-core is evaluated inside the jsdom window rather than imported into this one.
 * The bundle binds `window` when it loads, so importing it here and then assigning
 * globalThis.window gave it the wrong realm and axe.run rejected its own arguments.
 * Loading it into the window it will inspect avoids the question.
 */
export function axeProvider(rules: readonly string[] = DELEGATED_RULES): AccessibilityProvider {
  return {
    engine: 'axe-core',
    engineVersion: 'resolved at run time',
    async run(html: string): Promise<DelegatedResult> {
      const [{ JSDOM }, { createRequire }, { readFileSync }] = await Promise.all([
        import('jsdom'),
        import('node:module'),
        import('node:fs'),
      ]);
      const source = readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8');

      const dom = buildWindow(JSDOM as unknown as JsdomConstructor, html);
      try {
        dom.window.eval(source);
        const axe = (dom.window as unknown as { axe: AxeGlobal }).axe;
        const results = await axe.run(dom.window.document.documentElement, {
          runOnly: { type: 'rule', values: [...rules] },
          resultTypes: ['violations'],
        });
        return {
          engine: 'axe-core',
          engineVersion: axe.version,
          findings: toFindings(results, axe.version),
        };
      } finally {
        dom.window.close();
      }
    },
  };
}
