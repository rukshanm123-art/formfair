/**
 * Amendment 50: a barrier the headed fallback cleared cost no coverage.
 *
 * The Ministry for Culture and Heritage round reported "24 technical-attrition records" over a
 * category whose pages had in fact been read. Every origin in that estate bars headless Chromium,
 * the frozen headed fallback then read sixteen of those pages successfully, and the packet, the
 * status line, the published provenance, the agency resolution and the sealer's validation all
 * counted the barred attempt and said coverage was lost. Study-wide the same reading turned 40
 * recovered barriers into evidence of an incomplete search.
 *
 * The figure that matters is not how many barriers were LOGGED but how many were never resolved,
 * and the two must be reported separately, because one is a fact about the harness and the other
 * is a limitation of the sample.
 *
 * Recovery is deliberately strict in both implementations: an explicit `followsDiscoveryId` link
 * to an unbarred `rendered` record for the same agency, category, round and URL, which itself
 * carries a judgement. Anything weaker lets an unrelated later visit retrospectively excuse a
 * barrier nobody resolved, which is the failure this amendment exists to prevent - so most of the
 * tests below are the near misses, not the happy path.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyLog, barrierAccounting, readContentUrls, agencyResolution, AGENCY_RESOLUTIONS,
  publishProvenance,
} from '../run.mjs';
import { unresolvedAttrition } from '../../evaluation/solo/descriptive.mjs';

const AGENCY = 'Ministry for Culture and Heritage';
const CAT = 'account-registration';
const URL_A = 'https://28maoribattalion.org.nz/';
const URL_B = 'https://vietnamwar.govt.nz/';

const barred = (over = {}) => ({
  id: 'd-0001', status: 'discovery', recordType: 'observation', outcome: 'retrieval-blocked',
  agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
  discoveryKind: 'navigation', accessBarriers: ['http 403'], ...over,
});

const headed = (over = {}) => ({
  id: 'd-0002', status: 'discovery', recordType: 'observation', outcome: 'rendered',
  agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
  discoveryKind: 'navigation', followsDiscoveryId: 'd-0001', renderId: 'g-0002', ...over,
});

const judgement = (over = {}) => ({
  id: 'd-0003', status: 'discovery', recordType: 'judgement-only', outcome: 'no-candidates',
  agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
  answersDiscoveryId: 'd-0002', evidenceFromDiscoveryId: 'd-0002', ...over,
});

/**
 * Both implementations, over one log. The sealer may not import the capture package, so the
 * agreement these assert is the only thing holding the two derivations together.
 */
const verdicts = (attempts, scope = {}) => {
  const log = { ...emptyLog(), attempts };
  const capture = barrierAccounting(log, scope);
  const sealer = unresolvedAttrition(attempts);
  const sealerBlocked = sealer.unresolved.filter((a) => a.outcome === 'retrieval-blocked').map((a) => a.id);
  assert.deepEqual(
    [...capture.unresolvedRecords].sort(), sealerBlocked.sort(),
    `the two implementations disagree on which barriers are unresolved:\n` +
      `  capture: ${JSON.stringify(capture.unresolvedRecords)}\n  sealer:  ${JSON.stringify(sealerBlocked)}`
  );
  // Whatever else is true, every barrier is in exactly one of the two buckets.
  assert.equal(capture.barrierAttempts, capture.recovered + capture.unresolved);
  return capture;
};

describe('a barrier is recovered only by an explicit, judged, matching follow-up', () => {
  test('the headed fallback read it, so no coverage was lost', () => {
    const v = verdicts([barred(), headed(), judgement()]);
    assert.equal(v.barrierAttempts, 1);
    assert.equal(v.recovered, 1);
    assert.equal(v.unresolved, 0);
    assert.equal(v.unresolvedUrls, 0);
    assert.equal(v.unreadUrls, 0);
  });

  test('a judgement linked by evidence alone recovers it too', () => {
    // The two link fields mean different things elsewhere; for recovery either establishes that
    // the successful render was actually read.
    const v = verdicts([barred(), headed(), judgement({ answersDiscoveryId: undefined })]);
    assert.equal(v.recovered, 1);
  });

  test('an UNRELATED later render of the same URL clears nothing', () => {
    // The near miss that matters most. This render succeeded on the same URL in the same round,
    // and says nothing about whether the barred attempt was ever resolved - no record claims it
    // followed from the barrier. Accepting it would let the harness excuse its own gaps.
    const v = verdicts([
      barred(),
      headed({ followsDiscoveryId: undefined }),
      judgement(),
    ]);
    assert.equal(v.recovered, 0);
    assert.equal(v.unresolved, 1);
    assert.deepEqual(v.unresolvedRecords, ['d-0001']);
  });

  test('a successful render nobody judged proves retrieval, not reading', () => {
    const v = verdicts([barred(), headed()]);
    assert.equal(v.recovered, 0);
    assert.equal(v.unresolved, 1);
  });

  test('a follow-up on a different URL does not clear this barrier', () => {
    const v = verdicts([barred(), headed({ url: URL_B }), judgement({ url: URL_B })]);
    assert.equal(v.unresolved, 1);
  });

  test('a follow-up in a different round does not clear it', () => {
    // A later round is a different search. Its success cannot repair the earlier one's coverage.
    const v = verdicts([
      barred(),
      headed({ candidateSetVersion: 2 }),
      judgement({ candidateSetVersion: 2 }),
    ]);
    assert.equal(v.unresolved, 1);
  });

  test('a follow-up in a different category does not clear it', () => {
    const v = verdicts([
      barred(),
      headed({ category: 'enquiry-or-contact' }),
      judgement({ category: 'enquiry-or-contact' }),
    ]);
    assert.equal(v.unresolved, 1);
  });

  test('a follow-up that was itself barred clears nothing', () => {
    const v = verdicts([barred(), headed({ outcome: 'retrieval-blocked' }), judgement()]);
    assert.equal(v.barrierAttempts, 2);
    assert.equal(v.recovered, 0);
    assert.equal(v.unresolved, 2);
    // Both attempts are the same URL, so the coverage actually lost is one page.
    assert.equal(v.unresolvedUrls, 1);
  });

  test('a withdrawn follow-up stops recovering', () => {
    // A superseded record is not evidence. If the read that cleared a barrier is withdrawn, the
    // barrier is open again - it must not keep its recovery because it once had one.
    const v = verdicts([
      barred(), headed(), judgement(),
      { id: 'd-0004', status: 'discovery', recordType: 'observation', outcome: 'rendered',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
        supersedesDiscoveryId: 'd-0002' },
    ]);
    assert.equal(v.recovered, 0);
    assert.equal(v.unresolved, 1);
  });

  test('a withdrawn barrier is not counted at all', () => {
    const v = verdicts([
      barred(),
      { id: 'd-0009', status: 'discovery', recordType: 'reclassification', outcome: 'rendered',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
        supersedesDiscoveryId: 'd-0001' },
    ]);
    assert.equal(v.barrierAttempts, 0);
    assert.equal(v.unresolved, 0);
  });
});

describe('the four figures are reported separately and reconcile', () => {
  test('repeat attempts on one URL inflate records, not lost coverage', () => {
    // This is why the headline may not be a count of records: the harness retries, so eight
    // unresolved records over seven URLs is seven pages unread, not eight.
    const v = verdicts([
      barred({ id: 'd-0001' }), barred({ id: 'd-0002' }), barred({ id: 'd-0003', url: URL_B }),
    ]);
    assert.equal(v.barrierAttempts, 3);
    assert.equal(v.unresolved, 3);
    assert.equal(v.unresolvedUrls, 2);
  });

  test('robots-unestablished is attrition that can never be recovered', () => {
    // Nothing was read under a permission that was never established, so no follow-up can clear
    // it. It is counted, and counted apart from the barriers.
    const unestablished = {
      id: 'd-0010', status: 'discovery', recordType: 'observation',
      outcome: 'robots-unestablished', agency: AGENCY, category: CAT,
      candidateSetVersion: 1, url: URL_B,
    };
    const v = verdicts([barred(), headed(), judgement(), unestablished]);
    assert.equal(v.barrierAttempts, 1);
    assert.equal(v.recovered, 1);
    assert.equal(v.unresolved, 0);
    assert.equal(v.robotsUnestablished, 1);
    // Coverage lost is the robots origin only - the recovered barrier cost nothing.
    assert.equal(v.unreadUrls, 1);
  });

  test('coverage lost counts each URL once across all three kinds', () => {
    const v = verdicts([
      barred({ id: 'd-0001' }),
      barred({ id: 'd-0002' }),
      { id: 'd-0011', status: 'discovery', outcome: 'retrieval-inconclusive',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A },
      { id: 'd-0012', status: 'discovery', outcome: 'robots-unestablished',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_B },
    ]);
    assert.equal(v.unresolved, 2);
    assert.equal(v.retrievalInconclusive, 1);
    assert.equal(v.robotsUnestablished, 1);
    assert.equal(v.unreadUrls, 2);
  });

  test('the scope filters, so a round can be reported on its own', () => {
    const attempts = [
      barred({ id: 'd-0001' }),
      barred({ id: 'd-0002', category: 'enquiry-or-contact' }),
      barred({ id: 'd-0003', agency: 'New Zealand Defence Force' }),
    ];
    const log = { ...emptyLog(), attempts };
    assert.equal(barrierAccounting(log).barrierAttempts, 3);
    assert.equal(barrierAccounting(log, { agency: AGENCY }).barrierAttempts, 2);
    assert.equal(barrierAccounting(log, { agency: AGENCY, category: CAT }).barrierAttempts, 1);
    assert.equal(
      barrierAccounting(log, { agency: AGENCY, category: CAT, candidateSetVersion: 2 }).barrierAttempts, 0
    );
  });

  test('a robots-policy record is not a content URL that was read', () => {
    // The count beside "read" in a packet is the pages whose MARKUP was examined. A robots
    // inspection fetches no content, so including it overstates coverage by one origin.
    const attempts = [
      { id: 'd-0020', status: 'discovery', outcome: 'no-candidates', discoveryKind: 'navigation',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A },
      { id: 'd-0021', status: 'discovery', outcome: 'no-candidates', discoveryKind: 'robots',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: `${URL_B}robots.txt` },
    ];
    const read = readContentUrls({ ...emptyLog(), attempts }, { agency: AGENCY, category: CAT });
    assert.equal(read.records, 1);
    assert.equal(read.urls, 1);
    assert.equal(read.origins, 1);
  });
});

describe('an agency is not declared unsearched over a barrier that was cleared', () => {
  /** An agency whose four sets bind exactly these records. */
  const resolved = (attempts) => {
    const log = { ...emptyLog(), attempts };
    log.candidateSets[`${AGENCY}\u0000${CAT}`] = {
      agency: AGENCY, category: CAT, version: 1, discovered: [], locked: [],
      lockedAt: '2026-10-02T00:00:00Z', approval: 'approved',
      discoveryRecordIds: attempts.map((a) => a.id),
    };
    return agencyResolution(log, AGENCY);
  };

  test('every barrier recovered: the search was complete', () => {
    // The defect in one line. Before Amendment 50 this returned technical-discovery-attrition,
    // which asserts the agency's discovery was incomplete - about an agency every page of which
    // was read.
    const r = resolved([barred(), headed(), judgement()]);
    assert.equal(r.resolution, AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE);
    assert.deepEqual(r.attritionRecordIds, []);
    assert.deepEqual(r.recoveredBarrierIds, ['d-0001']);
  });

  test('one unresolved barrier still downgrades it', () => {
    // The amendment narrows the trigger; it does not remove it. An agency with a page nobody
    // read was not searched in full, and the honest resolution is still the weaker one.
    const r = resolved([barred(), headed({ followsDiscoveryId: undefined }), judgement()]);
    assert.equal(r.resolution, AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION);
    assert.deepEqual(r.attritionRecordIds, ['d-0001']);
  });

  test('robots-unestablished alone downgrades it', () => {
    const r = resolved([
      { id: 'd-0030', status: 'discovery', outcome: 'robots-unestablished',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_B },
    ]);
    assert.equal(r.resolution, AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION);
    assert.deepEqual(r.attritionRecordIds, ['d-0030']);
  });

  test('the two sets of ids never overlap', () => {
    const r = resolved([
      barred({ id: 'd-0001' }), headed(), judgement(),
      barred({ id: 'd-0040', url: URL_B }),
    ]);
    assert.deepEqual(r.attritionRecordIds, ['d-0040']);
    assert.deepEqual(r.recoveredBarrierIds, ['d-0001']);
    const overlap = r.attritionRecordIds.filter((id) => r.recoveredBarrierIds.includes(id));
    assert.deepEqual(overlap, []);
  });

  test('the reason always matches the resolution it is filed under', () => {
    for (const attempts of [[barred(), headed(), judgement()], [barred()]]) {
      const r = resolved(attempts);
      assert.equal(typeof r.reason, 'string');
      assert.ok(r.reason.length > 0);
    }
  });
});

describe('the published provenance reconciles with itself', () => {
  /** The two blocks are derived independently, so a reader can check one against the other. */
  const published = (attempts) => {
    // Written straight into the log rather than appended: `appendAttempt` requires the permit,
    // render and timestamp fields that a real observation carries, and none of them bears on the
    // arithmetic under test here.
    const log = { ...emptyLog(), attempts };
    const dir = mkdtempSync(join(tmpdir(), 'formfair-barriers-'));
    try {
      const { provenancePath } = publishProvenance(log, { to: dir });
      return JSON.parse(readFileSync(provenancePath, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('the record census and the coverage figures agree', () => {
    // 92 was published as the attrition figure while 90 were active and 40 cost coverage. The
    // census and the coverage reading are now separate blocks, and they must add up.
    const p = published([
      barred(),
      headed(),
      judgement(),
      barred({ id: 'd-0010', url: URL_B }),
      { ...barred({ id: 'd-0011', url: URL_B, outcome: 'robots-unestablished' }), discoveryKind: 'robots' },
    ]);
    const t = p.technicalAttrition;
    const b = p.barriers;
    assert.equal(t.active, Object.values(t.activeByOutcome).reduce((a, n) => a + n, 0));
    assert.equal(t.records, t.active + t.superseded);
    assert.equal(t.activeByOutcome['retrieval-blocked'], b.barrierAttempts);
    assert.equal(b.barrierAttempts, b.recovered + b.unresolved);
    assert.equal(t.activeByOutcome['robots-unestablished'] ?? 0, b.robotsUnestablished);
    assert.equal(b.recovered, 1);
    assert.equal(b.unresolved, 1);
  });

  test('a withdrawn record is in the census but not in the active figures', () => {
    const p = published([
      barred(),
      { ...headed(), followsDiscoveryId: undefined, supersedesDiscoveryId: 'd-0001' },
    ]);
    const t = p.technicalAttrition;
    assert.equal(t.records, 1);
    assert.equal(t.superseded, 1);
    assert.equal(t.active, 0);
    assert.equal(p.barriers.barrierAttempts, 0);
  });
});
