/**
 * Amendment 40: the effort bound counts candidates, and a retrieval may conclude nothing.
 *
 * Two defects, one incident. Assessing NZDF's five locked candidates became impossible after two
 * and a half of them: the bound counted every non-discovery attempt, and a candidate that was
 * retrieved, found ineligible, rejected and superseded spent three slots by itself. `c-0498` could
 * not even record the exclusion that resolved it.
 *
 * The reason each candidate cost three records is the second defect: the capture path asserts
 * criteria three and four as true on its captured branch, so obtaining a page in order to decide
 * whether it qualified meant asserting that it did. `c-0494` recorded a page with zero form
 * elements as satisfying all five criteria, and had to be rejected and superseded.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { remainingBudget, MAX_CANDIDATES_PER_CATEGORY } from '../selection.mjs';
import { emptyLog, appendAttempt, ELIGIBILITY_CRITERIA, checkCaptureFiles } from '../run.mjs';
import { prepareSet } from './helpers.mjs';

const AGENCY = 'New Zealand Defence Force';
const CAT = 'account-registration';
const url = (n) => `https://w.govt.nz/candidate-${n}`;

const attempt = (over = {}) => ({
  agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', status: 'excluded', url: url(1),
  exclusionReason: 'no name field',
  eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])), ...over,
});

describe('the effort bound counts distinct candidate URLs', () => {
  test('one candidate examined three times spends one slot', () => {
    // The exact NZDF shape: retrieved, rejected, superseded by an exclusion.
    const attempts = [
      attempt({ status: 'retrieved', url: url(1) }),
      attempt({ url: url(1), approval: 'rejected' }),
      attempt({ url: url(1) }),
    ];
    const budget = remainingBudget(attempts, { agency: AGENCY, category: CAT, url: url(2) });
    assert.equal(budget.distinctInCategory, 1);
    assert.equal(budget.categoryRemaining, MAX_CANDIDATES_PER_CATEGORY - 1);
    assert.equal(budget.exhausted, false);
  });

  test('five distinct candidates fill the bound', () => {
    const attempts = [1, 2, 3, 4, 5].map((n) => attempt({ url: url(n) }));
    assert.equal(remainingBudget(attempts, { agency: AGENCY, category: CAT }).distinctInCategory, 5);
  });

  test('a SIXTH distinct URL is still refused', () => {
    const attempts = [1, 2, 3, 4, 5].map((n) => attempt({ url: url(n) }));
    assert.equal(
      remainingBudget(attempts, { agency: AGENCY, category: CAT, url: url(6) }).exhausted, true,
      'the bound must still stop a sixth candidate'
    );
  });

  test('but a further record about one of the five is always allowed', () => {
    // Otherwise a candidate could be retrieved and never resolved, which is the state `c-0498`
    // was stuck in.
    const attempts = [1, 2, 3, 4, 5].map((n) => attempt({ url: url(n) }));
    assert.equal(
      remainingBudget(attempts, { agency: AGENCY, category: CAT, url: url(3) }).exhausted, false,
      'a correction to an already-counted candidate must not be refused'
    );
  });

  test('the bound is enforced against the log, not remembered', () => {
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, [1, 2, 3, 4, 5].map(url));
    for (const n of [1, 2, 3, 4, 5]) {
      appendAttempt(log, attempt({ status: 'retrieved', url: url(n), approval: 'not-applicable',
        pageId: `w-govt-nz-candidate-${n}`, file: `w-govt-nz-candidate-${n}.html`,
        htmlSha256: 'a'.repeat(64), exclusionReason: undefined }));
      // and again, as resolving that retrieval does
      appendAttempt(log, attempt({ url: url(n), supersedesAttemptId: log.attempts.at(-1).id }));
    }
    assert.equal(log.attempts.filter((a) => a.status === 'excluded').length, 5);
    // A sixth URL never reaches the budget check through `appendAttempt`: set membership refuses
    // it first, and the lock caps the set at five. Both defences are real, and the pure-function
    // test above covers the bound itself.
    assert.throws(
      () => appendAttempt(log, attempt({ url: 'https://w.govt.nz/sixth' })),
      /is not in the locked candidate set/
    );
  });
});

describe('an assessment-only retrieval concludes nothing', () => {
  const retrieved = (over = {}) => ({
    agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', status: 'retrieved', url: url(1),
    approval: 'not-applicable',
    pageId: 'w-govt-nz-candidate-1', file: 'w-govt-nz-candidate-1.html', htmlSha256: 'a'.repeat(64),
    eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    ...over,
  });

  const withSet = () => {
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, [url(1)]);
    return log;
  };

  test('it records bytes, digest and page id without an eligibility claim', () => {
    const log = withSet();
    appendAttempt(log, retrieved());
    const a = log.attempts.at(-1);
    assert.equal(a.status, 'retrieved');
    for (const c of ELIGIBILITY_CRITERIA) assert.equal(a.eligibility[c], null);
  });

  test('it may not assert any criterion', () => {
    assert.throws(
      () => appendAttempt(withSet(), retrieved({
        eligibility: { ...Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
          asksForTheNameOfANaturalPerson: true },
      })),
      /must leave every eligibility criterion null/
    );
  });

  test('it may not carry inclusion evidence', () => {
    assert.throws(
      () => appendAttempt(withSet(), retrieved({ inclusionEvidence: 'it has a name field' })),
      /must not carry inclusionEvidence/
    );
  });

  test('it still needs its bytes and their digest', () => {
    for (const missing of ['file', 'htmlSha256', 'pageId']) {
      assert.throws(
        () => appendAttempt(withSet(), retrieved({ [missing]: undefined })),
        new RegExp(`a retrieved attempt needs (a )?${missing}`),
        `${missing} was not required`
      );
    }
  });

  test('it needs no exclusionReason, unlike every other non-capture', () => {
    const log = withSet();
    appendAttempt(log, retrieved());
    assert.equal(log.attempts.at(-1).exclusionReason, undefined);
    assert.throws(
      () => appendAttempt(log, { agency: AGENCY, category: CAT, website: 'https://w.govt.nz/',
        status: 'failed', url: url(1),
        eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])) }),
      /needs an exclusionReason/
    );
  });

  test('its file is owned, so it is not an orphan, and promotion may share it', () => {
    const log = withSet();
    appendAttempt(log, retrieved());
    // A promoted capture names the same file; that is one candidate, not two.
    appendAttempt(log, {
      ...retrieved(), status: 'captured', promotedFrom: log.attempts.at(-1).id,
      website: 'https://w.govt.nz/', approval: 'pending',
      inclusionEvidence: 'a name field is visible without submitting',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, true])),
    });
    const problems = checkCaptureFiles(log, '/nonexistent-dir-so-only-the-log-is-checked');
    assert.deepEqual(problems, []);
  });
});

describe('a promotion makes no request, so pacing does not apply to it', () => {
  /**
   * Amendment 43. `promote` re-hashes bytes already held; it generates no traffic. It also inherits
   * the retrieval's `navigatedAt`, which is when those bytes were fetched, so once any later page
   * is retrieved the interval to "the previous navigation" is NEGATIVE.
   *
   * That is not hypothetical: selecting NZDF's enquiry-or-contact page meant promoting the FIRST of
   * five retrievals, and the promotion was refused with "only -52000 ms since the previous
   * navigation". Held to the rule, the frozen tie-break becomes unexecutable whenever the selected
   * page is not the last one fetched - which is four times in five.
   */
  const at = (s) => new Date(Date.UTC(2026, 8, 30, 2, 0, s)).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const round = () => {
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, [url(1), url(2), url(3)]);
    // First candidate retrieved, then a second one a minute later.
    appendAttempt(log, retrievedAt(url(1), 'w-govt-nz-candidate-1', at(0)));
    appendAttempt(log, retrievedAt(url(2), 'w-govt-nz-candidate-2', at(52)));
    return log;
  };
  const retrievedAt = (u, pageId, when) => ({
    agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url: u,
    status: 'retrieved', approval: 'not-applicable', navigatedAt: when,
    pageId, file: `${pageId}.html`, htmlSha256: 'a'.repeat(64), htmlBytes: 1024,
    eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
  });

  test('promoting the EARLIER retrieval is allowed despite a negative interval', () => {
    const log = round();
    const first = log.attempts.find((a) => a.url === url(1) && a.status === 'retrieved');
    appendAttempt(log, {
      ...first, id: undefined, status: 'captured', promotedFrom: first.id,
      inclusionEvidence: 'all five criteria are satisfied; selected by the frozen tie-break',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, true])),
      approval: 'pending',
    });
    const promoted = log.attempts.at(-1);
    assert.equal(promoted.status, 'captured');
    assert.equal(promoted.promotedFrom, first.id);
    // It keeps the retrieval's navigation time: that is when the bytes were fetched.
    assert.equal(promoted.navigatedAt, at(0));
  });

  test('a real navigation is still paced', () => {
    const log = round();
    // A third, unretrieved candidate, fetched two seconds after the second: a genuine navigation
    // inside the five-second minimum, which must still be refused.
    assert.throws(
      () => appendAttempt(log, retrievedAt(url(3), 'w-govt-nz-candidate-3', at(54))),
      /since the previous navigation/
    );
  });
});
