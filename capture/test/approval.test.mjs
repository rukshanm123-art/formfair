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
import { prepareSet, addDiscovery } from './helpers.mjs';

/** Candidates only. Discovery records share the attempts array and are not candidates. */
const candidates = (log) => log.attempts.filter((a) => a.status !== 'discovery');

const drawOrder = parseDrawOrder(
  readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
);
const el = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));

/** Records, locks and (by default) approves a set, so a test can reach assessment. */
function ready(log, agency, category, urls, { approve = true } = {}) {
  return prepareSet(log, agency, category, urls, { approve });
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
    candidates(log)[0].approval = APPROVAL.REJECTED;
    assert.match(nextWork(log, drawOrder).reason, /pending or rejected/);

    appendAttempt(log, outcome(agency, 'account-registration', url, {
      supersedes: url, exclusionReason: 'corrected: the field is a display name, not a personal name',
    }));
    candidates(log)[1].approval = APPROVAL.APPROVED;
    assert.equal(isSuperseded(log, candidates(log)[0]), true);
    assert.doesNotMatch(nextWork(log, drawOrder).reason ?? '', /pending or rejected/);
  });

  test('a correction preserves the original record', () => {
    // A correction that erases what it corrected is not a correction; the ledger has to
    // show what was decided first.
    const log = emptyLog();
    const [url] = ready(log, 'TPK', 'account-registration', ['https://w.govt.nz/a']);
    appendAttempt(log, outcome('TPK', 'account-registration', url, { exclusionReason: 'first call' }));
    candidates(log)[0].approval = APPROVAL.REJECTED;
    appendAttempt(log, outcome('TPK', 'account-registration', url, { supersedes: url, exclusionReason: 'second call' }));
    assert.equal(candidates(log).length, 2);
    assert.equal(candidates(log)[0].exclusionReason, 'first call');
    assert.equal(candidates(log)[0].approval, APPROVAL.REJECTED);
    assert.equal(candidates(log)[1].supersedes, url);
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
    status: 'discovery', discoveryKind: 'internal-search', outcome: 'no-candidates',
    category: 'account-registration', candidateSetVersion: 1, navigatedAt,
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

/**
 * Correcting a rejected decision when a URL has more than one attempt.
 *
 * capture-v1.0.3. The first real capture of the study failed on a third-party script that
 * never finished loading, and the harness was changed so that it would not. Rerunning it
 * means a second attempt at a URL that already has one - which is the case `supersedes:
 * <url>` could not express, because it names the page rather than the decision. With two
 * attempts recorded, approving "the attempt for that URL" is ambiguous, and the ambiguity
 * resolves toward the rejected one, which is the wrong way round.
 */
describe('supersession identifies the decision, not the page', () => {
  const failure = (agency, url, extra = {}) => ({
    examinedAt: '2026-09-24T00:00:00Z', agency, website: 'https://w.govt.nz/', url,
    status: 'failed', category: 'enquiry-or-contact',
    exclusionReason: 'capture failed: Timeout 45000ms exceeded', eligibility: el(), ...extra,
  });

  /** A log holding one rejected failure, as the pilot's did. */
  function withRejectedFailure() {
    const log = emptyLog();
    const url = 'https://w.govt.nz/contact';
    ready(log, 'TPK', 'enquiry-or-contact', [url]);
    appendAttempt(log, failure('TPK', url));
    const first = candidates(log).at(-1);
    first.approval = APPROVAL.REJECTED;
    first.approvalNote = 'harness defect, not a property of the page';
    return { log, url, first };
  }

  test('a rerun supersedes the rejected attempt by its id', () => {
    const { log, url, first } = withRejectedFailure();
    assert.equal(isSuperseded(log, first), false);

    appendAttempt(log, {
      ...failure('TPK', url),
      examinedAt: '2026-09-24T00:10:00Z',
      status: 'excluded',
      exclusionReason: 'no personal-name field after all',
      supersedesAttemptId: first.id,
    });

    const second = candidates(log).at(-1);
    assert.notEqual(second.id, first.id);
    assert.equal(second.supersedesAttemptId, first.id);
    // The original stays, with its rejection intact.
    assert.equal(first.approval, APPROVAL.REJECTED);
    assert.equal(isSuperseded(log, first), true);
  });

  test('a rerun that supersedes nothing is refused, and is told which id to name', () => {
    const { log, url, first } = withRejectedFailure();
    assert.throws(
      () => appendAttempt(log, { ...failure('TPK', url), examinedAt: '2026-09-24T00:10:00Z' }),
      new RegExp(`supersedesAttemptId set to ${first.id}`)
    );
  });

  test('a rerun cannot supersede an attempt that is not rejected', () => {
    const log = emptyLog();
    const url = 'https://w.govt.nz/contact';
    ready(log, 'TPK', 'enquiry-or-contact', [url]);
    appendAttempt(log, failure('TPK', url));
    const pending = candidates(log).at(-1);
    assert.throws(
      () => appendAttempt(log, {
        ...failure('TPK', url), examinedAt: '2026-09-24T00:10:00Z',
        supersedesAttemptId: pending.id,
      }),
      /is pending, not rejected/
    );
  });

  test('a rerun cannot supersede the same rejected attempt twice', () => {
    const { log, url, first } = withRejectedFailure();
    appendAttempt(log, {
      ...failure('TPK', url), examinedAt: '2026-09-24T00:10:00Z',
      status: 'excluded', exclusionReason: 'no personal-name field',
      supersedesAttemptId: first.id,
    });
    const second = candidates(log).at(-1);
    second.approval = APPROVAL.APPROVED;
    assert.throws(
      () => appendAttempt(log, {
        ...failure('TPK', url), examinedAt: '2026-09-24T00:20:00Z',
        supersedesAttemptId: first.id,
      }),
      /has already been superseded/
    );
  });

  test('a rerun cannot supersede an attempt for a different page', () => {
    const log = emptyLog();
    const url = 'https://w.govt.nz/contact';
    const other = 'https://w.govt.nz/other';
    ready(log, 'TPK', 'enquiry-or-contact', [url, other]);
    appendAttempt(log, failure('TPK', url));
    const first = candidates(log).at(-1);
    first.approval = APPROVAL.REJECTED;
    assert.throws(
      () => appendAttempt(log, {
        ...failure('TPK', other), examinedAt: '2026-09-24T00:10:00Z',
        supersedesAttemptId: first.id,
      }),
      /which is not what this attempt supersedes/
    );
  });

  test('an id that matches no attempt is refused', () => {
    const { log, url } = withRejectedFailure();
    assert.throws(
      () => appendAttempt(log, {
        ...failure('TPK', url), examinedAt: '2026-09-24T00:10:00Z',
        supersedesAttemptId: 'c-9999',
      }),
      /matches no recorded attempt/
    );
  });
});

/**
 * The set and its evidence must agree.
 *
 * selection-v1.0.4. Binding a set to its discovery round proved that a round happened. It
 * did not check that the round SAYS what the set claims, and both contradictions below
 * locked cleanly until now. Each is a silent falsification of the prevalence data: one
 * reports no form for an agency whose own discovery recorded finding one, the other reports
 * a form that no inspection ever recorded finding.
 *
 * The third case is the one that made the first two possible - an empty set carried no
 * record that its emptiness was intended, so "this agency publishes no such form" and "this
 * category was never searched" were the same bytes in the log.
 */
describe('a locked set must agree with its discovery round', () => {
  const CAT = 'account-registration';

  /** Discovery for one round, with the outcome under test. */
  const round = (log, outcome) =>
    addDiscovery(log, { agency: 'TPK', category: CAT, outcome, url: `https://w.govt.nz/d-${outcome}` });

  test('an empty set is refused when discovery reports candidates-found', () => {
    const log = emptyLog();
    round(log, 'candidates-found');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' });
    assert.throws(
      () => lockCandidateSet(log, { agency: 'TPK', category: CAT }),
      /declared to have no candidates, but 1 discovery record\(s\) report candidates-found/
    );
  });

  test('the refusal names the discovery records that contradict the nil declaration', () => {
    const log = emptyLog();
    const a = round(log, 'candidates-found');
    const b = addDiscovery(log, {
      agency: 'TPK', category: CAT, outcome: 'candidates-found', url: 'https://w.govt.nz/d-second',
    });
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' });
    assert.throws(
      () => lockCandidateSet(log, { agency: 'TPK', category: CAT }),
      new RegExp(`${a.id}, ${b.id}`)
    );
  });

  test('a non-empty set is refused when no discovery record reports candidates-found', () => {
    const log = emptyLog();
    round(log, 'no-candidates');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: ['https://w.govt.nz/register'] });
    assert.throws(
      () => lockCandidateSet(log, { agency: 'TPK', category: CAT }),
      /locks 1 candidate\(s\), but no discovery record for this round reports candidates-found/
    );
  });

  test('an undeclared empty set is refused, even built straight from the library', () => {
    // The CLI is not the only caller, so the rule cannot live in the CLI. This is the exact
    // shape `candidates --add ""` used to produce.
    const log = emptyLog();
    round(log, 'no-candidates');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [] });
    assert.throws(
      () => lockCandidateSet(log, { agency: 'TPK', category: CAT }),
      /no candidates and no nil declaration/
    );
  });

  test('a declared nil set locks, and records the declaration', () => {
    const log = emptyLog();
    round(log, 'no-candidates');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' });
    const set = lockCandidateSet(log, { agency: 'TPK', category: CAT });
    assert.equal(set.candidateDeclaration, 'none');
    assert.match(set.declaredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(set.locked, []);
    // Evidenced like any other set: a nil finding is still a finding.
    assert.equal(set.discoveryRecordIds.length, 1);
  });

  test('a set with candidates and a candidates-found record still locks', () => {
    const log = emptyLog();
    round(log, 'candidates-found');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: ['https://w.govt.nz/register'] });
    const set = lockCandidateSet(log, { agency: 'TPK', category: CAT });
    assert.deepEqual(set.locked, ['https://w.govt.nz/register']);
    assert.equal(set.candidateDeclaration, null);
  });

  test('a nil result cannot be declared for a set that already found something', () => {
    const log = emptyLog();
    round(log, 'candidates-found');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: ['https://w.govt.nz/register'] });
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' }),
      /a nil result cannot be declared for a set that found something/
    );
  });

  test('a candidate cannot be added to a set already declared nil', () => {
    const log = emptyLog();
    round(log, 'no-candidates');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' });
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: CAT, urls: ['https://w.govt.nz/register'] }),
      /a candidate cannot be added to a nil result/
    );
  });

  test('a nil declaration cannot be recorded together with candidate URLs', () => {
    const log = emptyLog();
    round(log, 'no-candidates');
    assert.throws(
      () => recordCandidates(log, {
        agency: 'TPK', category: CAT, urls: ['https://w.govt.nz/register'], declaration: 'none',
      }),
      /cannot be recorded together with candidate URLs/
    );
  });

  test('an unknown declaration is refused rather than stored', () => {
    const log = emptyLog();
    round(log, 'no-candidates');
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'nil' }),
      /unknown candidate declaration/
    );
  });

  test('declaring nil on a locked empty set is allowed, and cannot smuggle a candidate in', () => {
    // How a set locked empty before declarations existed records the declaration that was in
    // fact made. Membership cannot change: the set is empty and the guards keep it so.
    const log = emptyLog();
    round(log, 'no-candidates');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' });
    const set = lockCandidateSet(log, { agency: 'TPK', category: CAT });
    // Simulate the pre-declaration state.
    delete set.candidateDeclaration;
    delete set.declaredAt;

    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' });
    assert.equal(set.candidateDeclaration, 'none');
    assert.deepEqual(set.discovered, []);

    // And the locked-set guard still holds for anything that would change membership.
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: CAT, urls: ['https://w.govt.nz/late'] }),
      /a candidate cannot be added to a nil result/
    );
  });

  test('declaring nil on a locked NON-empty set is refused', () => {
    const log = emptyLog();
    round(log, 'candidates-found');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: ['https://w.govt.nz/register'] });
    lockCandidateSet(log, { agency: 'TPK', category: CAT });
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' }),
      /a nil result cannot be declared for a set that found something/
    );
  });

  test('declaring nil on an already approved empty set is refused', () => {
    const log = emptyLog();
    round(log, 'no-candidates');
    recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' });
    const set = lockCandidateSet(log, { agency: 'TPK', category: CAT });
    approveCandidateSet(log, { agency: 'TPK', category: CAT, approved: true });
    delete set.candidateDeclaration;
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' }),
      /was locked at .* and cannot grow/
    );
  });
});

/**
 * The approval gate revalidates the evidence.
 *
 * selection-v1.0.5, from an attack reproduced against v1.0.4. The consistency rule lived
 * inside `lockCandidateSet`, which made it a property of one code path rather than of the
 * data. A set locked before the rule existed could be handed the retrospective nil
 * declaration and then approved, because approval rechecked nothing - so an empty set whose
 * own bound discovery record said `candidates-found` reached APPROVED.
 *
 * The lesson generalises past this bug: validating where a value is written is not the same
 * as validating where it is trusted, and the last gate is the one that has to hold.
 */
describe('the approval gate revalidates the set against its evidence', () => {
  const CAT = 'account-registration';

  /**
   * A set as a log written before selection-v1.0.4 holds it: locked, empty, and bound to a
   * record with the given outcome. Built directly, because no current code path can produce
   * it - which is the point, since logs on disk already contain sets like this.
   */
  function legacyLockedEmptySet(outcome, { declared = false } = {}) {
    const log = emptyLog();
    const record = addDiscovery(log, {
      agency: 'TPK', category: CAT, outcome, url: 'https://w.govt.nz/d-legacy',
    });
    log.candidateSets[`TPK\u0000${CAT}`] = {
      agency: 'TPK', category: CAT, version: 1,
      discovered: [], locked: [], ordered: [], droppedBeyondBound: [],
      lockedAt: '2026-09-24T10:00:00Z', approval: APPROVAL.PENDING,
      discoveryRecordIds: [record.id], discoveryMethods: ['navigation'],
      ...(declared ? { candidateDeclaration: 'none', declaredAt: '2026-09-25T02:57:32Z' } : {}),
    };
    return { log, record };
  }

  test('THE ATTACK: legacy empty set + candidates-found + retrospective declaration + approve', () => {
    const { log, record } = legacyLockedEmptySet('candidates-found');

    // Step 3 of the attack. The migration is a blessing too, so it validates and refuses
    // before the declaration is ever attached.
    assert.throws(
      () => recordCandidates(log, { agency: 'TPK', category: CAT, urls: [], declaration: 'none' }),
      new RegExp(`report candidates-found \\(${record.id}\\)`)
    );
    const set = log.candidateSets[`TPK\u0000${CAT}`];
    assert.equal(set.candidateDeclaration, undefined, 'the declaration must not have been attached');

    // Step 4 of the attack, reached independently: a log that already carries the
    // declaration must still be refused at approval.
    set.candidateDeclaration = 'none';
    set.declaredAt = '2026-09-25T02:57:32Z';
    assert.throws(
      () => approveCandidateSet(log, { agency: 'TPK', category: CAT, approved: true }),
      new RegExp(`report candidates-found \\(${record.id}\\)`)
    );
    assert.equal(set.approval, APPROVAL.PENDING, 'nothing may be approved on the way out');
  });

  test('approval is refused for a legacy empty set that was never declared at all', () => {
    const { log } = legacyLockedEmptySet('no-candidates');
    assert.throws(
      () => approveCandidateSet(log, { agency: 'TPK', category: CAT, approved: true }),
      /no candidates and no nil declaration/
    );
  });

  test('approval is refused for a locked non-empty set with no candidates-found record', () => {
    const log = emptyLog();
    const record = addDiscovery(log, {
      agency: 'TPK', category: CAT, outcome: 'no-candidates', url: 'https://w.govt.nz/d-legacy',
    });
    log.candidateSets[`TPK\u0000${CAT}`] = {
      agency: 'TPK', category: CAT, version: 1,
      discovered: ['https://w.govt.nz/register'], locked: ['https://w.govt.nz/register'],
      ordered: ['https://w.govt.nz/register'], droppedBeyondBound: [],
      lockedAt: '2026-09-24T10:00:00Z', approval: APPROVAL.PENDING,
      discoveryRecordIds: [record.id], discoveryMethods: ['navigation'],
    };
    assert.throws(
      () => approveCandidateSet(log, { agency: 'TPK', category: CAT, approved: true }),
      /no discovery record for this round reports candidates-found/
    );
  });

  test('a set whose evidence contradicts itself can still be REJECTED', () => {
    // Refusing the rejection would leave the contradiction in the log with no way to resolve
    // it: rejection is the mechanism for correcting exactly this.
    const { log } = legacyLockedEmptySet('candidates-found', { declared: true });
    const set = approveCandidateSet(log, {
      agency: 'TPK', category: CAT, approved: false, note: 'evidence conflict',
    });
    assert.equal(set.approval, APPROVAL.REJECTED);
    assert.equal(set.approvalNote, 'evidence conflict');
  });

  test('a consistent legacy set still approves, including its disclosed later declaredAt', () => {
    const { log } = legacyLockedEmptySet('no-candidates', { declared: true });
    const set = approveCandidateSet(log, { agency: 'TPK', category: CAT, approved: true });
    assert.equal(set.approval, APPROVAL.APPROVED);
    // The migration is disclosed, not hidden: declaredAt is later than lockedAt, on purpose.
    assert.ok(Date.parse(set.declaredAt) > Date.parse(set.lockedAt));
  });

  test('approval revalidates against the records the set is BOUND to, not merely its round', () => {
    // A set bound to one record while another exists for the same round: the binding is the
    // claim, so the binding is what gets rechecked.
    const log = emptyLog();
    const clean = addDiscovery(log, {
      agency: 'TPK', category: CAT, outcome: 'no-candidates', url: 'https://w.govt.nz/d-clean',
    });
    const dirty = addDiscovery(log, {
      agency: 'TPK', category: CAT, outcome: 'candidates-found', url: 'https://w.govt.nz/d-dirty',
    });
    log.candidateSets[`TPK\u0000${CAT}`] = {
      agency: 'TPK', category: CAT, version: 1,
      discovered: [], locked: [], ordered: [], droppedBeyondBound: [],
      lockedAt: '2026-09-24T10:00:00Z', approval: APPROVAL.PENDING,
      candidateDeclaration: 'none', declaredAt: '2026-09-25T02:57:32Z',
      discoveryRecordIds: [dirty.id], discoveryMethods: ['navigation'],
    };
    assert.throws(
      () => approveCandidateSet(log, { agency: 'TPK', category: CAT, approved: true }),
      new RegExp(`report candidates-found \\(${dirty.id}\\)`)
    );
    assert.ok(clean.id, 'the clean record exists but is not what this set claims');
  });
});
