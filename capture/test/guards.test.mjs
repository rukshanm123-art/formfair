/**
 * Guards on the selection rule, each written from an attack that worked.
 *
 * The rule was documented and partly implemented: canonicalisation and ordering existed
 * but nothing called them, a candidate with no category escaped its category's limit, any
 * agency could be worked on in any order, and two pages from one agency could reach the
 * corpus. These tests are the attacks, kept so the gap cannot reopen.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyLog, appendAttempt, ELIGIBILITY_CRITERIA, recordCandidates, lockCandidateSet,
  categorySettled, deriveDraft, APPROVAL, approveCandidateSet,
} from '../run.mjs';
import { prepareSet, addDiscovery } from './helpers.mjs';
import {
  parseDrawOrder, nextWork, CATEGORY_ORDER, MAX_CANDIDATES_PER_CATEGORY, MAX_QUALIFIED_AGENCIES,
} from '../selection.mjs';

const el = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));
const drawOrder = parseDrawOrder(
  readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
);

/** A log with one category's candidates already locked, ready to be assessed. */
function preparedLog(agency, category, n = MAX_CANDIDATES_PER_CATEGORY) {
  const log = emptyLog();
  const urls = Array.from({ length: n }, (_, i) => `https://w.govt.nz/${category}/${i}`);
  prepareSet(log, agency, category, urls);
  return { log, urls: log.candidateSets[`${agency}\u0000${category}`].locked };
}

const excluded = (agency, category, url) => ({
  examinedAt: '2026-09-24T00:00:00Z', agency, website: 'https://w.govt.nz/', url,
  status: 'excluded', category, exclusionReason: 'no personal-name field', eligibility: el(),
});

describe('the category-omission attack', () => {
  test('five candidates with a category, then five without, is refused', () => {
    // The attack exactly as found: the limit counts by category value, so a candidate with
    // none was counted against no category and ten candidates came from one real category.
    const { log, urls } = preparedLog('TPK', 'account-registration');
    for (const url of urls) appendAttempt(log, excluded('TPK', 'account-registration', url));
    assert.equal(log.attempts.filter((a) => a.status !== 'discovery').length, MAX_CANDIDATES_PER_CATEGORY);

    const withoutCategory = { ...excluded('TPK', 'account-registration', 'https://w.govt.nz/extra') };
    delete withoutCategory.category;
    assert.throws(() => appendAttempt(log, withoutCategory), /every candidate needs a category/);
    assert.equal(log.attempts.filter((a) => a.status !== 'discovery').length, MAX_CANDIDATES_PER_CATEGORY, 'nothing slipped through');
  });

  test('an unknown category is refused too', () => {
    const { log, urls } = preparedLog('TPK', 'account-registration');
    assert.throws(
      () => appendAttempt(log, { ...excluded('TPK', 'not-a-category', urls[0]) }),
      /every candidate needs a category/
    );
  });
});

describe('the locked candidate set', () => {
  test('nothing may be assessed before the set is locked', () => {
    const log = emptyLog();
    addDiscovery(log, { agency: 'TPK', category: 'account-registration' });
    recordCandidates(log, { agency: 'TPK', category: 'account-registration', urls: ['https://w.govt.nz/a'] });
    assert.throws(
      () => appendAttempt(log, excluded('TPK', 'account-registration', 'https://w.govt.nz/a')),
      /no locked candidate set/
    );
  });

  test('a URL outside the locked set is refused', () => {
    const { log } = preparedLog('TPK', 'account-registration');
    assert.throws(
      () => appendAttempt(log, excluded('TPK', 'account-registration', 'https://w.govt.nz/elsewhere')),
      /not in the locked candidate set/
    );
  });

  test('the set cannot grow once locked', () => {
    const { log } = preparedLog('TPK', 'account-registration');
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: 'account-registration', urls: ['https://w.govt.nz/late'] }),
      /locked at .* and cannot grow/
    );
  });

  test('locking canonicalises, deduplicates, sorts and keeps the first five', () => {
    const log = emptyLog();
    addDiscovery(log, { agency: 'TPK', category: 'account-registration' });
    recordCandidates(log, {
      agency: 'TPK', category: 'account-registration',
      urls: ['https://w.govt.nz/e', 'https://W.GOVT.NZ/e#frag', 'https://w.govt.nz/a',
             'https://w.govt.nz/d', 'https://w.govt.nz/c', 'https://w.govt.nz/b', 'https://w.govt.nz/f'],
    });
    const set = lockCandidateSet(log, { agency: 'TPK', category: 'account-registration' });
    assert.equal(set.ordered.length, 6, 'the duplicate collapsed');
    assert.deepEqual(set.locked, [
      'https://w.govt.nz/a', 'https://w.govt.nz/b', 'https://w.govt.nz/c',
      'https://w.govt.nz/d', 'https://w.govt.nz/e',
    ]);
    assert.deepEqual(set.droppedBeyondBound, ['https://w.govt.nz/f']);
  });

  test('a category is settled only when every locked candidate has an outcome', () => {
    const { log, urls } = preparedLog('TPK', 'account-registration');
    appendAttempt(log, excluded('TPK', 'account-registration', urls[0]));
    assert.equal(categorySettled(log, { agency: 'TPK', category: 'account-registration' }).settled, false);
    for (const url of urls.slice(1)) appendAttempt(log, excluded('TPK', 'account-registration', url));
    assert.equal(categorySettled(log, { agency: 'TPK', category: 'account-registration' }).settled, true);
  });
});

describe('agency and category order', () => {
  test('the first agency is the first in the frozen draw order', () => {
    assert.equal(drawOrder.length, 45);
    assert.equal(nextWork(emptyLog(), drawOrder).agency, drawOrder[0].agency);
    assert.equal(nextWork(emptyLog(), drawOrder).category, CATEGORY_ORDER[0]);
  });

  test('a lower-priority category is not offered until the higher one is settled', () => {
    const agency = drawOrder[0].agency;
    const { log, urls } = preparedLog(agency, 'account-registration');
    appendAttempt(log, excluded(agency, 'account-registration', urls[0]));
    log.attempts.at(-1).approval = APPROVAL.APPROVED;
    assert.equal(nextWork(log, drawOrder).category, 'account-registration', 'still the first category');
    for (const url of urls.slice(1)) {
      appendAttempt(log, excluded(agency, 'account-registration', url));
      log.attempts.at(-1).approval = APPROVAL.APPROVED;
    }
    assert.equal(nextWork(log, drawOrder).category, 'service-application', 'now the second');
  });

  test('the scan stops once forty agencies have qualified', () => {
    const log = emptyLog();
    for (let i = 0; i < MAX_QUALIFIED_AGENCIES; i++) {
      log.attempts.push({
        agency: drawOrder[i].agency, status: 'captured', approval: APPROVAL.APPROVED,
        category: 'account-registration', url: `https://w/${i}`,
      });
    }
    const work = nextWork(log, drawOrder);
    assert.equal(work.done, true);
    assert.match(work.reason, /40 agencies have qualified/);
  });
});

describe('what may enter the corpus', () => {
  const capture = (agency, category, n) => ({
    agency, category, status: 'captured', approval: APPROVAL.APPROVED,
    url: `https://w.govt.nz/${agency}/${n}`, finalUrl: `https://w.govt.nz/${agency}/${n}`,
    pageId: `${n}`, file: `${n}.html`, htmlSha256: 'x', inclusionEvidence: 'has a name field',
    capturedAt: '2026-09-24T00:00:00Z', browser: 'Chromium 1', automationTool: 'playwright 1',
    viewport: { width: 1280, height: 800 }, locale: 'en-NZ', redirects: [],
  });
  const opts = { frameSha256: 'f', drawOrderSha256: 'd' };

  test('two approved pages from one agency are refused', () => {
    const log = emptyLog();
    log.attempts.push(capture('TPK', 'account-registration', 1), capture('TPK', 'enquiry-or-contact', 2));
    assert.throws(() => deriveDraft(log, opts), /more than one approved page for: TPK/);
  });

  test('more than forty pages are refused', () => {
    const log = emptyLog();
    for (let i = 0; i <= MAX_QUALIFIED_AGENCIES; i++) log.attempts.push(capture(`Agency ${i}`, 'account-registration', i));
    assert.throws(() => deriveDraft(log, opts), /exceeds the target of 40/);
  });

  test('an agency outside the frozen frame is refused', () => {
    const log = emptyLog();
    log.attempts.push(capture('Not In The Frame', 'account-registration', 1));
    assert.throws(
      () => deriveDraft(log, { ...opts, frameAgencies: drawOrder.map((r) => r.agency) }),
      /outside the frozen frame/
    );
  });

  test('a lower-priority category cannot be selected when a higher one also qualified', () => {
    const log = emptyLog();
    log.attempts.push(capture('TPK', 'enquiry-or-contact', 2));
    // The higher-priority capture is rejected so that it does not trip the one-page-per-agency
    // guard first, and is then superseded, because selection-v1.0.7 refuses a draft while any
    // rejection is left standing. What is under test here is the category ordering, reached
    // only once every other unresolved state has been cleared.
    log.attempts.push({
      ...capture('TPK', 'account-registration', 1), approval: APPROVAL.REJECTED, id: 'c-0001',
    });
    log.attempts.push({
      agency: 'TPK', category: 'account-registration', status: 'excluded', id: 'c-0002',
      approval: APPROVAL.APPROVED, url: 'https://w.govt.nz/TPK/1',
      exclusionReason: 'superseding correction', supersedesAttemptId: 'c-0001',
    });
    assert.throws(() => deriveDraft(log, opts), /while account-registration also yielded one/);
  });
});

describe('a third-party form shared by two agencies', () => {
  const shared = 'https://shared.example.govt.nz/contact';

  test('it may be recorded for a second agency', () => {
    // Refusing would hide that the later agency genuinely links it.
    const log = emptyLog();
    for (const agency of ['TPK', 'Ministry of Health']) {
      prepareSet(log, agency, 'enquiry-or-contact', [shared]);
      appendAttempt(log, excluded(agency, 'enquiry-or-contact', shared));
    }
    assert.equal(log.attempts.filter((a) => a.url === shared).length, 2);
  });

  test('the same canonical page cannot be captured twice', () => {
    const log = emptyLog();
    const capturedAttempt = (agency) => ({
      examinedAt: 't', agency, website: 'https://w/', url: shared, finalUrl: shared,
      status: 'captured', category: 'enquiry-or-contact', pageId: `${agency.toLowerCase().replace(/\W+/g, '-')}-001`,
      file: 'x.html', htmlSha256: 'h', inclusionEvidence: 'has a name field',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, true])),
    });
    for (const agency of ['TPK', 'Ministry of Health']) {
      prepareSet(log, agency, 'enquiry-or-contact', [shared]);
    }
    appendAttempt(log, capturedAttempt('TPK'));
    assert.throws(
      () => appendAttempt(log, capturedAttempt('Ministry of Health')),
      /duplicate shared form/
    );
  });
});

/**
 * Unfinished work cannot be stepped over, and cannot be frozen into a corpus.
 *
 * selection-v1.0.7, from two failures reproduced in the real run. A correction was in flight -
 * Te Puni Kokiri's service-application set had been superseded, redone and locked, awaiting
 * approval - and:
 *
 *   - `next` stepped over it entirely, because that agency already had an approved capture, so
 *     the scan reported the SECOND agency as the work to do and the correction was invisible;
 *   - `deriveDraft` built a one-page corpus draft while that set and one other were pending,
 *     although the protocol states the draft is withheld while anything is unresolved.
 *
 * The cause in both cases is the same: the guards asked about ATTEMPTS and forgot that the
 * candidate SET is where the selection judgement lives.
 */
describe('unfinished work blocks both the next step and the corpus', () => {
  const CAT = 'service-application';
  const agency = drawOrder[0].agency;
  const second = drawOrder[1].agency;
  const opts = { frameSha256: 'f', drawOrderSha256: 'd' };

  const capturedFor = (ag, category, n) => ({
    agency: ag, category, status: 'captured', approval: APPROVAL.APPROVED,
    url: `https://w.govt.nz/${n}`, finalUrl: `https://w.govt.nz/${n}`,
    pageId: `page-${n}`, file: `${n}.html`, htmlSha256: 'x', inclusionEvidence: 'has a name field',
    capturedAt: '2026-09-24T00:00:00Z', browser: 'Chromium 1', automationTool: 'playwright 1',
    viewport: { width: 1280, height: 800 }, locale: 'en-NZ', redirects: [],
  });

  /** A qualified agency that also has a locked-but-unapproved set: the real state. */
  function qualifiedWithPendingCorrection() {
    const log = emptyLog();
    log.attempts.push(capturedFor(agency, 'enquiry-or-contact', 1));
    log.candidateSets[`${agency}\u0000${CAT}`] = {
      agency, category: CAT, version: 2,
      discovered: [], locked: [], ordered: [], droppedBeyondBound: [],
      lockedAt: '2026-09-25T03:29:01Z', approval: APPROVAL.PENDING,
      candidateDeclaration: 'none', declaredAt: '2026-09-25T03:29:00Z',
      discoveryRecordIds: ['d-0001'], discoveryMethods: ['navigation'],
    };
    return log;
  }

  test('THE BYPASS: next does not step over a qualified agency that has a pending set', () => {
    const log = qualifiedWithPendingCorrection();
    const work = nextWork(log, drawOrder);
    assert.equal(work.agency, agency, `expected the correction, got ${work.agency}`);
    assert.equal(work.category, CAT);
    assert.ok(work.needsSetApproval);
    assert.notEqual(work.agency, second, 'the scan must not advance to the next agency');
  });

  test('next does step over a qualified agency once nothing is outstanding', () => {
    // The guard must not strand a finished agency: qualification is exactly what stops its
    // remaining categories being searched, so an unsearched category is not unfinished work.
    const log = qualifiedWithPendingCorrection();
    log.candidateSets[`${agency}\u0000${CAT}`].approval = APPROVAL.APPROVED;
    const work = nextWork(log, drawOrder);
    assert.equal(work.agency, second);
  });

  test('next surfaces a qualified agency whose approved set has an unassessed candidate', () => {
    const log = qualifiedWithPendingCorrection();
    const set = log.candidateSets[`${agency}\u0000${CAT}`];
    set.approval = APPROVAL.APPROVED;
    set.candidateDeclaration = null;
    set.locked = ['https://w.govt.nz/unassessed.docx'];
    const work = nextWork(log, drawOrder);
    assert.equal(work.agency, agency);
    assert.deepEqual(work.pending, ['https://w.govt.nz/unassessed.docx']);
  });

  test('THE BYPASS: deriveDraft refuses while a candidate set is pending', () => {
    const log = qualifiedWithPendingCorrection();
    assert.throws(
      () => deriveDraft(log, opts),
      /1 candidate set\(s\) are not approved/
    );
  });

  test('deriveDraft names the unresolved sets and their state', () => {
    const log = qualifiedWithPendingCorrection();
    log.candidateSets[`${second}\u0000${CAT}`] = {
      agency: second, category: CAT, version: 1,
      discovered: [], locked: [], ordered: [], droppedBeyondBound: [],
      lockedAt: '2026-09-25T03:26:42Z', approval: APPROVAL.REJECTED,
      candidateDeclaration: 'none', declaredAt: '2026-09-25T03:26:41Z',
      discoveryRecordIds: ['d-0002'], discoveryMethods: ['navigation'],
    };
    assert.throws(() => deriveDraft(log, opts), /2 candidate set\(s\) are not approved/);
    assert.throws(() => deriveDraft(log, opts), new RegExp(`${CAT} v2 \\(pending\\)`));
    assert.throws(() => deriveDraft(log, opts), /\(rejected\)/);
  });

  test('deriveDraft refuses while a rejected set is unresolved', () => {
    const log = qualifiedWithPendingCorrection();
    log.candidateSets[`${agency}\u0000${CAT}`].approval = APPROVAL.REJECTED;
    assert.throws(() => deriveDraft(log, opts), /not approved/);
  });

  test('deriveDraft refuses an approved set with a locked candidate that has no outcome', () => {
    const log = qualifiedWithPendingCorrection();
    const set = log.candidateSets[`${agency}\u0000${CAT}`];
    set.approval = APPROVAL.APPROVED;
    set.candidateDeclaration = null;
    set.locked = ['https://w.govt.nz/form.docx'];
    assert.throws(
      () => deriveDraft(log, opts),
      /has 1 locked candidate\(s\) with no outcome/
    );
  });

  test('deriveDraft refuses a rejected attempt that nothing supersedes', () => {
    // Only PENDING was ever checked, so a rejection left to stand quietly dropped its
    // candidate out of the corpus with no correction recorded anywhere.
    const log = qualifiedWithPendingCorrection();
    log.candidateSets[`${agency}\u0000${CAT}`].approval = APPROVAL.APPROVED;
    log.attempts.push({
      agency, category: CAT, status: 'excluded', id: 'c-0099', approval: APPROVAL.REJECTED,
      url: 'https://w.govt.nz/wrongly-excluded', exclusionReason: 'wrong reason given',
    });
    assert.throws(
      () => deriveDraft(log, opts),
      /1 rejected attempt\(s\) have not been superseded/
    );
  });

  test('deriveDraft builds once every set is approved and every candidate assessed', () => {
    const log = qualifiedWithPendingCorrection();
    log.candidateSets[`${agency}\u0000${CAT}`].approval = APPROVAL.APPROVED;
    // Real digests here: the placeholder hashes in `opts` are enough for the refusals above,
    // which never reach the digest check, but a draft that actually builds must pass it.
    const draft = deriveDraft(log, { frameSha256: 'a'.repeat(64), drawOrderSha256: 'b'.repeat(64) });
    assert.equal(draft.pages.length, 1);
    assert.equal(draft.pages[0].pageId, 'page-1');
  });
});
