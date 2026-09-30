/**
 * Amendment 44: "eligible but not selected" is a structured disposition, not a sentence.
 *
 * NZDF's enquiry-or-contact round produced five eligible candidates, so the frozen tie-break alone
 * decided which entered the corpus. The other four were written as `excluded` with every
 * eligibility criterion `null` — meaning "not established" — and the finding that they were
 * eligible survived only in prose. The log could not report how many candidates were eligible, and
 * the tie-break claim rested on nothing a gate could check. `doExclude` makes exactly this argument
 * about criterion-five counts; it applies with equal force to the numerator of an eligibility rate.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, appendAttempt, deriveLedger, corpusBlockers, ELIGIBILITY_CRITERIA, APPROVAL,
} from '../run.mjs';
import { TERMINAL_STATUSES, isTerminalDecision } from '../selection.mjs';
import { terminalDecisionProblems } from '../../evaluation/solo/descriptive.mjs';
import { prepareSet } from './helpers.mjs';

const AGENCY = 'New Zealand Defence Force';
const CAT = 'enquiry-or-contact';
const FIRST = 'https://a-museum.org.nz/contact/';
const LATER = 'https://z-careers.mil.nz/contact-us';
const ALL_TRUE = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, true]));
const ALL_NULL = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));

const retrieval = (url, pageId) => ({
  agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url,
  status: 'retrieved', approval: APPROVAL.NOT_APPLICABLE, candidateSetVersion: 1,
  pageId, file: `${pageId}.html`, htmlSha256: 'a'.repeat(64), htmlBytes: 2048,
  eligibility: ALL_NULL(),
});

/** A round with both candidates retrieved and the alphabetically first one captured. */
const round = () => {
  const log = emptyLog();
  prepareSet(log, AGENCY, CAT, [FIRST, LATER]);
  appendAttempt(log, retrieval(FIRST, 'a-museum-contact'));
  const firstRetrieval = log.attempts.at(-1).id;
  appendAttempt(log, retrieval(LATER, 'z-careers-contact'));
  const laterRetrieval = log.attempts.at(-1).id;
  appendAttempt(log, {
    ...log.attempts.find((a) => a.id === firstRetrieval), id: undefined,
    status: 'captured', promotedFrom: firstRetrieval, approval: APPROVAL.PENDING,
    inclusionEvidence: 'all five criteria satisfied; alphabetically first eligible canonical URL',
    eligibility: ALL_TRUE(),
  });
  return { log, capture: log.attempts.at(-1).id, laterRetrieval };
};

const notSelected = (over = {}) => ({
  agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url: LATER,
  status: 'eligible-not-selected', candidateSetVersion: 1, approval: APPROVAL.PENDING,
  eligibility: ALL_TRUE(),
  exclusionReason: 'eligible on all five criteria; lost the frozen tie-break',
  htmlSha256: 'a'.repeat(64), htmlBytes: 2048, ...over,
});

describe('the disposition records eligibility structurally', () => {
  test('it settles a candidate, like any other terminal decision', () => {
    assert.ok(TERMINAL_STATUSES.includes('eligible-not-selected'));
    assert.equal(isTerminalDecision({ status: 'eligible-not-selected' }), true);
    const { log, capture, laterRetrieval } = round();
    appendAttempt(log, notSelected({ evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: capture }));
    assert.equal(corpusBlockers(log).find((b) => b.kind === 'unassessed-candidates'), undefined);
    assert.deepEqual(terminalDecisionProblems(log), []);
  });

  test('all five criteria must be true, so an eligibility rate is computable', () => {
    const { log, capture, laterRetrieval } = round();
    for (const bad of [ALL_NULL(), { ...ALL_TRUE(), asksForTheNameOfANaturalPerson: false }]) {
      assert.throws(
        () => appendAttempt(log, notSelected({
          eligibility: bad, evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: capture,
        })),
        /must record every eligibility criterion as true/
      );
    }
  });

  test('it must cite the retrieval it was judged from', () => {
    const { log, capture } = round();
    assert.throws(
      () => appendAttempt(log, notSelected({ notSelectedInFavourOf: capture })),
      /must cite the assessment-only retrieval/
    );
  });

  test('it must name the capture that was selected instead', () => {
    const { log, laterRetrieval } = round();
    assert.throws(
      () => appendAttempt(log, notSelected({ evidenceFromAttemptId: laterRetrieval })),
      /must name the captured candidate that was selected instead/
    );
  });
});

describe('the tie-break claim is checked, not trusted', () => {
  test('the named selection must be a capture', () => {
    const { log, laterRetrieval } = round();
    assert.throws(
      () => appendAttempt(log, notSelected({
        evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: laterRetrieval,
      })),
      /is a retrieved attempt; notSelectedInFavourOf must name the CAPTURED candidate/
    );
  });

  test('the selection must come from the same locked set', () => {
    // Differing on ROUND rather than category: a category mismatch is caught earlier still, by the
    // evidence-citation check, which is its own correct guard.
    const { log, capture, laterRetrieval } = round();
    assert.throws(
      () => appendAttempt(log, notSelected({
        candidateSetVersion: 2,
        evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: capture,
      })),
      /the selection must come from the same locked set/
    );
  });

  test('a category mismatch is refused by the citation check before this one', () => {
    const { log, capture, laterRetrieval } = round();
    assert.throws(
      () => appendAttempt(log, notSelected({
        category: 'service-application',
        evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: capture,
      })),
      /is category enquiry-or-contact, not service-application/
    );
  });

  test('a selection that does not sort first is refused', () => {
    // The whole point of the rule: a candidate sorting BEFORE the selection cannot have lost to it.
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, [FIRST, LATER]);
    appendAttempt(log, retrieval(LATER, 'z-careers-contact'));
    const lateRetrieval = log.attempts.at(-1).id;
    appendAttempt(log, {
      ...log.attempts.at(-1), id: undefined, status: 'captured', promotedFrom: lateRetrieval,
      approval: APPROVAL.PENDING, inclusionEvidence: 'captured', eligibility: ALL_TRUE(),
    });
    const lateCapture = log.attempts.at(-1).id;
    appendAttempt(log, retrieval(FIRST, 'a-museum-contact'));
    const earlyRetrieval = log.attempts.at(-1).id;
    assert.throws(
      () => appendAttempt(log, notSelected({
        url: FIRST, evidenceFromAttemptId: earlyRetrieval, notSelectedInFavourOf: lateCapture,
      })),
      /does not sort before this candidate/
    );
  });

  test('a rejected selection re-opens the tie-break at the corpus gate', () => {
    const { log, capture, laterRetrieval } = round();
    appendAttempt(log, notSelected({ evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: capture }));
    log.attempts.find((a) => a.id === capture).approval = APPROVAL.REJECTED;
    const blocker = corpusBlockers(log).find((b) => b.kind === 'tie-break-unsound');
    assert.ok(blocker, 'a rejected selection left the tie-break standing');
    assert.match(blocker.items[0], /has been REJECTED/);
  });

  test('the sealer refuses the same states independently', () => {
    const { log, capture, laterRetrieval } = round();
    appendAttempt(log, notSelected({ evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: capture }));
    assert.deepEqual(terminalDecisionProblems(log), []);
    // Break the sort order in memory, as a tampered log would.
    log.attempts.at(-1).url = 'https://0-first.govt.nz/contact/';
    assert.ok(
      terminalDecisionProblems(log).some((p) => /does not sort before it/.test(p)),
      'the sealer accepted a tie-break the rule did not make'
    );
  });
});

describe('the outcome is published, not just recorded', () => {
  test('the ledger carries the status and the selection it lost to', () => {
    const { log, capture, laterRetrieval } = round();
    appendAttempt(log, notSelected({ evidenceFromAttemptId: laterRetrieval, notSelectedInFavourOf: capture }));
    const csv = deriveLedger(log);
    const header = csv.split('\n')[0].split(',');
    assert.ok(header.includes('notSelectedInFavourOf'));
    const row = csv.split('\n').find((l) => l.includes('eligible-not-selected'));
    assert.ok(row, 'the disposition does not appear in the ledger');
    assert.ok(row.includes(capture), 'the selection it lost to is not published');
    const widths = new Set(csv.trim().split('\n').map((l) => (l.match(/,/g) ?? []).length));
    assert.equal(widths.size, 1, 'rows disagree on column count');
  });
});
