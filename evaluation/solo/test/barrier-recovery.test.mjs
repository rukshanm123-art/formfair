/**
 * Amendment 50, in the sealer: which attrition records actually cost coverage.
 *
 * The seal is the authority, so it re-derives the resolution rather than trusting the capture
 * log's. That derivation counted every attrition record, including barriers the frozen headed
 * fallback had already cleared - so a draft whose pages were all read could still be refused, or
 * sealed under `technical-discovery-attrition`, which asserts the agency's discovery was
 * incomplete. Study-wide that reading turned 40 recovered barriers into evidence of an incomplete
 * search.
 *
 * `unresolvedAttrition` is the sealer's own derivation. It may not import the capture package, so
 * the agreement between the two is held together only by tests - the cross-implementation
 * assertions live in `capture/test/barrier-accounting.test.mjs`, and what follows is the
 * sealer-side behaviour: that it is STRICTER than capture wherever it cannot establish a link, and
 * that it fails towards the weaker resolution rather than assuming the stronger one.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unresolvedAttrition, TECHNICAL_ATTRITION_OUTCOMES } from '../descriptive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AGENCY = 'Ministry for Culture and Heritage';
const CAT = 'account-registration';
const URL_A = 'https://28maoribattalion.org.nz/';

const barred = (over = {}) => ({
  id: 'd-0001', status: 'discovery', recordType: 'observation', outcome: 'retrieval-blocked',
  agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A, ...over,
});
const headed = (over = {}) => ({
  id: 'd-0002', status: 'discovery', recordType: 'observation', outcome: 'rendered',
  agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
  followsDiscoveryId: 'd-0001', ...over,
});
const judged = (over = {}) => ({
  id: 'd-0003', status: 'discovery', recordType: 'judgement-only', outcome: 'no-candidates',
  agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
  answersDiscoveryId: 'd-0002', ...over,
});

const ids = (records) => records.map((a) => a.id).sort();

describe('the sealer derives recovery itself', () => {
  test('a cleared barrier is not what makes a search incomplete', () => {
    const r = unresolvedAttrition([barred(), headed(), judged()]);
    assert.deepEqual(ids(r.recovered), ['d-0001']);
    assert.deepEqual(ids(r.unresolved), []);
    // Nothing is lost from the accounting - it is partitioned, not filtered.
    assert.equal(r.attrition.length, r.recovered.length + r.unresolved.length);
  });

  test('an unresolved barrier is still reported', () => {
    const r = unresolvedAttrition([barred()]);
    assert.deepEqual(ids(r.unresolved), ['d-0001']);
  });

  test('robots-unestablished can never be recovered', () => {
    // No permission was established, so nothing was read under one. A later render of the same
    // URL cannot make a policy that was never established into one that was.
    const unestablished = { ...barred({ id: 'd-0010', outcome: 'robots-unestablished' }) };
    const r = unresolvedAttrition([
      unestablished,
      headed({ id: 'd-0011', followsDiscoveryId: 'd-0010' }),
      judged({ id: 'd-0012', answersDiscoveryId: 'd-0011' }),
    ]);
    assert.deepEqual(ids(r.unresolved), ['d-0010']);
    assert.deepEqual(ids(r.recovered), []);
  });

  test('retrieval-inconclusive is not recoverable either', () => {
    const r = unresolvedAttrition([
      barred({ id: 'd-0020', outcome: 'retrieval-inconclusive' }),
      headed({ id: 'd-0021', followsDiscoveryId: 'd-0020' }),
      judged({ id: 'd-0022', answersDiscoveryId: 'd-0021' }),
    ]);
    assert.deepEqual(ids(r.unresolved), ['d-0020']);
  });

  test('every attrition outcome it knows about is one of the frozen three', () => {
    assert.deepEqual(
      [...TECHNICAL_ATTRITION_OUTCOMES].sort(),
      ['retrieval-blocked', 'retrieval-inconclusive', 'robots-unestablished']
    );
  });
});

describe('where it cannot establish a recovery it reports the weaker resolution', () => {
  test('an unlinked later render leaves the barrier open', () => {
    const r = unresolvedAttrition([barred(), headed({ followsDiscoveryId: undefined }), judged()]);
    assert.deepEqual(ids(r.unresolved), ['d-0001']);
  });

  test('an unjudged render leaves it open', () => {
    const r = unresolvedAttrition([barred(), headed()]);
    assert.deepEqual(ids(r.unresolved), ['d-0001']);
  });

  test('it requires the URLs to match exactly, which capture reaches by canonicalising', () => {
    // Deliberate asymmetry. The sealer has no canonicaliser and must not grow one to agree: a
    // trailing-slash difference it cannot resolve makes it report attrition the capture package
    // might have cleared, and erring towards "incomplete" is the safe direction for a seal. All
    // 50 follow-up links in the live log carry byte-identical URLs, so the two do not diverge in
    // practice; this records what happens if they ever do.
    const r = unresolvedAttrition([
      barred({ url: 'https://28maoribattalion.org.nz/' }),
      headed({ url: 'https://28maoribattalion.org.nz' }),
      judged(),
    ]);
    assert.deepEqual(ids(r.unresolved), ['d-0001']);
  });

  test('a withdrawn recovery reopens the barrier', () => {
    const r = unresolvedAttrition([
      barred(), headed(), judged(),
      { id: 'd-0004', status: 'discovery', outcome: 'rendered', agency: AGENCY, category: CAT,
        candidateSetVersion: 1, url: URL_A, supersedesDiscoveryId: 'd-0002' },
    ]);
    assert.deepEqual(ids(r.unresolved), ['d-0001']);
  });

  test('a withdrawn barrier is not attrition at all', () => {
    const r = unresolvedAttrition([
      barred(),
      { id: 'd-0005', status: 'discovery', recordType: 'reclassification', outcome: 'rendered',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_A,
        supersedesDiscoveryId: 'd-0001' },
    ]);
    assert.deepEqual(r.attrition, []);
  });
});

describe('it reads only the records bound to the round', () => {
  test('an unbound barrier does not bear on the resolution', () => {
    // A record no locked set claims is not part of the round the exhaustion rests on.
    const attempts = [barred({ id: 'd-0001' }), barred({ id: 'd-0002' })];
    const bound = new Set(['d-0001']);
    assert.deepEqual(ids(unresolvedAttrition(attempts, { bound }).unresolved), ['d-0001']);
    assert.deepEqual(ids(unresolvedAttrition(attempts).unresolved), ['d-0001', 'd-0002']);
  });

  test('a caller may pass the superseded set it already computed', () => {
    const attempts = [barred()];
    assert.deepEqual(unresolvedAttrition(attempts, { superseded: new Set(['d-0001']) }).attrition, []);
  });

  test('a non-discovery record is never attrition', () => {
    const r = unresolvedAttrition([barred({ status: 'capture-blocked' })]);
    assert.deepEqual(r.attrition, []);
  });
});

describe('the sealer stays an independent implementation', () => {
  test('descriptive.mjs does not import the capture package', () => {
    // The whole point of re-deriving this is defeated if the derivation is borrowed.
    const src = readFileSync(join(here, '..', 'descriptive.mjs'), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    const borrowed = imports.filter((p) => /(^|\/)capture\//.test(p) || p.includes('capture/run.mjs'));
    assert.deepEqual(borrowed, [], `the sealer must not import from capture/: ${borrowed.join(', ')}`);
  });
});
