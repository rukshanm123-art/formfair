/**
 * Amendment 41: a retrieval is evidence, and evidence does not settle a candidate.
 *
 * Amendment 40 added `retrieved` for exactly the right reason - obtaining a page should not assert
 * that it qualifies - but `status !== 'discovery'` was the de facto test for "decided" everywhere,
 * and the new status silently satisfied all of it.
 *
 * The attack, reproduced on a copy of the live log before this was written:
 *   1. delete the exclusion `c-0504`
 *   2. mark the retrieval `c-0503` approved
 *   3. approve the other four exclusions
 * `nextWork` then advanced to the next category and `corpusBlockers` reported nothing, while
 * `https://www.cadetnet.org.nz/complete-signup/` had never been decided at all.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, appendAttempt, corpusBlockers, ELIGIBILITY_CRITERIA, APPROVAL,
} from '../run.mjs';
import {
  nextWork, parseDrawOrder, isTerminalDecision, isEvidenceOnly, terminalDecisionsFor,
  TERMINAL_STATUSES,
} from '../selection.mjs';
import { terminalDecisionProblems } from '../../evaluation/solo/descriptive.mjs';
import { readFileSync } from 'node:fs';
import { prepareSet } from './helpers.mjs';

const drawOrder = parseDrawOrder(
  readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
);
const AGENCY = drawOrder[0].agency;
const CAT = 'account-registration';
const URL_ = 'https://w.govt.nz/complete-signup/';

const retrieval = (over = {}) => ({
  agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url: URL_,
  status: 'retrieved', approval: APPROVAL.NOT_APPLICABLE,
  pageId: 'w-govt-nz-complete-signup', file: 'w-govt-nz-complete-signup.html',
  htmlSha256: 'e'.repeat(64), htmlBytes: 69389,
  eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])), ...over,
});

const exclusion = (over = {}) => ({
  agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url: URL_,
  status: 'excluded', exclusionReason: 'asks for a token, not a person',
  eligibility: { ...Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    asksForTheNameOfANaturalPerson: false },
  approval: APPROVAL.PENDING, ...over,
});

const roundWith = (attempts) => {
  const log = emptyLog();
  prepareSet(log, AGENCY, CAT, [URL_]);
  for (const a of attempts) appendAttempt(log, a);
  return log;
};

describe('the reproduced attack: a retrieval standing in for a decision', () => {
  test('a retrieval alone leaves the candidate undecided, in both implementations', () => {
    const log = roundWith([retrieval()]);

    const blocker = corpusBlockers(log).find((b) => b.kind === 'unassessed-candidates');
    assert.ok(blocker, 'corpusBlockers accepted a retrieval as an outcome');
    assert.match(blocker.items[0], /a retrieval decides nothing/);

    const sealer = terminalDecisionProblems(log);
    assert.ok(sealer.some((p) => /has no active terminal decision/.test(p)), sealer.join('; '));

    const work = nextWork(log, drawOrder);
    assert.equal(work.agency, AGENCY);
    assert.equal(work.category, CAT, 'work advanced past an undecided candidate');
    assert.deepEqual(work.pending, [URL_]);
  });

  test('step 2 of the attack is refused at write time: a retrieval cannot be approved', () => {
    for (const approval of [APPROVAL.APPROVED, APPROVAL.PENDING, APPROVAL.REJECTED]) {
      assert.throws(
        () => roundWith([retrieval({ approval })]),
        /must record approval "not-applicable"/,
        `approval ${approval} was accepted on a retrieval`
      );
    }
  });

  test('and no decision may borrow the retrieval-only approval state', () => {
    assert.throws(
      () => roundWith([exclusion({ approval: APPROVAL.NOT_APPLICABLE })]),
      /only an evidence-only retrieval may record approval "not-applicable"/
    );
  });

  test('adding the exclusion settles it and work advances', () => {
    // Approved, because a pending outcome is its own blocker and would stop work first.
    const log = roundWith([retrieval()]);
    appendAttempt(log, exclusion({
      evidenceFromAttemptId: log.attempts.at(-1).id, approval: APPROVAL.APPROVED,
    }));
    assert.equal(corpusBlockers(log).find((b) => b.kind === 'unassessed-candidates'), undefined);
    assert.deepEqual(terminalDecisionProblems(log), []);
    const work = nextWork(log, drawOrder);
    assert.notEqual(work.category, CAT, 'the category should be finished');
  });

  test('two active decisions for one candidate are refused, not silently preferred', () => {
    const log = roundWith([retrieval()]);
    const src = log.attempts.at(-1).id;
    appendAttempt(log, exclusion({ evidenceFromAttemptId: src, approval: APPROVAL.APPROVED }));
    // A second decision about the same URL, superseding nothing. Pushed directly, which is how
    // the tampered log in the reproduction was built.
    log.attempts.push(exclusion({ id: 'c-9999', evidenceFromAttemptId: src,
      approval: APPROVAL.APPROVED, exclusionReason: 'a second, contradictory verdict' }));
    const blocker = corpusBlockers(log).find((b) => b.kind === 'contested-candidates');
    assert.ok(blocker, 'two live decisions were accepted');
    assert.ok(terminalDecisionProblems(log).some((p) => /2 active terminal decisions/.test(p)));
    assert.match(nextWork(log, drawOrder).reason ?? '', /more than one active terminal decision/);
  });
});

describe('an exclusion cites its evidence, and the citation is verified', () => {
  const withRetrieval = () => {
    const log = roundWith([retrieval()]);
    return { log, src: log.attempts.at(-1).id };
  };

  test('it may not supersede the very retrieval it rests on', () => {
    // What `c-0504` did: superseding the evidence withdraws it from the active record, leaving
    // the exclusion resting on nothing a reader can check.
    const { log, src } = withRetrieval();
    assert.throws(
      () => appendAttempt(log, exclusion({ evidenceFromAttemptId: src, supersedesAttemptId: src })),
      /cites .* as its evidence and also supersedes it/
    );
  });

  test('a citation must match on agency, category and canonical URL', () => {
    for (const [field, value, pattern] of [
      ['agency', 'Ministry of Health', /is .*, not Ministry of Health/],
      ['category', 'service-application', /category/],
      ['url', 'https://w.govt.nz/elsewhere', /not https/],
    ]) {
      const { log, src } = withRetrieval();
      assert.throws(
        () => appendAttempt(log, exclusion({ evidenceFromAttemptId: src, [field]: value })),
        pattern, `${field} mismatch was accepted`
      );
    }
  });

  test('a citation must match the bytes it claims, by digest and by length', () => {
    for (const [field, value] of [['htmlSha256', 'f'.repeat(64)], ['htmlBytes', 12345]]) {
      const { log, src } = withRetrieval();
      assert.throws(
        () => appendAttempt(log, exclusion({ evidenceFromAttemptId: src, [field]: value })),
        /but cites .*, whose (digest|byte length) is/,
        `${field} mismatch was accepted`
      );
    }
  });

  test('a citation may only name a retrieval', () => {
    const { log } = withRetrieval();
    appendAttempt(log, exclusion({ evidenceFromAttemptId: log.attempts.at(-1).id }));
    const decision = log.attempts.at(-1).id;
    assert.throws(
      () => appendAttempt(log, exclusion({ id: 'c-8888', evidenceFromAttemptId: decision })),
      /is a excluded attempt; evidenceFromAttemptId cites an assessment-only retrieval/
    );
  });
});

describe('the shared notion is one function, not four opinions', () => {
  test('a retrieval is not terminal and every real outcome is', () => {
    assert.equal(isEvidenceOnly({ status: 'retrieved' }), true);
    assert.equal(isTerminalDecision({ status: 'retrieved' }), false);
    for (const status of TERMINAL_STATUSES) {
      assert.equal(isTerminalDecision({ status }), true, `${status} should settle a candidate`);
    }
    assert.equal(isTerminalDecision({ status: 'discovery' }), false);
  });

  test('a superseded decision does not settle a candidate', () => {
    const decisions = terminalDecisionsFor(
      [{ agency: AGENCY, status: 'excluded', url: URL_, id: 'c-1' }],
      { agency: AGENCY, url: URL_, supersededIds: new Set(['c-1']) }
    );
    assert.deepEqual(decisions, []);
  });
});

describe('a citation follows the supersession chain', () => {
  test('a retrieval superseded by a live record cannot be cited', () => {
    const log = roundWith([retrieval()]);
    const src = log.attempts.at(-1).id;
    // A decision that (wrongly) supersedes the retrieval, as `c-0504` did.
    appendAttempt(log, exclusion({ supersedesAttemptId: src, approval: APPROVAL.APPROVED }));
    assert.throws(
      () => appendAttempt(log, exclusion({ id: 'c-7777', evidenceFromAttemptId: src })),
      /has been superseded by .* and is no longer active evidence/
    );
  });

  test('but once that record is itself superseded, the evidence is citable again', () => {
    // The `c-0504` repair: reject it, supersede it, and cite the retrieval it should have cited.
    const log = roundWith([retrieval()]);
    const src = log.attempts.at(-1).id;
    appendAttempt(log, exclusion({ supersedesAttemptId: src }));
    const wrong = log.attempts.at(-1);
    wrong.approval = APPROVAL.REJECTED;
    appendAttempt(log, exclusion({
      supersedesAttemptId: wrong.id, evidenceFromAttemptId: src, approval: APPROVAL.APPROVED,
    }));
    const corrected = log.attempts.at(-1);
    assert.equal(corrected.evidenceFromAttemptId, src);
    assert.equal(corrected.supersedesAttemptId, wrong.id);
    assert.deepEqual(terminalDecisionProblems(log), []);
  });
});
