/**
 * The approval state machine.
 *
 * Every test here comes from a defect found by review, not from imagination. The pattern in
 * all of them is the same: a gate that existed but could be walked around, or a state that
 * counted as settled when it was not.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyLog, appendAttempt, ELIGIBILITY_CRITERIA, recordCandidates, lockCandidateSet,
  approveCandidateSet, APPROVAL, supersedeCandidateSet, publishProvenance, deriveDraft,
} from '../run.mjs';
import { parseDrawOrder, nextWork, MAX_QUALIFIED_AGENCIES, isSuperseded } from '../selection.mjs';
import { POLICY } from '../politeness.mjs';

const drawOrder = parseDrawOrder(
  readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
);
const el = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));

/** Records, locks and (by default) approves a set, so a test can reach assessment. */
function ready(log, agency, category, urls, { approve = true } = {}) {
  recordCandidates(log, { agency, category, urls });
  lockCandidateSet(log, { agency, category });
  if (approve) approveCandidateSet(log, { agency, category, approved: true });
  return log.candidateSets[`${agency}\u0000${category}`].locked;
}

const outcome = (agency, category, url, extra = {}) => ({
  examinedAt: '2026-09-24T00:00:00Z', agency, website: 'https://w.govt.nz/', url,
  status: 'excluded', category, exclusionReason: 'no personal-name field', eligibility: el(), ...extra,
});

describe('the candidate set must be approved before assessment', () => {
  test('a locked but unapproved set refuses assessment', () => {
    // The set is where the judgement sits - which links looked like a form. Approving only
    // the verdicts would leave that unreviewed, and no code can check it.
    const log = emptyLog();
    const [url] = ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a'], { approve: false });
    assert.throws(() => appendAttempt(log, outcome('TPK', 'account-registration', url)), /is pending/);
  });

  test('a rejected set refuses assessment too', () => {
    const log = emptyLog();
    const [url] = ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a'], { approve: false });
    approveCandidateSet(log, { agency: 'TPK', category: 'account-registration', approved: false, note: 'missed the online form' });
    assert.throws(() => appendAttempt(log, outcome('TPK', 'account-registration', url)), /is rejected/);
  });

  test('a set cannot be approved before it is locked', () => {
    const log = emptyLog();
    recordCandidates(log, { agency: 'TPK', category: 'account-registration', urls: ['https://w.govt.nz/a'] });
    assert.throws(
      () => approveCandidateSet(log, { agency: 'TPK', category: 'account-registration', approved: true }),
      /must be locked before it can be approved/
    );
  });

  test('nextWork asks for the set approval rather than offering assessment', () => {
    const log = emptyLog();
    ready(log, drawOrder[0].agency, 'account-registration', ['https://w.govt.nz/a'], { approve: false });
    const work = nextWork(log, drawOrder);
    assert.equal(work.needsSetApproval, true);
    assert.deepEqual(work.locked, ['https://w.govt.nz/a']);
  });
});

describe('only approved captures qualify an agency', () => {
  test('forty pending captures do not end the scan', () => {
    // The defect: qualification counted anything not rejected, so forty unreviewed
    // captures would have ended the scan - the opposite of what the gate is for.
    const log = emptyLog();
    for (let i = 0; i < MAX_QUALIFIED_AGENCIES; i++) {
      log.attempts.push({
        agency: drawOrder[i].agency, status: 'captured', approval: APPROVAL.PENDING,
        category: 'account-registration', url: `https://w.govt.nz/${i}`,
      });
    }
    const work = nextWork(log, drawOrder);
    assert.notEqual(work.done, true, 'pending captures must not end the scan');
    assert.match(work.reason, /pending or rejected/);
  });

  test('forty approved captures do end it', () => {
    const log = emptyLog();
    for (let i = 0; i < MAX_QUALIFIED_AGENCIES; i++) {
      log.attempts.push({
        agency: drawOrder[i].agency, status: 'captured', approval: APPROVAL.APPROVED,
        category: 'account-registration', url: `https://w.govt.nz/${i}`,
      });
    }
    const work = nextWork(log, drawOrder);
    assert.equal(work.done, true);
    assert.match(work.reason, /40 agencies have qualified/);
  });
});

describe('work does not advance past an unresolved outcome', () => {
  test('a pending outcome blocks the next category', () => {
    const log = emptyLog();
    const agency = drawOrder[0].agency;
    const [url] = ready(log, agency, 'account-registration', ['https://w.govt.nz/a']);
    appendAttempt(log, outcome(agency, 'account-registration', url));
    const work = nextWork(log, drawOrder);
    assert.equal(work.category, 'account-registration');
    assert.match(work.reason, /pending or rejected/);
  });

  test('a rejected outcome blocks until it is superseded', () => {
    const log = emptyLog();
    const agency = drawOrder[0].agency;
    const [url] = ready(log, agency, 'account-registration', ['https://w.govt.nz/a']);
    appendAttempt(log, outcome(agency, 'account-registration', url));
    log.attempts[0].approval = APPROVAL.REJECTED;
    assert.match(nextWork(log, drawOrder).reason, /pending or rejected/);

    appendAttempt(log, outcome(agency, 'account-registration', url, {
      supersedes: url, exclusionReason: 'corrected: the field is a display name, not a personal name',
    }));
    log.attempts[1].approval = APPROVAL.APPROVED;
    assert.equal(isSuperseded(log, log.attempts[0]), true);
    assert.doesNotMatch(nextWork(log, drawOrder).reason ?? '', /pending or rejected/);
  });

  test('a correction preserves the original record', () => {
    // A correction that erases what it corrected is not a correction; the ledger has to
    // show what was decided first.
    const log = emptyLog();
    const [url] = ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a']);
    appendAttempt(log, outcome('TPK', 'account-registration', url, { exclusionReason: 'first call' }));
    log.attempts[0].approval = APPROVAL.REJECTED;
    appendAttempt(log, outcome('TPK', 'account-registration', url, { supersedes: url, exclusionReason: 'second call' }));
    assert.equal(log.attempts.length, 2);
    assert.equal(log.attempts[0].exclusionReason, 'first call');
    assert.equal(log.attempts[0].approval, APPROVAL.REJECTED);
    assert.equal(log.attempts[1].supersedes, url);
  });

  test('a correction is refused when nothing was rejected', () => {
    const log = emptyLog();
    const [url] = ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a']);
    appendAttempt(log, outcome('TPK', 'account-registration', url));
    assert.throws(
      () => appendAttempt(log, outcome('TPK', 'account-registration', url, { supersedes: url })),
      /already recorded/
    );
  });
});

describe('discovery pacing is recorded and checked', () => {
  const discovery = (url, navigatedAt) => ({
    examinedAt: navigatedAt, agency: 'TPK', website: 'https://w.govt.nz/', url,
    status: 'discovery', discoveryKind: 'internal-search', navigatedAt,
  });

  test('a discovery record without a navigation time is refused', () => {
    const log = emptyLog();
    const bad = discovery('https://w.govt.nz/search', undefined);
    assert.throws(() => appendAttempt(log, bad), /needs navigatedAt/);
  });

  test('two navigations closer than the minimum are refused', () => {
    // Discovery browsing happens outside the capture harness, so the pacer cannot enforce
    // it. Recording the time and checking the gap makes a run that went too fast visible
    // rather than merely promised.
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', '2026-09-24T00:00:00Z'));
    assert.throws(
      () => appendAttempt(log, discovery('https://w.govt.nz/b', '2026-09-24T00:00:03Z')),
      /only 3000 ms since the previous navigation/
    );
  });

  test('the gap is recorded on the attempt when it is respected', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', '2026-09-24T00:00:00Z'));
    appendAttempt(log, discovery('https://w.govt.nz/b', '2026-09-24T00:00:06Z'));
    assert.equal(log.attempts[1].msSincePreviousNavigation, 6000);
    assert.ok(6000 >= POLICY.minDelayBetweenNavigationsMs);
  });
});

describe('a rejected candidate set is superseded, not edited', () => {
  test('a rejected set refuses new candidates until it is superseded', () => {
    const log = emptyLog();
    ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a'], { approve: false });
    approveCandidateSet(log, { agency: 'TPK', category: 'account-registration', approved: false, note: 'incomplete provenance' });
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: 'account-registration', urls: ['https://w.govt.nz/b'] }),
      /must be superseded/
    );
  });

  test('superseding archives the rejected set and opens the next version', () => {
    // The rejected attempt is part of how the sample was arrived at. A redo that erased it
    // would hide exactly what the ledger exists to show.
    const log = emptyLog();
    ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a'], { approve: false });
    approveCandidateSet(log, { agency: 'TPK', category: 'account-registration', approved: false });
    supersedeCandidateSet(log, { agency: 'TPK', category: 'account-registration', reason: 'incomplete discovery provenance' });

    assert.equal(log.supersededCandidateSets.length, 1);
    assert.equal(log.supersededCandidateSets[0].version, 1);
    assert.equal(log.supersededCandidateSets[0].approval, APPROVAL.REJECTED);
    assert.match(log.supersededCandidateSets[0].supersededReason, /incomplete discovery provenance/);

    recordCandidates(log, { agency: 'TPK', category: 'account-registration', urls: ['https://w.govt.nz/b'] });
    assert.equal(log.candidateSets['TPK\u0000account-registration'].version, 2);
  });

  test('only a rejected set may be superseded, and a reason is required', () => {
    const log = emptyLog();
    ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a']);
    assert.throws(
      () => supersedeCandidateSet(log, { agency: 'TPK', category: 'account-registration', reason: 'no' }),
      /only a rejected candidate set/
    );
    approveCandidateSet(log, { agency: 'TPK', category: 'account-registration', approved: false });
    assert.throws(
      () => supersedeCandidateSet(log, { agency: 'TPK', category: 'account-registration' }),
      /needs a reason/
    );
  });
});

describe('the corpus draft and the publishable record', () => {
  test('a draft will not be built without real frame hashes', () => {
    // A draft carrying nulls would be refused by the seal anyway, but writing one invites
    // it being read as a real artefact.
    const log = emptyLog();
    for (const bad of [undefined, null, '', 'not-a-hash', 'a'.repeat(63)]) {
      assert.throws(
        () => deriveDraft(log, { frameSha256: bad, drawOrderSha256: 'd'.repeat(64) }),
        /frameSha256 must be a SHA-256 digest/
      );
    }
    assert.doesNotThrow(() => deriveDraft(log, { frameSha256: 'a'.repeat(64), drawOrderSha256: 'd'.repeat(64) }));
  });

  test('the published provenance carries no markup', () => {
    const log = emptyLog();
    const urls = ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a']);
    appendAttempt(log, outcome('TPK', 'account-registration', urls[0]));
    const dir = mkdtempSync(join(tmpdir(), 'formfair-pub-'));
    try {
      const { ledgerPath, provenancePath } = publishProvenance(log, { to: dir });
      const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
      assert.equal(provenance.schema, 'formfair/capture-provenance@1');
      assert.equal(provenance.counts.candidatesAssessed, 1);
      assert.equal(provenance.candidateSets[0].version, 1);
      assert.ok(provenance.politeness.minDelayBetweenNavigationsMs >= 5000);
      // Nothing published may contain captured markup.
      const published = readFileSync(ledgerPath, 'utf8') + readFileSync(provenancePath, 'utf8');
      assert.doesNotMatch(published, /<html|<form|<input/i, 'published provenance must contain no markup');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
