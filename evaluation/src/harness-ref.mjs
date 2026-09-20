/**
 * Provenance for the ANALYSIS HARNESS - the code that turns labels into figures.
 *
 * The report already records the protocol and the frozen analyser. Neither identifies the
 * statistics: the same labels run through harness-v1.0.6 and through harness-v1.1.0 give
 * different intervals, and without this a finished report cannot say which produced it.
 * That is the difference between an amendment and an undisclosed change of method.
 *
 * Git is consulted where available, but the harness is identified even without it: the
 * analysis constants below are what actually determine the numbers, so they are recorded
 * whether or not a commit can be resolved.
 */

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_DENOMINATOR, STABILITY_THRESHOLD } from './stats.mjs';

/** The harness version this source IS. Bumped with the amendment, not resolved from git. */
export const HARNESS_VERSION = 'harness-v1.1.0';

const here = dirname(fileURLToPath(import.meta.url));

const git = (args) => {
  try {
    return execFileSync('git', ['-C', here, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * Identifies the harness that produced a report.
 *
 * `dirty` is the field that matters for an official run: a commit alone does not prove the
 * working tree matched it. A report generated from uncommitted edits says so.
 */
export function harnessRef() {
  const commit = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  const exactTag = git(['describe', '--tags', '--exact-match']);

  return {
    version: HARNESS_VERSION,
    commit,
    // null when git could not be consulted at all - distinct from a clean tree.
    dirty: status === null ? null : status.length > 0,
    tag: exactTag,
    taggedAtThisCommit: exactTag === HARNESS_VERSION,
    // The analysis decisions themselves, so the method is identifiable from the report
    // alone even if the repository is never available to the reader.
    intervalMethod: {
      controlLevelProportions: 'page-cluster bootstrap',
      formLevelProportions: 'Wilson score interval',
      resamples: 2000,
      seed: 'evaluation-v1.0.0',
      quantile: 'nearest rank',
      minimumDenominator: MIN_DENOMINATOR,
      minimumContributingPages: MIN_DENOMINATOR,
      stabilityThreshold: STABILITY_THRESHOLD,
    },
    amendment: 'Amendment 1 to the held-out evaluation protocol, dated 20 September 2026',
  };
}
