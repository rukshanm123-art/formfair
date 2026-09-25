/**
 * Discovery provenance: rounds, methods, outcomes, and the binding between a candidate set
 * and the inspections that produced it.
 *
 * Every test here comes from a defect found after the previous tag, which is the reason it
 * exists: fixes were shipped ahead of the tests that would have held them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyLog, appendAttempt, recordCandidates, lockCandidateSet, approveCandidateSet,
  supersedeCandidateSet, publishProvenance, ELIGIBILITY_CRITERIA, APPROVAL,
} from '../run.mjs';
import { DISCOVERY_METHODS, DISCOVERY_OUTCOMES } from '../selection.mjs';

const AGENCY = 'Te Puni Kōkiri';
const CAT = 'account-registration';

const discovery = (url, { method = 'navigation', outcome = 'no-candidates', version = 1, at, note } = {}) => ({
  examinedAt: at, agency: AGENCY, website: 'https://w.govt.nz/', url,
  status: 'discovery', discoveryKind: method, outcome, category: CAT,
  candidateSetVersion: version, navigatedAt: at, ...(note ? { note } : {}),
});

/** Timestamps spaced beyond the politeness minimum. */
const clock = (() => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 8, 24, 0, n++ * 2)).toISOString().replace(/\.\d{3}Z$/, 'Z');
})();

describe('a discovery record identifies its round', () => {
  test('category, set version, method and outcome are all required', () => {
    const log = emptyLog();
    const base = discovery('https://w.govt.nz/a', { at: clock() });
    for (const missing of ['category', 'candidateSetVersion', 'outcome', 'discoveryKind']) {
      const bad = { ...base };
      delete bad[missing];
      assert.throws(() => appendAttempt(emptyLog(), bad), new RegExp(missing === 'discoveryKind' ? 'method' : missing));
    }
    assert.doesNotThrow(() => appendAttempt(log, base));
  });

  test('robots is its own method, not a sitemap', () => {
    // Earlier rounds filed a robots.txt fetch under `sitemap`, which made the published
    // method counts describe inspections that never happened.
    assert.ok(DISCOVERY_METHODS.includes('robots'));
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/robots.txt', { method: 'robots', outcome: 'disallowed', at: clock() }));
    assert.equal(log.attempts[0].discoveryKind, 'robots');
  });

  test('an outcome distinguishes a method that was unavailable from one that found nothing', () => {
    assert.deepEqual([...DISCOVERY_OUTCOMES], ['candidates-found', 'no-candidates', 'unavailable', 'disallowed']);
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/s1', { outcome: 'unavailable', at: clock(), note: 'no search form' }));
    appendAttempt(log, discovery('https://w.govt.nz/s2', { outcome: 'no-candidates', at: clock() }));
    assert.equal(log.attempts[0].outcome, 'unavailable');
    assert.equal(log.attempts[0].note, 'no search form');
    assert.equal(log.attempts[1].outcome, 'no-candidates');
  });

  test('every attempt gets a stable id', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', { at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/b', { at: clock() }));
    assert.match(log.attempts[0].id, /^d-\d{4}$/);
    assert.notEqual(log.attempts[0].id, log.attempts[1].id);
  });

  test('a later round may re-inspect the same page', () => {
    // Refusing this is what made an independently identifiable second round impossible:
    // the new round could only ever be additions to the first.
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', { version: 1, at: clock() }));
    assert.throws(() => appendAttempt(log, discovery('https://w.govt.nz/a', { version: 1, at: clock() })), /already recorded/);
    assert.doesNotThrow(() => appendAttempt(log, discovery('https://w.govt.nz/a', { version: 2, at: clock() })));
  });
});

describe('a locked set is bound to the round that produced it', () => {
  test('a set cannot be locked without supporting discovery records', () => {
    const log = emptyLog();
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    assert.throws(() => lockCandidateSet(log, { agency: AGENCY, category: CAT }), /no discovery records/);
  });

  test('locking records exactly which inspections support it', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/nav', { method: 'navigation', outcome: 'candidates-found', at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/robots.txt', { method: 'robots', outcome: 'no-candidates', at: clock() }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    const set = lockCandidateSet(log, { agency: AGENCY, category: CAT });
    assert.deepEqual(set.discoveryRecordIds, ['d-0001', 'd-0002']);
    assert.deepEqual(set.discoveryMethods, ['navigation', 'robots']);
  });

  test('a set is bound only to its own round, not to an earlier one', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/round1', { version: 1, at: clock(), outcome: 'candidates-found' }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    approveCandidateSet(log, { agency: AGENCY, category: CAT, approved: false });
    supersedeCandidateSet(log, { agency: AGENCY, category: CAT, reason: 'incomplete provenance' });

    appendAttempt(log, discovery('https://w.govt.nz/round2', { version: 2, at: clock(), outcome: 'candidates-found' }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/y'] });
    const v2 = lockCandidateSet(log, { agency: AGENCY, category: CAT });
    assert.equal(v2.version, 2);
    assert.deepEqual(v2.discoveryRecordIds, ['d-0002'], 'only the second round supports the second set');
  });
});

describe('legacy records migrate rather than crash', () => {
  test('a set with no version archives with one derived from history', () => {
    // A set created before versioning existed archived as "version undefined".
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', { at: clock(), outcome: 'candidates-found' }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    approveCandidateSet(log, { agency: AGENCY, category: CAT, approved: false });
    delete log.candidateSets[`${AGENCY}\u0000${CAT}`].version;
    const archived = supersedeCandidateSet(log, { agency: AGENCY, category: CAT, reason: 'legacy' });
    assert.equal(archived.version, 1, 'a missing version is derived, never left undefined');
  });
});

describe('the published counts describe what happened', () => {
  test('methods, outcomes, rounds and pending sets are all counted', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/robots.txt', { method: 'robots', outcome: 'disallowed', at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/sitemap.xml', { method: 'sitemap', outcome: 'unavailable', at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/nav', { method: 'navigation', outcome: 'candidates-found', at: clock() }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });

    const dir = mkdtempSync(join(tmpdir(), 'formfair-prov-'));
    try {
      const { provenancePath } = publishProvenance(log, { to: dir });
      const p = JSON.parse(readFileSync(provenancePath, 'utf8'));
      assert.deepEqual(p.discoveryByMethod, { robots: 1, sitemap: 1, navigation: 1 });
      assert.deepEqual(p.discoveryByOutcome, { disallowed: 1, unavailable: 1, 'candidates-found': 1 });
      assert.equal(p.discoveryByRound[`${AGENCY} / ${CAT} v1`], 3);
      // A pending candidate SET is what blocks the work, and it was not counted at all.
      assert.equal(p.counts.pendingApprovalCandidateSets, 1);
      assert.deepEqual(p.candidateSets[0].supportedByDiscoveryRecords, ['d-0001', 'd-0002', 'd-0003']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
