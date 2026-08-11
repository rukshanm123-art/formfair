/**
 * Protocol section 10. The gate that must pass before FormFair is run on a held-out page.
 *
 * The seal exists because the ordering is the whole methodological claim: annotation and
 * adjudication are complete and immutable *before* the tool's output is seen. A manifest
 * of hashes makes that checkable after the fact rather than merely asserted.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export const REQUIRED = [
  { key: 'annotatorA', description: "first primary annotator's original independent labels" },
  { key: 'annotatorB', description: "second primary annotator's original independent labels" },
  { key: 'kappa', description: 'agreement computed from the original labels, before adjudication' },
  { key: 'adjudication', description: 'adjudicated decisions, reasons and catalogue clauses' },
];

export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Verifies the seal. Returns the failures rather than throwing, so a caller can report
 * every problem at once instead of one per run.
 */
export function verifySeal(manifest, resolve = (p) => p) {
  const failures = [];

  for (const { key, description } of REQUIRED) {
    const entry = manifest?.files?.[key];
    if (!entry) {
      failures.push(`missing from the manifest: ${key} (${description})`);
      continue;
    }
    const path = resolve(entry.path);
    if (!existsSync(path)) {
      failures.push(`${key}: file not found at ${entry.path}`);
      continue;
    }
    const actual = hashFile(path);
    if (actual !== entry.sha256) {
      failures.push(
        `${key}: hash mismatch. The sealed record is ${entry.sha256} but ${entry.path} ` +
          `now hashes to ${actual}. A sealed file must not change.`
      );
    }
  }

  if (manifest?.instrument !== 'evaluation-v1.0.0') {
    failures.push(`instrument must be evaluation-v1.0.0, found ${manifest?.instrument ?? 'nothing'}`);
  }
  if (manifest?.formfairRun) {
    failures.push('formfairRun is already recorded: the seal is closed and must not be re-sealed');
  }

  return { sealed: failures.length === 0, failures };
}

/**
 * Protocol section 10, after the run.
 *
 * A pre-run seal says annotation was finished before FormFair was seen. It does not say
 * which run the metrics describe. Official figures need both, so this additionally
 * requires the run record and the hashes of what it produced: without them, a report
 * could be swapped for another and the seal would still verify.
 */
export function verifyClosedSeal(manifest, resolve = (p) => p) {
  const failures = [];

  for (const { key, description } of REQUIRED) {
    const entry = manifest?.files?.[key];
    if (!entry) {
      failures.push(`missing from the manifest: ${key} (${description})`);
      continue;
    }
    const path = resolve(entry.path);
    if (!existsSync(path)) {
      failures.push(`${key}: file not found at ${entry.path}`);
      continue;
    }
    if (hashFile(path) !== entry.sha256) {
      failures.push(`${key}: hash mismatch, a sealed file must not change after sealing`);
    }
  }

  if (manifest?.instrument !== 'evaluation-v1.0.0') {
    failures.push(`instrument must be evaluation-v1.0.0, found ${manifest?.instrument ?? 'nothing'}`);
  }

  const run = manifest?.formfairRun;
  if (!run) {
    failures.push(
      'formfairRun is absent: this seal has not been closed, so no official metrics can ' +
        'be computed from it. FormFair must be run once, at evaluation-v1.0.0, and the ' +
        'run recorded here.'
    );
    return { sealed: false, failures };
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(run.runAt ?? '')) {
    failures.push('formfairRun.runAt must be an ISO 8601 UTC timestamp');
  }
  if (run.instrument !== 'evaluation-v1.0.0') {
    failures.push(`formfairRun.instrument must be evaluation-v1.0.0, found ${run.instrument ?? 'nothing'}`);
  }
  for (const key of ['reportsSha256', 'datasetSha256', 'inventorySha256']) {
    if (!/^[0-9a-f]{64}$/.test(run[key] ?? '')) {
      failures.push(`formfairRun.${key} must be a 64-character hex digest of what the run produced`);
    }
  }

  return { sealed: failures.length === 0, failures };
}
