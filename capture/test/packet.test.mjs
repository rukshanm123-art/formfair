/**
 * The approval packet.
 *
 * The researcher approves every candidate set. That approval only means something if what
 * is being approved can be read quickly, so this checks the packet states the facts a
 * reviewer decides on - including the ones that are easy to bury.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLog, recordCandidates, lockCandidateSet, approveCandidateSet, supersedeCandidateSet } from '../run.mjs';
import { buildPacket, renderPacket } from '../packet.mjs';
import { addDiscovery } from './helpers.mjs';

const AGENCY = 'Te Puni Kōkiri';
const CAT = 'account-registration';

function build({ candidates = ['https://ex.govt.nz/register'], robotsOutcome = 'no-candidates' } = {}) {
  const log = emptyLog();
  addDiscovery(log, { agency: AGENCY, category: CAT, url: 'https://ex.govt.nz/robots.txt', method: 'robots', outcome: robotsOutcome });
  addDiscovery(log, { agency: AGENCY, category: CAT, url: 'https://ex.govt.nz/sitemap.xml', method: 'sitemap', outcome: 'unavailable' });
  addDiscovery(log, { agency: AGENCY, category: CAT, url: 'https://ex.govt.nz/', method: 'navigation', outcome: 'candidates-found' });
  addDiscovery(log, { agency: AGENCY, category: CAT, url: 'https://ex.govt.nz/search', method: 'internal-search', outcome: 'no-candidates' });
  recordCandidates(log, { agency: AGENCY, category: CAT, urls: candidates });
  lockCandidateSet(log, { agency: AGENCY, category: CAT });
  return log;
}

describe('the approval packet', () => {
  test('it reports what each method established, not only what was found', () => {
    // A set with one candidate and a set with one candidate after three dead methods are
    // different things to approve, and the difference is what a reviewer needs.
    const p = buildPacket(build(), { agency: AGENCY, category: CAT });
    assert.equal(p.inspections, 4);
    const outcomes = p.websites[0].inspections.map((i) => i.outcome);
    assert.ok(outcomes.includes('unavailable'));
    assert.ok(outcomes.includes('no-candidates'));
    assert.ok(outcomes.includes('candidates-found'));
  });

  test('a candidate on a host with robots restrictions is called out, not buried', () => {
    const p = buildPacket(build({ robotsOutcome: 'disallowed' }), { agency: AGENCY, category: CAT });
    const flagged = p.anomalies.filter((a) => a.startsWith('CANDIDATE ON A RESTRICTED HOST'));
    assert.equal(flagged.length, 1);
    assert.match(flagged[0], /may exclude it without retrieval/);
    // And it is a warning, not a verdict: assessment re-reads robots and decides.
    assert.doesNotMatch(flagged[0], /is disallowed|will be excluded/);
  });

  test('a missing discovery method is reported as missing', () => {
    const log = emptyLog();
    addDiscovery(log, { agency: AGENCY, category: CAT, url: 'https://ex.govt.nz/', method: 'navigation', outcome: 'candidates-found' });
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://ex.govt.nz/a'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    const p = buildPacket(log, { agency: AGENCY, category: CAT });
    for (const method of ['sitemap', 'internal-search', 'robots']) {
      assert.ok(p.anomalies.some((a) => a === `no ${method} inspection was recorded for this round`), `missing ${method} not reported`);
    }
  });

  test('superseded rounds are shown with their reasons', () => {
    const log = build();
    approveCandidateSet(log, { agency: AGENCY, category: CAT, approved: false });
    supersedeCandidateSet(log, { agency: AGENCY, category: CAT, reason: 'incomplete provenance' });
    addDiscovery(log, { agency: AGENCY, category: CAT, version: 2, method: 'navigation', outcome: 'candidates-found' });
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://ex.govt.nz/b'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    const p = buildPacket(log, { agency: AGENCY, category: CAT });
    assert.equal(p.version, 2);
    assert.equal(p.supersededRounds.length, 1);
    assert.match(p.supersededRounds[0].reason, /incomplete provenance/);
  });

  test('it says what approving does and does not mean', () => {
    const text = renderPacket(buildPacket(build(), { agency: AGENCY, category: CAT }));
    assert.match(text, /not that any candidate is eligible/);
    assert.match(text, /This set is pending/);
  });

  test('a category that yields nothing says so plainly', () => {
    const log = emptyLog();
    addDiscovery(log, { agency: AGENCY, category: CAT, method: 'navigation', outcome: 'no-candidates' });
    // selection-v1.0.4: an empty set is declared, so that it cannot be confused with a
    // category nobody searched.
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: [], declaration: 'none' });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    const text = renderPacket(buildPacket(log, { agency: AGENCY, category: CAT }));
    // selection-v1.0.21: the claim now states its own basis. It may only say the category yields
    // nothing when every inspection was actually READ; where an origin could not be read, the
    // same sentence would be a prevalence finding no inspection supports.
    assert.match(text, /none - every inspection was read, and this category yields no eligible form/);
  });
});
