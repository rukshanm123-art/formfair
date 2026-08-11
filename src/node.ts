/**
 * Node entry point, published as `formfair/node`.
 *
 * The core package runs anywhere a `Document` is available and depends on nothing but
 * parse5 and axe-core. This entry adds the jsdom-backed accessibility provider, which
 * needs a DOM implementation the core package does not carry. jsdom is an optional peer
 * dependency: install it alongside FormFair to use this entry, and note that jsdom
 * requires a newer Node than the core package does — Node ^22.22.2, ^24.15.0 or >=26,
 * against the core package's Node 20.
 */

export { axeProvider, createAnalysisWindow } from './delegated/axe.js';
export { runAxeOnDocument, DELEGATED_RULES } from './delegated/axe.js';
export type { AccessibilityProvider, DelegatedFinding, DelegatedResult } from './delegated/types.js';
