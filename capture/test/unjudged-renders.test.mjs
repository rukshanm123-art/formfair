/**
 * Amendment 39: a rendered observation must be read before the round that retrieved it is locked.
 *
 * `render-discovery` writes an observation whose outcome is `rendered` and which concludes
 * nothing by design; `classify-render` writes the conclusion as a separate record. Nothing
 * required the second to exist. Sixteen rendered observations sat unjudged in the NZDF
 * account-registration round while `status` reported the candidate set as the only outstanding
 * work - so a set could be locked and approved over evidence that had been retrieved and never
 * read. `renderBacklog` did not catch it: that covers the retrospective obligation over
 * plain-retrieval records, not the forward one.
 *
 * Both implementations are driven over the same cases and must agree, because the capture package
 * gates at lock and approval while the sealer gates at seal, and a round reaching the sealer by
 * another route must still fail.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  unjudgedRenderedObservations, corpusBlockers, emptyLog,
  recordCandidates, lockCandidateSet, approveCandidateSet,
} from '../run.mjs';
import { unjudgedRenderProblems } from '../../evaluation/solo/descriptive.mjs';

const AGENCY = 'New Zealand Defence Force';
const CAT = 'account-registration';

const observation = (over = {}) => ({
  id: 'd-0001', status: 'discovery', recordType: 'observation', outcome: 'rendered',
  agency: AGENCY, category: CAT, candidateSetVersion: 1,
  url: 'https://w.govt.nz/', renderId: 'g-0001', discoveryKind: 'navigation', ...over,
});

const judgement = (over = {}) => ({
  id: 'd-0002', status: 'discovery', recordType: 'judgement-only', outcome: 'no-candidates',
  agency: AGENCY, category: CAT, candidateSetVersion: 1,
  url: 'https://w.govt.nz/', renderId: 'g-0001',
  answersDiscoveryId: 'd-0001', evidenceFromDiscoveryId: 'd-0001', ...over,
});

/** Both implementations, over one log. They must agree on whether it is clean. */
const verdicts = (attempts) => {
  const log = { ...emptyLog(), attempts };
  const capture = unjudgedRenderedObservations(log);
  const sealer = unjudgedRenderProblems(log);
  assert.equal(
    capture.length > 0, sealer.length > 0,
    `the two implementations disagree:\n  capture: ${JSON.stringify(capture)}\n  sealer:  ${JSON.stringify(sealer)}`
  );
  return { capture, sealer, clean: capture.length === 0 };
};

describe('a rendered observation must be judged', () => {
  test('a render with its judgement is clean', () => {
    assert.ok(verdicts([observation(), judgement()]).clean);
  });

  test('a render with NO judgement is caught', () => {
    const { capture, clean } = verdicts([observation()]);
    assert.equal(clean, false);
    assert.match(capture[0], /was rendered but never judged/);
    assert.match(capture[0], /d-0001/);
  });

  test('deleting the judgement re-opens the finding', () => {
    // The attack: judge, then remove the judgement record and lock anyway.
    assert.ok(verdicts([observation(), judgement()]).clean);
    assert.equal(verdicts([observation()]).clean, false);
  });

  test('a judgement naming a different render does not answer this observation', () => {
    const { capture, clean } = verdicts([observation(), judgement({ renderId: 'g-0099' })]);
    assert.equal(clean, false);
    assert.match(capture[0], /whose render is "g-0099" and not "g-0001"/);
  });

  test('a judgement naming a different URL does not answer this observation', () => {
    const { capture, clean } = verdicts([observation(), judgement({ url: 'https://elsewhere.govt.nz/' })]);
    assert.equal(clean, false);
    assert.match(capture[0], /whose URL is/);
  });

  test('a judgement for another round leaves this one unanswered', () => {
    const { capture, clean } = verdicts([observation(), judgement({ candidateSetVersion: 2 })]);
    assert.equal(clean, false);
    assert.match(capture[0], /none concludes this observation's own round/);
  });

  test('two active judgements for the same category are refused', () => {
    const { capture, clean } = verdicts([
      observation(), judgement(), judgement({ id: 'd-0003', outcome: 'candidates-found' }),
    ]);
    assert.equal(clean, false);
    assert.match(capture[0], /2 active judgements for its own category/);
    // Both are named, so the reviewer can see the disagreement rather than just its count.
    assert.match(capture[0], /d-0002/);
    assert.match(capture[0], /d-0003/);
  });

  test('a superseded duplicate is not a duplicate', () => {
    // The corrected judgement is preserved in the log and must not count against its replacement.
    assert.ok(verdicts([
      observation(),
      judgement(),
      judgement({ id: 'd-0003', supersedesDiscoveryId: 'd-0002' }),
    ]).clean);
  });

  test('one render legitimately carries a judgement per category', () => {
    // `d-0315` carries three. Uniqueness is per category, not per observation.
    assert.ok(verdicts([
      observation(),
      judgement(),
      judgement({ id: 'd-0003', category: 'service-application' }),
      judgement({ id: 'd-0004', category: 'enquiry-or-contact' }),
    ]).clean);
  });

  test('a retrospective judgement answers the plain record and cites the observation', () => {
    // The whole retrospective pass is shaped this way: `d-0377` answers `d-0018` and cites
    // `d-0310`. Testing the answer link alone condemned all fifty-seven of them.
    assert.ok(verdicts([
      { id: 'd-0018', status: 'discovery', outcome: 'no-candidates', agency: AGENCY, category: CAT,
        candidateSetVersion: 1, url: 'https://w.govt.nz/', discoveryKind: 'navigation' },
      observation({ id: 'd-0310' }),
      judgement({ id: 'd-0377', answersDiscoveryId: 'd-0018', evidenceFromDiscoveryId: 'd-0310' }),
    ]).clean);
  });

  test('a superseded observation needs no judgement', () => {
    assert.ok(verdicts([
      observation(),
      observation({ id: 'd-0005', supersedesDiscoveryId: 'd-0001' }),
      judgement({ id: 'd-0006', answersDiscoveryId: 'd-0005', evidenceFromDiscoveryId: 'd-0005' }),
    ]).clean);
  });
});

describe('what does not require a judgement', () => {
  test('a retrieval-blocked observation concludes nothing and needs nothing', () => {
    // Nothing was read, so there is nothing to conclude. The Air Force Museum is this case in
    // both browser modes.
    assert.ok(verdicts([observation({ outcome: 'retrieval-blocked' })]).clean);
  });

  test('robots-unestablished and disallowed records need no judgement', () => {
    assert.ok(verdicts([
      observation({ id: 'd-0007', outcome: 'robots-unestablished' }),
      observation({ id: 'd-0008', outcome: 'disallowed' }),
    ]).clean);
  });

  test('a SUCCESSFUL headed fallback is held to the rule', () => {
    // CadetNet: headless was barred, the headed continuation read the page. The second record
    // reports `rendered` and must be judged like any other retrieval.
    const barred = observation({ id: 'd-0009', outcome: 'retrieval-blocked', renderId: 'g-0074' });
    const headed = observation({ id: 'd-0010', renderId: 'g-0075', followsDiscoveryId: 'd-0009' });
    const { capture, clean } = verdicts([barred, headed]);
    assert.equal(clean, false, 'a successful headed fallback must still need a judgement');
    assert.match(capture[0], /d-0010/);
    assert.ok(!capture.some((p) => p.includes('d-0009')), 'the barred attempt must not be flagged');

    assert.ok(verdicts([
      barred, headed,
      judgement({ id: 'd-0011', renderId: 'g-0075', answersDiscoveryId: 'd-0010', evidenceFromDiscoveryId: 'd-0010' }),
    ]).clean);
  });
});

describe('the gate is wired into the corpus blockers', () => {
  test('an unjudged render blocks the corpus draft', () => {
    const log = { ...emptyLog(), attempts: [observation()] };
    const blocker = corpusBlockers(log).find((b) => b.kind === 'unjudged-renders');
    assert.ok(blocker, 'corpusBlockers does not report unjudged renders');
    assert.match(blocker.summary, /1 rendered observation\(s\) have no matching judgement/);
  });

  test('and stops blocking once it is judged', () => {
    const log = { ...emptyLog(), attempts: [observation(), judgement()] };
    assert.equal(corpusBlockers(log).find((b) => b.kind === 'unjudged-renders'), undefined);
  });
});

describe('the gate refuses the two operations it exists to stop', () => {
  const roundWith = (attempts) => {
    const log = emptyLog();
    log.attempts.push(...attempts);
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    return log;
  };

  test('a round with an unread render cannot be locked', () => {
    const log = roundWith([observation({ id: 'd-0100', outcome: 'candidates-found', recordType: undefined }), observation()]);
    assert.throws(
      () => lockCandidateSet(log, { agency: AGENCY, category: CAT }),
      /rendered evidence that was never judged/
    );
  });

  /**
   * A set that reached approval WITHOUT passing through `lockCandidateSet` - the route the
   * approval-time copy of the check exists for. Deleting a bound judgement is already refused
   * earlier, by the binding check, so it cannot be used to reach this one.
   */
  const preLockedRound = () => {
    const log = emptyLog();
    const supporting = observation({
      id: 'd-0100', outcome: 'candidates-found', recordType: undefined,
      url: 'https://w.govt.nz/x', renderId: undefined,
    });
    log.attempts.push(supporting, observation());
    log.candidateSets[`${AGENCY}\u0000${CAT}`] = {
      agency: AGENCY, category: CAT, version: 1,
      discovered: ['https://w.govt.nz/x'], locked: ['https://w.govt.nz/x'], ordered: ['https://w.govt.nz/x'],
      lockedAt: '2026-09-29T00:00:00Z', approval: 'pending', candidateDeclaration: null,
      droppedBeyondBound: [], discoveryRecordIds: ['d-0100'], discoveryMethods: ['navigation'],
    };
    return log;
  };

  test('and cannot be approved even if it reached approval another way', () => {
    assert.throws(
      () => approveCandidateSet(preLockedRound(), { agency: AGENCY, category: CAT, approved: true }),
      /rests on rendered evidence that was never judged/
    );
  });

  test('rejection is never gated, so a contradictory round stays resolvable', () => {
    const set = approveCandidateSet(preLockedRound(), { agency: AGENCY, category: CAT, approved: false });
    assert.equal(set.approval, 'rejected');
  });
});
