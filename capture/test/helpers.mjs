/**
 * Shared test setup.
 *
 * Reaching assessment now takes four steps - a discovery round, recorded candidates, a
 * locked set, an approved set - and each exists because something was walkable without it.
 * Repeating that inline in every file is how the four test files drifted apart, so it lives
 * here once.
 */

import {
  appendAttempt, recordCandidates, lockCandidateSet, approveCandidateSet,
} from '../run.mjs';

/** Timestamps spaced beyond the politeness minimum, shared across a whole test file. */
let tick = 0;
export const nextTimestamp = () =>
  new Date(Date.UTC(2026, 8, 24, 0, tick++ * 2)).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** One discovery record, enough to support a set. */
export function addDiscovery(log, { agency, category, version = 1, url, method = 'navigation', outcome = 'candidates-found', supersedes = null }) {
  const at = nextTimestamp();
  appendAttempt(log, {
    examinedAt: at, agency, website: 'https://w.govt.nz/',
    url: url ?? `https://w.govt.nz/discovery/${encodeURIComponent(agency)}/${category}/v${version}/${tick}`,
    status: 'discovery', discoveryKind: method, outcome, category,
    candidateSetVersion: version, navigatedAt: at,
    // Matches the CLI, which records discovery as approved: a page inspected to find links is
    // not a judgement to approve. The helper left it pending, so fixtures diverged from the
    // production path and every test had to work around a state no real log contains.
    approval: 'approved',
    ...(supersedes ? { supersedesDiscoveryId: supersedes } : {}),
  });
  return log.attempts.at(-1);
}

/**
 * Discovery, candidates, lock, and optionally approval - the whole path to assessment.
 */
export function prepareSet(log, agency, category, urls, { approve = true, version = 1 } = {}) {
  addDiscovery(log, { agency, category, version });
  recordCandidates(log, { agency, category, urls });
  lockCandidateSet(log, { agency, category });
  if (approve) approveCandidateSet(log, { agency, category, approved: true });
  return log.candidateSets[`${agency}\u0000${category}`].locked;
}
