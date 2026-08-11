/**
 * An exclusive, durable record that a run has started.
 *
 * The pre-run seal is deliberately left unchanged by a run, so on its own it can be
 * presented again and again: a second invocation would pass every check and produce a
 * second set of reports, a second dataset and a second closed seal. Whichever came out
 * best could then be the one that gets reported.
 *
 * The lock is created with the exclusive flag before the analyser is touched, so two runs
 * cannot both believe they are the first, and it is written to disk and flushed before
 * anything else happens. A run that fails after that point leaves the lock behind marked
 * failed: rerunning then requires deleting it by hand, which is a deliberate act and
 * leaves the failed record visible until someone does.
 */

import { openSync, writeSync, fsyncSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

export const lockPathFor = (sealPath) => `${sealPath}.run`;

/**
 * Claims the right to run. Returns { claimed: false, existing } when a run has already
 * been started against this seal, whatever its outcome.
 */
export function claimRun(sealPath, record) {
  const path = lockPathFor(sealPath);

  if (existsSync(path)) {
    let existing = null;
    try {
      existing = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      existing = { status: 'unreadable' };
    }
    return { claimed: false, path, existing };
  }

  const contents = JSON.stringify({ status: 'started', ...record }, null, 2) + '\n';
  let fd;
  try {
    // 'wx' fails if the file appeared between the check above and here.
    fd = openSync(path, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return { claimed: false, path, existing: { status: 'raced' } };
    throw error;
  }
  try {
    writeSync(fd, contents);
    // Flushed before the analyser runs: a crash must still leave the claim behind.
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { claimed: true, path };
}

export function completeRun(path, record) {
  writeFileSync(path, JSON.stringify({ status: 'completed', ...record }, null, 2) + '\n');
}

export function failRun(path, reason, record = {}) {
  writeFileSync(
    path,
    JSON.stringify({ status: 'failed', reason, ...record }, null, 2) + '\n'
  );
}

/** Human-readable explanation of a refused claim. */
export function describeRefusal(path, existing) {
  const started = existing?.startedAt ? ` started ${existing.startedAt}` : '';
  const base =
    `this pre-run seal has already been used for a run${started} (status: ` +
    `${existing?.status ?? 'unknown'}). Recorded at ${path}.`;

  if (existing?.status === 'failed') {
    return (
      `${base}\nThat run failed: ${existing.reason ?? 'no reason recorded'}\n` +
      'A failed run is kept rather than cleared, so it cannot be quietly repeated until ' +
      'the failure is looked at. Delete the lock deliberately to run again.'
    );
  }
  return (
    `${base}\nEvery page is analysed once, at evaluation-v1.0.0. A second run against the ` +
    'same seal would produce a second dataset, and a choice between them.'
  );
}
