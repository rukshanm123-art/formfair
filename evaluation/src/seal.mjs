/**
 * Protocol section 10. The gate that must pass before FormFair is run on a held-out page.
 *
 * The seal exists because the ordering is the whole methodological claim: annotation and
 * adjudication are complete and immutable *before* the tool's output is seen. A manifest
 * of hashes makes that checkable after the fact rather than merely asserted.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Sealed before FormFair is run.
 *
 * The inventory and the final ground truth are here, not merely the annotations they came
 * from: the join is given paths to those two files, and unless the seal covers them, a
 * different inventory or a hand-edited ground truth could be supplied to it.
 */
export const REQUIRED = [
  { key: 'annotatorA', description: "first primary annotator's original independent labels" },
  { key: 'annotatorB', description: "second primary annotator's original independent labels" },
  { key: 'kappa', description: 'agreement computed from the original labels, before adjudication' },
  { key: 'adjudication', description: 'adjudicated decisions, reasons and catalogue clauses' },
  { key: 'inventory', description: 'the frozen control inventory the annotators labelled' },
  { key: 'groundTruth', description: 'final ground truth, derived from both annotations and the adjudication' },
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

/** Artefacts the run produces. Required, and hash-checked, once the seal is closed. */
/** Produced by the run itself, and recorded in a separate closed seal. */
export const RUN_ARTEFACTS = [
  { key: 'reports', description: 'the unmodified JSON reports from the run' },
  { key: 'dataset', description: 'the joined dataset the metrics were computed from' },
];

/**
 * Protocol section 10, after the run.
 *
 * A pre-run seal says annotation finished before FormFair was seen. It does not say which
 * run the metrics describe, and it does not bind the numbers to any particular material.
 *
 * This checks the files themselves, not the shape of their hashes. Validating that a
 * digest looks like a digest is not a check: sixty-four zeros satisfy it, and a seal that
 * accepts sixty-four zeros secures nothing at all.
 */
export function verifyClosedSeal(manifest, resolve = (p) => p) {
  const failures = [];
  const run = manifest?.formfairRun;

  const checkFiles = (entries) => {
    for (const { key, description } of entries) {
      const entry = manifest?.files?.[key];
      if (!entry) {
        failures.push(`missing from the manifest: ${key} (${description})`);
        continue;
      }
      if (!isDigest(entry.sha256)) {
        failures.push(`${key}: sha256 must be a 64-character hex digest`);
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
          `${key}: ${entry.path} hashes to ${actual} but the seal records ${entry.sha256}. ` +
            'A sealed file must not change.'
        );
      }
    }
  };

  checkFiles(REQUIRED);

  if (manifest?.instrument !== 'evaluation-v1.0.0') {
    failures.push(`instrument must be evaluation-v1.0.0, found ${manifest?.instrument ?? 'nothing'}`);
  }

  if (!run) {
    failures.push(
      'formfairRun is absent: this seal has not been closed, so no official metrics can ' +
        'be computed from it. FormFair must be run once, at evaluation-v1.0.0, and the ' +
        'run recorded here.'
    );
    return { sealed: false, failures };
  }

  checkFiles(RUN_ARTEFACTS);

  if (!/^\d{4}-\d{2}-\d{2}T/.test(run.runAt ?? '')) {
    failures.push('formfairRun.runAt must be an ISO 8601 UTC timestamp');
  }
  if (run.instrument !== 'evaluation-v1.0.0') {
    failures.push(`formfairRun.instrument must be evaluation-v1.0.0, found ${run.instrument ?? 'nothing'}`);
  }
  if (run.instrumentCommit !== INSTRUMENT_COMMIT) {
    failures.push(
      `formfairRun.instrumentCommit must be ${INSTRUMENT_COMMIT}, the commit ` +
        `evaluation-v1.0.0 points at, found ${run.instrumentCommit ?? 'nothing'}`
    );
  }

  // The run's own record of what it produced must agree with the sealed files.
  for (const { key } of [...RUN_ARTEFACTS, { key: 'inventory' }, { key: 'groundTruth' }]) {
    const field = `${key}Sha256`;
    const sealed = manifest?.files?.[key]?.sha256;
    if (sealed && run[field] !== sealed) {
      failures.push(
        `formfairRun.${field} is ${run[field] ?? 'absent'} but the sealed ${key} hashes to ` +
          `${sealed}. The run record and the sealed artefact disagree.`
      );
    }
  }

  return { sealed: failures.length === 0, failures };
}

export const INSTRUMENT_COMMIT = '9f43862d033e1b45890f977cffb89ca4a9504d40';

const isDigest = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/**
 * Binds a dataset to a closed seal.
 *
 * Verifying the seal proves the sealed files are intact. It does not prove that the
 * dataset in front of you is the one they describe: without this, a seal over one
 * evaluation can be presented alongside the numbers from another.
 */
export function bindDataset(manifest, dataset, datasetSha256) {
  const failures = [];
  const sealedDataset = manifest?.files?.dataset?.sha256;

  if (sealedDataset && datasetSha256 !== sealedDataset) {
    failures.push(
      `the dataset supplied hashes to ${datasetSha256} but the seal covers ${sealedDataset}. ` +
        'These metrics would describe a different evaluation from the one that was sealed.'
    );
  }

  const pairs = [
    ['inventorySha256', 'inventory'],
    ['groundTruthSha256', 'groundTruth'],
    ['reportsSha256', 'reports'],
    ['annotationASha256', 'annotatorA'],
    ['annotationBSha256', 'annotatorB'],
    ['kappaSha256', 'kappa'],
    ['adjudicationSha256', 'adjudication'],
  ];
  for (const [field, key] of pairs) {
    const sealed = manifest?.files?.[key]?.sha256;
    const claimed = dataset?.builtFrom?.[field];
    if (!sealed) continue;
    if (claimed !== sealed) {
      failures.push(
        `dataset.builtFrom.${field} is ${claimed ?? 'absent'} but the sealed ${key} hashes ` +
          `to ${sealed}. The dataset was not built from the sealed material.`
      );
    }
  }

  if (dataset?.synthetic === true) {
    failures.push('a dataset marked synthetic cannot be scored through the sealed path');
  }

  return { bound: failures.length === 0, failures };
}

/**
 * Confirms a file handed to a command is exactly the one the seal covers.
 *
 * Sealing a file and then analysing a different one is the obvious way round a seal, and
 * comparing hashes is the only thing that closes it: a path can point anywhere.
 */
export function sealedFileMatches(manifest, key, path) {
  const entry = manifest?.files?.[key];
  if (!entry) return { ok: false, reason: `the seal does not cover ${key}` };
  if (!existsSync(path)) return { ok: false, reason: `${key}: no file at ${path}` };
  const actual = hashFile(path);
  if (actual !== entry.sha256) {
    return {
      ok: false,
      reason:
        `${key}: ${path} hashes to ${actual} but the seal covers ${entry.sha256}. ` +
        'This is not the file that was sealed.',
    };
  }
  return { ok: true, sha256: actual };
}
