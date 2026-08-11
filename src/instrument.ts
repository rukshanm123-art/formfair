import { DEPENDENCY_VERSIONS, PACKAGE_VERSION } from './instrument.generated.js';

/**
 * Identifies what produced a report.
 *
 * A catalogue version alone does not reproduce an evaluation. The HTML parser decides
 * which controls are seen at all, the accessibility engine decides the delegated
 * findings, and the package version covers the analysis code between them. All three
 * are recorded alongside the catalogue so a result can be tied to the instrument that
 * produced it.
 *
 * The exact commit and the resolved dependency tree are not knowable from inside a
 * running package; they are fixed by the evaluation tag. See docs/evaluation/README.md.
 */
export interface Instrument {
  readonly catalogueVersion: string;
  readonly packageVersion: string;
  readonly dependencies: Readonly<Record<string, string>>;
  /** The Node version, where the report was produced in Node. Null in a browser. */
  readonly runtime: string | null;
}

function nodeVersion(): string | null {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return proc?.versions?.node ? `node ${proc.versions.node}` : null;
}

export function instrument(catalogueVersion: string): Instrument {
  return {
    catalogueVersion,
    packageVersion: PACKAGE_VERSION,
    dependencies: DEPENDENCY_VERSIONS,
    runtime: nodeVersion(),
  };
}
