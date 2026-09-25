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
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyLog, appendAttempt, ELIGIBILITY_CRITERIA, recordCandidates, lockCandidateSet,
  categorySettled, deriveDraft, APPROVAL, approveCandidateSet,
  exhaustAgency, EXHAUSTION_REASON, publishProvenance,
  unresolvedDiscoveryRounds, issueDiscoveryPermit, isDiscoverySuperseded, supersedeCandidateSet,
  reopenCandidateSet, recordRobotsCheck, findRobotsCheck, robotsCheckIsFresh,
  consumeDiscoveryPermit, closeDiscoveryPermit, permitAudit, openDiscoveryPermits,
  checkPermitLedger,
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

/**
 * Recording an agency as exhausted.
 *
 * selection-v1.0.8. `nextWork` could already SAY an agency was exhausted, but nothing could
 * record it: no command wrote to `log.exhausted`, so the scan could not advance past the first
 * agency that failed to qualify without hand-editing the log, which the protocol forbids.
 *
 * An exhaustion is a claim about the sample rather than bookkeeping. It is what makes the
 * prevalence denominator "agencies searched" instead of "agencies that had a form", so it
 * carries a timestamp, a frozen reason and the category-set versions it rests on, and it is
 * sealed with the corpus.
 */
describe('an agency is recorded as exhausted explicitly', () => {
  const agency = drawOrder[0].agency;
  const second = drawOrder[1].agency;

  /** Every category settled with a declared nil result: the state that permits exhaustion. */
  function fullySearched(log, ag) {
    for (const category of CATEGORY_ORDER) {
      addDiscovery(log, { agency: ag, category, outcome: 'no-candidates' });
      recordCandidates(log, { agency: ag, category, urls: [], declaration: 'none' });
      lockCandidateSet(log, { agency: ag, category });
      approveCandidateSet(log, { agency: ag, category, approved: true });
    }
    return log;
  }

  test('the valid transition: a fully searched agency is exhausted, and next advances', () => {
    const log = fullySearched(emptyLog(), agency);
    assert.equal(nextWork(log, drawOrder).exhaustedAgency, true);

    const record = exhaustAgency(log, drawOrder);
    assert.equal(record.agency, agency);
    assert.match(record.exhaustedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(record.reason, EXHAUSTION_REASON);
    assert.deepEqual(Object.keys(record.categorySetVersions).sort(), [...CATEGORY_ORDER].sort());
    assert.equal(record.categorySetVersions['account-registration'], 1);

    // Only now does the scan move on.
    const next = nextWork(log, drawOrder);
    assert.equal(next.agency, second);
    assert.notEqual(next.agency, agency);
  });

  test('premature exhaustion is refused, and says what the next work actually is', () => {
    const log = emptyLog();
    addDiscovery(log, { agency, category: 'account-registration', outcome: 'no-candidates' });
    assert.throws(
      () => exhaustAgency(log, drawOrder),
      /no agency is exhausted at this point in the frozen order. The next work is:/
    );
    assert.deepEqual(log.exhausted, [], 'nothing may be recorded on the way out');
  });

  test('an arbitrary agency cannot be named, so the draw order cannot be skipped', () => {
    const log = fullySearched(emptyLog(), agency);
    assert.throws(
      () => exhaustAgency(log, drawOrder, { agency: second }),
      new RegExp(`the next agency in the frozen order is .*, not ${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
    assert.deepEqual(log.exhausted, []);
  });

  test('an unassessed locked candidate blocks exhaustion', () => {
    const log = emptyLog();
    for (const category of CATEGORY_ORDER) {
      if (category === 'enquiry-or-contact') {
        // A real candidate with no outcome yet.
        addDiscovery(log, { agency, category, outcome: 'candidates-found' });
        recordCandidates(log, { agency, category, urls: ['https://w.govt.nz/contact'] });
        lockCandidateSet(log, { agency, category });
        approveCandidateSet(log, { agency, category, approved: true });
        continue;
      }
      addDiscovery(log, { agency, category, outcome: 'no-candidates' });
      recordCandidates(log, { agency, category, urls: [], declaration: 'none' });
      lockCandidateSet(log, { agency, category });
      approveCandidateSet(log, { agency, category, approved: true });
    }
    assert.throws(() => exhaustAgency(log, drawOrder), /no agency is exhausted at this point/);
    assert.deepEqual(log.exhausted, []);
  });

  test('a category still pending approval blocks exhaustion', () => {
    const log = fullySearched(emptyLog(), agency);
    log.candidateSets[`${agency}\u0000subscription-or-newsletter`].approval = APPROVAL.PENDING;
    assert.throws(() => exhaustAgency(log, drawOrder), /no agency is exhausted at this point/);
  });

  test('exhaustion is recorded once; a duplicate is refused', () => {
    const log = fullySearched(emptyLog(), agency);
    exhaustAgency(log, drawOrder);
    assert.equal(log.exhausted.length, 1);
    // By name, which is how an operator would repeat it.
    assert.throws(
      () => exhaustAgency(log, drawOrder, { agency }),
      /is already recorded as exhausted/
    );
    assert.equal(log.exhausted.length, 1);
  });

  test('an agency with an approved captured page is not exhausted', () => {
    const log = fullySearched(emptyLog(), agency);
    log.attempts.push({
      agency, category: 'enquiry-or-contact', status: 'captured', approval: APPROVAL.APPROVED,
      url: 'https://w.govt.nz/contact', finalUrl: 'https://w.govt.nz/contact',
      pageId: 'qualified-page', file: 'q.html', htmlSha256: 'x',
      inclusionEvidence: 'has a name field', capturedAt: '2026-09-25T00:00:00Z',
    });
    assert.throws(
      () => exhaustAgency(log, drawOrder, { agency }),
      /has an approved captured page \(qualified-page\); an agency that contributed a page/
    );
    assert.deepEqual(log.exhausted, []);
  });

  test('the exhaustion is sealed with the corpus and published in provenance', () => {
    const log = fullySearched(emptyLog(), agency);
    const record = exhaustAgency(log, drawOrder);

    const draft = deriveDraft(log, { frameSha256: 'a'.repeat(64), drawOrderSha256: 'b'.repeat(64) });
    assert.equal(draft.exhaustedAgencies.length, 1);
    assert.equal(draft.exhaustedAgencies[0].agency, agency);
    assert.equal(draft.exhaustedAgencies[0].reason, EXHAUSTION_REASON);
    assert.equal(draft.exhaustedAgencies[0].exhaustedAt, record.exhaustedAt);

    // Sealed: the hash the seal takes of the draft must change if the exhaustion changes.
    const digest = (d) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
    const tampered = structuredClone(draft);
    tampered.exhaustedAgencies = [];
    assert.notEqual(digest(draft), digest(tampered));

    const dir = mkdtempSync(join(tmpdir(), 'formfair-exhaust-'));
    try {
      const { provenancePath } = publishProvenance(log, { to: dir });
      const published = JSON.parse(readFileSync(provenancePath, 'utf8'));
      assert.equal(published.exhaustedAgencies.length, 1);
      assert.equal(published.exhaustedAgencies[0].agency, agency);
      assert.equal(published.exhaustedAgencies[0].reason, EXHAUSTION_REASON);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a legacy bare-string exhaustion still counts, and still seals', () => {
    // A log written before the record existed must not silently stop counting as exhausted,
    // which would re-offer a finished agency as work.
    const log = fullySearched(emptyLog(), agency);
    log.exhausted = [agency];
    assert.equal(nextWork(log, drawOrder).agency, second);
    const draft = deriveDraft(log, { frameSha256: 'a'.repeat(64), drawOrderSha256: 'b'.repeat(64) });
    assert.equal(draft.exhaustedAgencies[0].agency, agency);
    assert.equal(draft.exhaustedAgencies[0].exhaustedAt, null);
  });
});

/**
 * Unfinished discovery cannot disappear from the corpus gate.
 *
 * selection-v1.0.12, reproduced from the live ledger. Twenty-six discovery records existed for a
 * Ministry of Health round with no candidate-set object at all, because a set was created only
 * when candidates were first recorded. Every gate keyed off candidate sets, so:
 *
 *     status -> nothing outstanding; the corpus draft is not withheld
 *     draft  -> BUILT: 1 page, 1 exhaustion, 26 Ministry records ignored
 *
 * An entire agency's round sat in the log, unlocked and unreviewed, and the corpus gate could not
 * see it. Discovery that never reached the step which creates the set was invisible.
 */
describe('discovery without a resolved set blocks the corpus', () => {
  const CAT = 'account-registration';
  const agency = drawOrder[0].agency;
  const opts = { frameSha256: 'a'.repeat(64), drawOrderSha256: 'b'.repeat(64) };

  const capturedFor = (ag) => ({
    agency: ag, category: 'enquiry-or-contact', status: 'captured', approval: APPROVAL.APPROVED,
    url: 'https://w.govt.nz/1', finalUrl: 'https://w.govt.nz/1',
    pageId: 'page-1', file: '1.html', htmlSha256: 'x', inclusionEvidence: 'has a name field',
    capturedAt: '2026-09-24T00:00:00Z', browser: 'Chromium 1', automationTool: 'playwright 1',
    viewport: { width: 1280, height: 800 }, locale: 'en-NZ', redirects: [],
  });

  test('THE BYPASS: discovery records with no candidate set are detected', () => {
    const log = emptyLog();
    addDiscovery(log, { agency, category: CAT, outcome: 'no-candidates' });
    assert.equal(log.candidateSets[`${agency}\u0000${CAT}`], undefined, 'the state being reproduced');

    const unresolved = unresolvedDiscoveryRounds(log);
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].agency, agency);
    assert.equal(unresolved[0].records, 1);
    assert.match(unresolved[0].reason, /no candidate set exists/);
  });

  test('THE BYPASS: the corpus draft refuses while such a round exists', () => {
    const log = emptyLog();
    log.attempts.push(capturedFor(agency));
    addDiscovery(log, { agency, category: CAT, outcome: 'no-candidates' });
    assert.throws(
      () => deriveDraft(log, opts),
      /discovery round\(s\) are not resolved into a locked, approved set/
    );
  });

  test('a locked but unapproved set is not double-counted as an unresolved round', () => {
    // It is already an outstanding candidate-set approval; reporting it twice would turn one
    // outstanding item into two.
    const log = emptyLog();
    prepareSet(log, agency, CAT, ['https://w.govt.nz/a'], { approve: false });
    assert.deepEqual(unresolvedDiscoveryRounds(log), []);
  });

  test('a round whose set was superseded is history, not unfinished work', () => {
    const log = emptyLog();
    prepareSet(log, agency, CAT, ['https://w.govt.nz/a']);
    approveCandidateSet(log, { agency, category: CAT, approved: false });
    supersedeCandidateSet(log, { agency, category: CAT, reason: 'redone' });
    assert.deepEqual(unresolvedDiscoveryRounds(log), [], 'a superseded round is preserved, not outstanding');
  });

  test('an unconsumed permit blocks the corpus', () => {
    // A permit issued and never consumed means a request was authorised that nothing accounts for.
    const log = emptyLog();
    log.robotsChecks = [{
      id: 'r-0001', origin: 'https://w.govt.nz', fetchedAt: '2026-09-25T08:00:00Z',
      httpStatus: 200, disposition: 'rules', body: '',
    }];
    log.attempts.push(capturedFor(agency));
    issueDiscoveryPermit(log, {
      agency, category: CAT, candidateSetVersion: 1,
      url: 'https://w.govt.nz/unvisited', robotsCheckId: 'r-0001',
    });
    assert.throws(() => deriveDraft(log, opts), /issued and never consumed/);
  });

  test('a resolved round with no open permits builds', () => {
    const log = emptyLog();
    log.attempts.push(capturedFor(agency));
    for (const category of CATEGORY_ORDER) {
      addDiscovery(log, { agency, category, outcome: 'no-candidates' });
      recordCandidates(log, { agency, category, urls: [], declaration: 'none' });
      lockCandidateSet(log, { agency, category });
      approveCandidateSet(log, { agency, category, approved: true });
    }
    const draft = deriveDraft(log, opts);
    assert.equal(draft.pages.length, 1);
  });
});

/**
 * Correcting one discovery record without redoing its round.
 *
 * A round of twenty-six inspections with one self-contradictory record does not need
 * twenty-five re-observations, and repeating them would mean re-requesting pages already
 * retrieved under permits - traffic with no evidential purpose.
 */
describe('a discovery record is corrected in place', () => {
  const CAT = 'account-registration';
  const agency = 'TPK';

  function roundWith(log, { url, method = 'robots', outcome = 'disallowed' }) {
    addDiscovery(log, { agency, category: CAT, url, method, outcome });
    return log.attempts.at(-1);
  }

  test('a corrected record supersedes the original, which is preserved', () => {
    const log = emptyLog();
    const wrong = roundWith(log, { url: 'https://w.govt.nz/robots.txt' });
    addDiscovery(log, {
      agency, category: CAT, url: 'https://w.govt.nz/robots.txt', method: 'robots',
      outcome: 'no-candidates', supersedes: wrong.id,
    });

    assert.equal(isDiscoverySuperseded(log, wrong.id), true);
    assert.ok(log.attempts.find((a) => a.id === wrong.id), 'the original stays in the log');
    assert.equal(log.attempts.find((a) => a.id === wrong.id).outcome, 'disallowed');
  });

  test('a correction must match agency, category, round, url and method', () => {
    for (const [field, value] of [['url', 'https://w.govt.nz/other'], ['discoveryKind', 'sitemap']]) {
      const log = emptyLog();
      const wrong = roundWith(log, { url: 'https://w.govt.nz/robots.txt' });
      const at = '2026-09-25T06:00:00Z';
      assert.throws(
        () => appendAttempt(log, {
          examinedAt: at, agency, website: 'https://w.govt.nz/',
          url: 'https://w.govt.nz/robots.txt', status: 'discovery', discoveryKind: 'robots',
          outcome: 'no-candidates', category: CAT, candidateSetVersion: 1, navigatedAt: at,
          approval: 'approved', supersedesDiscoveryId: wrong.id, [field]: value,
        }),
        /a correction must be for the same/
      );
    }
  });

  test('an id that matches nothing is refused', () => {
    const log = emptyLog();
    roundWith(log, { url: 'https://w.govt.nz/robots.txt' });
    const at = '2026-09-25T06:00:00Z';
    assert.throws(
      () => appendAttempt(log, {
        examinedAt: at, agency, website: 'https://w.govt.nz/', url: 'https://w.govt.nz/robots.txt',
        status: 'discovery', discoveryKind: 'robots', outcome: 'no-candidates', category: CAT,
        candidateSetVersion: 1, navigatedAt: at, approval: 'approved',
        supersedesDiscoveryId: 'd-9999',
      }),
      /matches no recorded attempt/
    );
  });

  test('the same record cannot be corrected twice', () => {
    const log = emptyLog();
    const wrong = roundWith(log, { url: 'https://w.govt.nz/robots.txt' });
    addDiscovery(log, {
      agency, category: CAT, url: 'https://w.govt.nz/robots.txt', method: 'robots',
      outcome: 'no-candidates', supersedes: wrong.id,
    });
    const at = '2026-09-25T06:10:00Z';
    assert.throws(
      () => appendAttempt(log, {
        examinedAt: at, agency, website: 'https://w.govt.nz/', url: 'https://w.govt.nz/robots.txt',
        status: 'discovery', discoveryKind: 'robots', outcome: 'unavailable', category: CAT,
        candidateSetVersion: 1, navigatedAt: at, approval: 'approved',
        supersedesDiscoveryId: wrong.id,
      }),
      /has already been corrected/
    );
  });

  test('locking binds the correction and not the record it replaced', () => {
    const log = emptyLog();
    const wrong = roundWith(log, { url: 'https://w.govt.nz/robots.txt', outcome: 'candidates-found' });
    addDiscovery(log, {
      agency, category: CAT, url: 'https://w.govt.nz/robots.txt', method: 'robots',
      outcome: 'no-candidates', supersedes: wrong.id,
    });
    const fix = log.attempts.at(-1);

    recordCandidates(log, { agency, category: CAT, urls: [], declaration: 'none' });
    const set = lockCandidateSet(log, { agency, category: CAT });
    assert.ok(set.discoveryRecordIds.includes(fix.id), 'the correction evidences the set');
    assert.ok(!set.discoveryRecordIds.includes(wrong.id), 'the superseded record does not');
    // And the withdrawn candidates-found finding no longer contradicts the nil declaration.
    assert.deepEqual(set.locked, []);
  });
});

/**
 * Correcting a record after its set is locked, and keeping robots history.
 *
 * selection-v1.0.13. Two holes that would have opened later.
 *
 * A correction appended after locking left the binding pointing at the superseded record while
 * its replacement sat outside the set, so the set would evidence a finding that had been
 * withdrawn. And a robots refresh overwrote the previous policy while keeping its id, so after
 * twenty-four hours a permit issued under the old policy would appear to have been authorised by
 * the new one.
 */
describe('a locked but unapproved set can be reopened, audibly', () => {
  const CAT = 'account-registration';
  const agency = 'TPK';

  function lockedRound(log) {
    addDiscovery(log, { agency, category: CAT, url: 'https://w.govt.nz/robots.txt', method: 'robots', outcome: 'disallowed' });
    recordCandidates(log, { agency, category: CAT, urls: [], declaration: 'none' });
    return lockCandidateSet(log, { agency, category: CAT });
  }

  test('reopening preserves the previous lock and its reason', () => {
    const log = emptyLog();
    const set = lockedRound(log);
    const firstLock = set.lockedAt;
    const firstBinding = [...set.discoveryRecordIds];

    reopenCandidateSet(log, { agency, category: CAT, reason: 'a discovery record was corrected' });
    assert.equal(set.lockedAt, null);
    assert.equal(set.lockHistory.length, 1);
    assert.equal(set.lockHistory[0].lockedAt, firstLock);
    assert.deepEqual(set.lockHistory[0].discoveryRecordIds, firstBinding);
    assert.equal(set.lockHistory[0].reason, 'a discovery record was corrected');
    assert.ok(set.lockHistory[0].reopenedAt);
  });

  test('reopening requires a reason', () => {
    const log = emptyLog();
    lockedRound(log);
    assert.throws(() => reopenCandidateSet(log, { agency, category: CAT, reason: '  ' }), /requires a reason/);
  });

  test('an approved set cannot be reopened', () => {
    const log = emptyLog();
    lockedRound(log);
    approveCandidateSet(log, { agency, category: CAT, approved: true });
    assert.throws(
      () => reopenCandidateSet(log, { agency, category: CAT, reason: 'x' }),
      /approved and cannot be reopened/
    );
  });

  test('THE HOLE: re-locking binds the correction, not the record it replaced', () => {
    const log = emptyLog();
    const set = lockedRound(log);
    const original = log.attempts.find((a) => a.status === 'discovery');
    assert.ok(set.discoveryRecordIds.includes(original.id), 'bound before the correction');

    reopenCandidateSet(log, { agency, category: CAT, reason: 'the outcome was wrong' });
    addDiscovery(log, {
      agency, category: CAT, url: 'https://w.govt.nz/robots.txt', method: 'robots',
      outcome: 'no-candidates', supersedes: original.id,
    });
    const fix = log.attempts.at(-1);
    lockCandidateSet(log, { agency, category: CAT });

    assert.ok(set.discoveryRecordIds.includes(fix.id), 'the correction is bound');
    assert.ok(!set.discoveryRecordIds.includes(original.id), 'the superseded record is not');
    assert.ok(log.attempts.find((a) => a.id === original.id), 'and is still preserved');
  });
});

describe('robots policy history is append-only', () => {
  const policy = (origin, at, status) => ({
    origin, url: `${origin}/robots.txt`, fetchedAt: at, httpStatus: status,
    disposition: status === 200 ? 'rules' : 'allow-all', sha256: 'x'.repeat(64), bytes: 10, body: '',
  });

  test('THE HOLE: a refresh appends rather than overwriting, and keeps a distinct id', () => {
    const log = emptyLog();
    const first = recordRobotsCheck(log, policy('https://a.govt.nz', '2026-09-24T00:00:00Z', 200));
    const second = recordRobotsCheck(log, policy('https://a.govt.nz', '2026-09-25T00:00:00Z', 404));

    assert.notEqual(first.id, second.id, 'the refreshed policy must not inherit the old id');
    assert.equal(log.robotsChecks.length, 2, 'the earlier policy is retained');
    // A permit issued under the first policy still points at the policy actually observed then.
    assert.equal(log.robotsChecks.find((c) => c.id === first.id).httpStatus, 200);
  });

  test('reads return the most recent policy for that origin', () => {
    const log = emptyLog();
    recordRobotsCheck(log, policy('https://a.govt.nz', '2026-09-24T00:00:00Z', 200));
    recordRobotsCheck(log, policy('https://a.govt.nz', '2026-09-25T00:00:00Z', 404));
    recordRobotsCheck(log, policy('https://b.govt.nz', '2026-09-25T00:00:00Z', 200));
    assert.equal(findRobotsCheck(log, 'https://a.govt.nz').httpStatus, 404);
    assert.equal(findRobotsCheck(log, 'https://b.govt.nz').httpStatus, 200);
  });

  test('a policy older than 24 hours is not fresh', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    assert.equal(robotsCheckIsFresh({ fetchedAt: '2026-09-25T11:00:00Z' }, now), true);
    assert.equal(robotsCheckIsFresh({ fetchedAt: '2026-09-24T11:00:00Z' }, now), false);
  });
});

/**
 * Permits are named, not guessed, and closed with an account of what happened.
 *
 * selection-v1.0.14. Two permits were issued for the same page - once to inspect it, once by the
 * recording script - and since consumption took the oldest match, the second stayed open. Two
 * requests really were made, so the surplus permits were not spurious; what was lost was any way
 * to say which request each one covered, and there was no way to close the remainder at all, so
 * the corpus draft was permanently blocked.
 *
 * "Released" would have been the wrong word for these. No navigation is one disposition; a
 * navigation that duplicated an inspection already recorded is a different one, and it has to
 * name the record that accounts for the traffic.
 */
describe('a permit is named by the record it authorises', () => {
  const CAT = 'account-registration';
  const agency = 'TPK';
  const url = 'https://w.govt.nz/page';
  const base = { agency, category: CAT, candidateSetVersion: 1, url, robotsCheckId: 'r-0001' };

  test('a second open permit for the same url and round is refused', () => {
    const log = emptyLog();
    const first = issueDiscoveryPermit(log, base);
    assert.throws(
      () => issueDiscoveryPermit(log, base),
      new RegExp(`permit ${first.id} is already open`)
    );
    assert.equal(log.discoveryPermits.length, 1);
  });

  test('a record must name its permit', () => {
    const log = emptyLog();
    issueDiscoveryPermit(log, base);
    assert.throws(
      () => consumeDiscoveryPermit(log, { ...base, navigatedAt: null }),
      /must name the permit that authorised its navigation/
    );
  });

  test('a named permit that belongs to another page is refused', () => {
    const log = emptyLog();
    const other = issueDiscoveryPermit(log, { ...base, url: 'https://w.govt.nz/elsewhere' });
    assert.throws(
      () => consumeDiscoveryPermit(log, { ...base, permitId: other.id }),
      new RegExp(`permit ${other.id} is for`)
    );
  });

  test('closing as duplicate-request must name a matching discovery record', () => {
    const log = emptyLog();
    const permit = issueDiscoveryPermit(log, base);
    assert.throws(
      () => closeDiscoveryPermit(log, { permitId: permit.id, disposition: 'duplicate-request', reason: 'x' }),
      /must name the discovery record that accounts for the traffic/
    );

    const foreign = addDiscovery(log, { agency, category: CAT, url: 'https://w.govt.nz/other' });
    assert.throws(
      () => closeDiscoveryPermit(log, {
        permitId: permit.id, disposition: 'duplicate-request', reason: 'x', accountedBy: foreign.id,
      }),
      /is url .*but permit .* is/
    );
  });

  test('an unused closure names no record, because nothing was requested', () => {
    const log = emptyLog();
    const permit = issueDiscoveryPermit(log, base);
    const record = addDiscovery(log, { agency, category: CAT, url });
    assert.throws(
      () => closeDiscoveryPermit(log, {
        permitId: permit.id, disposition: 'unused', reason: 'changed plan', accountedBy: record.id,
      }),
      /an unused closure names no discovery record/
    );
  });

  /** An inspection recorded under its own consumed permit: what evidence has to look like. */
  function evidencedInspection(log, forUrl = url) {
    log.robotsChecks ??= [{
      id: 'r-0001', origin: 'https://w.govt.nz', fetchedAt: '2026-09-25T08:00:00Z',
      httpStatus: 200, disposition: 'rules', body: '',
    }];
    const p = issueDiscoveryPermit(log, { ...base, url: forUrl });
    addDiscovery(log, { agency, category: CAT, url: forUrl });
    const r = log.attempts.at(-1);
    r.permitId = p.id;
    r.navigatedAt = r.navigatedAt ?? '2026-09-25T08:00:00Z';
    p.consumedAt = '2026-09-25T08:00:00Z';
    return r;
  }

  test('a closed permit no longer blocks, and records its account', () => {
    const log = emptyLog();
    const record = evidencedInspection(log);
    const permit = issueDiscoveryPermit(log, base);
    assert.equal(openDiscoveryPermits(log).length, 1);

    const closed = closeDiscoveryPermit(log, {
      permitId: permit.id, disposition: 'duplicate-request',
      reason: 'two permits and two requests; the oldest-permit rule made the pairing ambiguous',
      accountedBy: record.id,
    });
    assert.equal(openDiscoveryPermits(log).length, 0);
    assert.equal(closed.disposition, 'duplicate-request');
    assert.equal(closed.accountedBy, record.id);
    assert.ok(closed.closureId);
    assert.ok(closed.closedAt);
  });

  test('a consumed or already-closed permit cannot be closed', () => {
    const log = emptyLog();
    const record = evidencedInspection(log);
    const permit = issueDiscoveryPermit(log, base);
    closeDiscoveryPermit(log, {
      permitId: permit.id, disposition: 'duplicate-request', reason: 'x', accountedBy: record.id,
    });
    assert.throws(
      () => closeDiscoveryPermit(log, { permitId: permit.id, disposition: 'unused', reason: 'y' }),
      /was already closed/
    );

    const second = issueDiscoveryPermit(log, { ...base, url: 'https://w.govt.nz/two' });
    consumeDiscoveryPermit(log, { ...base, url: 'https://w.govt.nz/two', permitId: second.id });
    assert.throws(
      () => closeDiscoveryPermit(log, { permitId: second.id, disposition: 'unused', reason: 'y' }),
      /was consumed at .* and cannot be closed/
    );
  });

  test('the traffic audit counts a duplicate request as traffic, not as an inspection', () => {
    const log = emptyLog();
    const record = evidencedInspection(log);
    const dup = issueDiscoveryPermit(log, base);
    closeDiscoveryPermit(log, {
      permitId: dup.id, disposition: 'duplicate-request', reason: 'second request, same inspection',
      accountedBy: record.id,
    });
    const unused = issueDiscoveryPermit(log, { ...base, url: 'https://w.govt.nz/never' });
    closeDiscoveryPermit(log, { permitId: unused.id, disposition: 'unused', reason: 'not visited' });

    const audit = permitAudit(log);
    assert.equal(audit.issued, 3);
    assert.equal(audit.consumed, 1);
    assert.equal(audit.closedDuplicateRequest, 1);
    assert.equal(audit.closedUnused, 1);
    assert.equal(audit.open, 0);
    // Two requests were authorised and made; the unused permit produced none.
    assert.equal(audit.networkRequestsAuthorised, 2);
    assert.equal(audit.closures.length, 2);
    assert.ok(audit.closures.every((c) => c.closureId && c.closedAt && c.reason));
  });

  test('a properly closed permit does not withhold the corpus draft', () => {
    const log = emptyLog();
    log.robotsChecks = [{
      id: 'r-0001', origin: 'https://w.govt.nz', fetchedAt: '2026-09-25T08:00:00Z',
      httpStatus: 200, disposition: 'rules', body: '',
    }];
    const agencyName = drawOrder[0].agency;
    log.attempts.push({
      agency: agencyName, category: 'enquiry-or-contact', status: 'captured', approval: APPROVAL.APPROVED,
      url: 'https://w.govt.nz/1', finalUrl: 'https://w.govt.nz/1', pageId: 'page-1', file: '1.html',
      htmlSha256: 'x', inclusionEvidence: 'has a name field', capturedAt: '2026-09-24T00:00:00Z',
      browser: 'Chromium 1', automationTool: 'playwright 1',
      viewport: { width: 1280, height: 800 }, locale: 'en-NZ', redirects: [],
    });
    const permit = issueDiscoveryPermit(log, {
      agency: agencyName, category: CAT, candidateSetVersion: 1,
      url: 'https://w.govt.nz/x', robotsCheckId: 'r-0001',
    });
    const opts = { frameSha256: 'a'.repeat(64), drawOrderSha256: 'b'.repeat(64) };
    assert.throws(() => deriveDraft(log, opts), /issued and never consumed/);

    closeDiscoveryPermit(log, { permitId: permit.id, disposition: 'unused', reason: 'not visited' });
    const draft = deriveDraft(log, opts);
    assert.equal(draft.pages.length, 1);
  });
});

/**
 * A duplicate-request closure must be evidenced by a real, authorised navigation.
 *
 * selection-v1.0.15, reproduced as an attack. `closeDiscoveryPermit` checked that the named
 * record existed and matched the permit's agency, category, round and URL, and nothing else. A
 * record carrying `navigationPerformed: false` was accepted as evidence that a request HAD been
 * made, and the audit then reported an authorised network request whose own named evidence said
 * no navigation occurred. The corpus gate checked only for open permits, so the fabricated state
 * escaped the final gate as well.
 *
 * A duplicate-request closure asserts two things: a second request was made, and an existing
 * inspection accounts for it. So the evidence has to be a real navigation, recorded under its own
 * consumed permit, and that permit must be a different one covering the same scope - otherwise it
 * duplicates nothing.
 */
describe('the permit ledger describes traffic that happened', () => {
  const CAT = 'account-registration';
  const agency = 'TPK';
  const url = 'https://w.govt.nz/page';
  const scope = { agency, category: CAT, candidateSetVersion: 1, url };
  const at = '2026-09-25T08:00:00Z';

  /** A properly evidenced inspection: navigated, under its own consumed permit. */
  function realInspection(log, { navigatedAt = at, urlFor = url } = {}) {
    log.robotsChecks ??= [{
      id: 'r-0001', origin: 'https://w.govt.nz', fetchedAt: at, httpStatus: 200,
      disposition: 'rules', body: '',
    }];
    const permit = issueDiscoveryPermit(log, { ...scope, url: urlFor, robotsCheckId: 'r-0001' });
    appendAttempt(log, {
      examinedAt: navigatedAt, agency, website: 'https://w.govt.nz/', url: urlFor,
      status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates', category: CAT,
      candidateSetVersion: 1, navigatedAt, approval: 'approved', permitId: permit.id,
    });
    const record = log.attempts.at(-1);
    permit.consumedAt = navigatedAt;
    return { permit, record };
  }

  /** A record that states no request was made. */
  function notNavigated(log, urlFor = url) {
    appendAttempt(log, {
      examinedAt: at, agency, website: 'https://w.govt.nz/', url: urlFor,
      status: 'discovery', discoveryKind: 'internal-search', outcome: 'disallowed', category: CAT,
      candidateSetVersion: 1, navigationPerformed: false, checkedAt: at, approval: 'approved',
    });
    return log.attempts.at(-1);
  }

  test('THE ATTACK: a not-navigated record cannot evidence a duplicate request', () => {
    const log = emptyLog();
    const record = notNavigated(log);
    const permit = issueDiscoveryPermit(log, { ...scope, robotsCheckId: 'r-0001' });
    assert.throws(
      () => closeDiscoveryPermit(log, {
        permitId: permit.id, disposition: 'duplicate-request', reason: 'fabricated',
        accountedBy: record.id,
      }),
      /records navigationPerformed: false/
    );
    // And the permit is left untouched, not half-closed.
    assert.equal(permit.closedAt, undefined);
    assert.equal(permit.disposition, undefined);
    assert.equal(openDiscoveryPermits(log).length, 1);
  });

  test('evidence that names no permit of its own is refused', () => {
    const log = emptyLog();
    appendAttempt(log, {
      examinedAt: at, agency, website: 'https://w.govt.nz/', url,
      status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates', category: CAT,
      candidateSetVersion: 1, navigatedAt: at, approval: 'approved',
    });
    const record = log.attempts.at(-1);
    const permit = issueDiscoveryPermit(log, { ...scope, robotsCheckId: 'r-0001' });
    assert.throws(
      () => closeDiscoveryPermit(log, {
        permitId: permit.id, disposition: 'duplicate-request', reason: 'x', accountedBy: record.id,
      }),
      /names no permit of its own/
    );
  });

  test('evidence whose permit was never consumed is refused', () => {
    const log = emptyLog();
    const { permit: evidencePermit, record } = realInspection(log);
    const permit = issueDiscoveryPermit(log, { ...scope, robotsCheckId: 'r-0001' });
    // Un-consumed only now: doing it earlier reopens the first permit, and the duplicate-permit
    // guard then refuses the second - which is that guard working, not this rule.
    evidencePermit.consumedAt = null;
    assert.throws(
      () => closeDiscoveryPermit(log, {
        permitId: permit.id, disposition: 'duplicate-request', reason: 'x', accountedBy: record.id,
      }),
      /was never consumed/
    );
  });

  test('evidence from a different scope is refused', () => {
    const log = emptyLog();
    const { record } = realInspection(log, { urlFor: 'https://w.govt.nz/elsewhere' });
    const permit = issueDiscoveryPermit(log, { ...scope, robotsCheckId: 'r-0001' });
    assert.throws(
      () => closeDiscoveryPermit(log, {
        permitId: permit.id, disposition: 'duplicate-request', reason: 'x', accountedBy: record.id,
      }),
      /but permit .* is/
    );
  });

  test('a properly evidenced duplicate request closes', () => {
    const log = emptyLog();
    const { permit: evidencePermit, record } = realInspection(log);
    const permit = issueDiscoveryPermit(log, { ...scope, robotsCheckId: 'r-0001' });
    const closed = closeDiscoveryPermit(log, {
      permitId: permit.id, disposition: 'duplicate-request',
      reason: 'two permits and two requests; only one judgement recorded',
      accountedBy: record.id,
    });
    assert.equal(closed.disposition, 'duplicate-request');
    assert.notEqual(record.permitId, permit.id, 'the evidence is authorised by a different permit');
    assert.ok(evidencePermit.consumedAt);
    assert.deepEqual(checkPermitLedger(log), []);
  });

  test('THE GATE: a fabricated closure is refused by the corpus draft too', () => {
    // Written directly into the log, as a hand-edited file would be: the closure API is not the
    // only way a ledger reaches the gate.
    const log = emptyLog();
    const agencyName = drawOrder[0].agency;
    log.attempts.push({
      agency: agencyName, category: 'enquiry-or-contact', status: 'captured', approval: APPROVAL.APPROVED,
      url: 'https://w.govt.nz/1', finalUrl: 'https://w.govt.nz/1', pageId: 'page-1', file: '1.html',
      htmlSha256: 'x', inclusionEvidence: 'has a name field', capturedAt: '2026-09-24T00:00:00Z',
      browser: 'Chromium 1', automationTool: 'playwright 1',
      viewport: { width: 1280, height: 800 }, locale: 'en-NZ', redirects: [],
    });
    appendAttempt(log, {
      examinedAt: at, agency: agencyName, website: 'https://w.govt.nz/', url,
      status: 'discovery', discoveryKind: 'internal-search', outcome: 'disallowed',
      category: 'enquiry-or-contact', candidateSetVersion: 1, navigationPerformed: false,
      checkedAt: at, approval: 'approved',
    });
    const record = log.attempts.at(-1);
    // Resolve the round, so the ledger check is what this test exercises rather than the
    // unresolved-round check that would otherwise fire first.
    recordCandidates(log, { agency: agencyName, category: 'enquiry-or-contact', urls: [], declaration: 'none' });
    lockCandidateSet(log, { agency: agencyName, category: 'enquiry-or-contact' });
    approveCandidateSet(log, { agency: agencyName, category: 'enquiry-or-contact', approved: true });

    log.discoveryPermits = [{
      id: 'p-0001', agency: agencyName, category: 'enquiry-or-contact', candidateSetVersion: 1, url,
      robotsCheckId: 'r-0001', issuedAt: at, consumedAt: null,
      closedAt: at, disposition: 'duplicate-request', closureReason: 'fabricated',
      accountedBy: record.id, closureId: 'x-0001',
    }];
    assert.equal(openDiscoveryPermits(log).length, 0, 'it is not an OPEN permit, so that gate misses it');
    assert.throws(
      () => deriveDraft(log, { frameSha256: 'a'.repeat(64), drawOrderSha256: 'b'.repeat(64) }),
      /permit ledger is inconsistent/
    );
  });

  test('THE GATE: provenance refuses to publish an inconsistent ledger', () => {
    const log = emptyLog();
    const record = notNavigated(log);
    log.discoveryPermits = [{
      id: 'p-0001', agency, category: CAT, candidateSetVersion: 1, url,
      robotsCheckId: 'r-0001', issuedAt: at, consumedAt: null,
      closedAt: at, disposition: 'duplicate-request', closureReason: 'fabricated',
      accountedBy: record.id, closureId: 'x-0001',
    }];
    const dir = mkdtempSync(join(tmpdir(), 'formfair-ledger-'));
    try {
      assert.throws(() => publishProvenance(log, { to: dir }), /must not be published/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unused closure that names a record is refused by the validator too', () => {
    const log = emptyLog();
    const { record } = realInspection(log);
    log.discoveryPermits.push({
      id: 'p-9001', agency, category: CAT, candidateSetVersion: 1, url,
      robotsCheckId: 'r-0001', issuedAt: at, consumedAt: null,
      closedAt: at, disposition: 'unused', closureReason: 'x', accountedBy: record.id,
    });
    assert.ok(checkPermitLedger(log).some((p) => /closed unused but names/.test(p)));
  });
});

/**
 * The consumption side of the permit ledger.
 *
 * selection-v1.0.16. The validator checked closures and never reached consumption, so three
 * inconsistent ledgers passed cleanly: a discovery record whose URL differed from its own
 * consumed permit's, a consumed permit no record referenced, and two records naming one
 * single-use permit.
 *
 * A permit and the inspection it authorised are a pair. Anything else means the log does not
 * describe the traffic that occurred - which is the only thing the permit model is for.
 */
describe('a permit and its inspection are one to one', () => {
  const CAT = 'account-registration';
  const at = '2026-09-25T08:00:00Z';
  const later = '2026-09-25T08:00:10Z';

  function ledger() {
    const log = emptyLog();
    log.robotsChecks = [{
      id: 'r-0001', origin: 'https://w.govt.nz', fetchedAt: at, httpStatus: 200,
      disposition: 'rules', body: '',
    }];
    return log;
  }
  const issue = (log, url) => issueDiscoveryPermit(log, {
    agency: 'TPK', category: CAT, candidateSetVersion: 1, url, robotsCheckId: 'r-0001',
  });
  const record = (log, url, permitId, when = at) => {
    appendAttempt(log, {
      examinedAt: when, agency: 'TPK', website: 'https://w.govt.nz/', url,
      status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates', category: CAT,
      candidateSetVersion: 1, navigatedAt: when, approval: 'approved',
      ...(permitId ? { permitId } : {}),
    });
    return log.attempts.at(-1);
  };

  test('THE GAP: a record whose url differs from its permit is caught', () => {
    const log = ledger();
    const permit = issue(log, 'https://w.govt.nz/a');
    permit.consumedAt = at;
    record(log, 'https://w.govt.nz/different', permit.id);
    assert.ok(checkPermitLedger(log).some((p) => /but its permit p-0001 covers/.test(p)));
  });

  test('THE GAP: a consumed permit no record names is caught', () => {
    const log = ledger();
    issue(log, 'https://w.govt.nz/a').consumedAt = at;
    assert.ok(checkPermitLedger(log).some((p) => /no discovery record names it/.test(p)));
  });

  test('THE GAP: two records naming one single-use permit are caught', () => {
    const log = ledger();
    const permit = issue(log, 'https://w.govt.nz/a');
    permit.consumedAt = at;
    record(log, 'https://w.govt.nz/a', permit.id, at);
    record(log, 'https://w.govt.nz/b', permit.id, later);
    assert.ok(checkPermitLedger(log).some((p) => /a permit authorises one request/.test(p)));
  });

  test('a record naming a permit that does not exist is caught', () => {
    const log = ledger();
    record(log, 'https://w.govt.nz/a', 'p-9999');
    assert.ok(checkPermitLedger(log).some((p) => /names permit p-9999, which does not exist/.test(p)));
  });

  test('a record naming an unconsumed permit is caught', () => {
    const log = ledger();
    const permit = issue(log, 'https://w.govt.nz/a');
    record(log, 'https://w.govt.nz/a', permit.id);
    assert.ok(checkPermitLedger(log).some((p) => /is not recorded as consumed/.test(p)));
  });

  test('duplicate permit ids and closure ids are caught', () => {
    const log = ledger();
    const a = issue(log, 'https://w.govt.nz/a');
    a.consumedAt = at;
    record(log, 'https://w.govt.nz/a', a.id);
    log.discoveryPermits.push({ ...a, url: 'https://w.govt.nz/b', consumedAt: null });
    assert.ok(checkPermitLedger(log).some((p) => /permit id p-0001 appears more than once/.test(p)));

    const log2 = ledger();
    const x = issue(log2, 'https://w.govt.nz/a');
    const y = issue(log2, 'https://w.govt.nz/b');
    x.closedAt = at; x.disposition = 'unused'; x.closureReason = 'r'; x.closureId = 'x-0001';
    y.closedAt = at; y.disposition = 'unused'; y.closureReason = 'r'; y.closureId = 'x-0001';
    assert.ok(checkPermitLedger(log2).some((p) => /closure id x-0001 appears more than once/.test(p)));
  });

  test('a permit whose robots check is missing or for another origin is caught', () => {
    const log = ledger();
    const permit = issue(log, 'https://w.govt.nz/a');
    permit.consumedAt = at;
    record(log, 'https://w.govt.nz/a', permit.id);
    permit.robotsCheckId = 'r-9999';
    assert.ok(checkPermitLedger(log).some((p) => /robots check r-9999, which does not exist/.test(p)));

    permit.robotsCheckId = 'r-0001';
    log.robotsChecks[0].origin = 'https://elsewhere.govt.nz';
    assert.ok(checkPermitLedger(log).some((p) => /names a robots check for https:\/\/elsewhere/.test(p)));
  });

  test('records predating the permit model are exempt', () => {
    // They carry no permitId at all; the invariants apply to participants in the model.
    const log = ledger();
    record(log, 'https://w.govt.nz/legacy', null);
    assert.deepEqual(checkPermitLedger(log), []);
  });

  test('a consistent ledger passes', () => {
    const log = ledger();
    const a = issue(log, 'https://w.govt.nz/a');
    a.consumedAt = at;
    record(log, 'https://w.govt.nz/a', a.id, at);
    const b = issue(log, 'https://w.govt.nz/b');
    b.consumedAt = later;
    record(log, 'https://w.govt.nz/b', b.id, later);
    assert.deepEqual(checkPermitLedger(log), []);
  });
});
