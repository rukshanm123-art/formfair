/**
 * The approval state machine.
 *
 * Every test here comes from a defect found by review, not from imagination. The pattern in
 * all of them is the same: a gate that existed but could be walked around, or a state that
 * counted as settled when it was not.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyLog, appendAttempt, ELIGIBILITY_CRITERIA, recordCandidates, lockCandidateSet,
  approveCandidateSet, APPROVAL,
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
