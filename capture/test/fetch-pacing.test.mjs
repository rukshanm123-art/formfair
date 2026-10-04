/**
 * Amendment 64: a plain-resource fetch is traffic.
 *
 * `read-resource` requested with no pacing of any kind - no `beforeNavigation`, no seed, nothing -
 * and `lastNavigation` counted only `log.attempts`, so a fetch was invisible to the floor until an
 * outcome record was written for it. Two sitemap documents were therefore requested **one second
 * apart** against the five-second floor this study publishes in `provenance.json`, and the breach
 * surfaced only when the second outcome record was refused - after both requests had been made.
 *
 * That is the Amendment 62 lesson again: an obligation on traffic has to be honoured before the
 * traffic, not discovered afterwards. The floor is now waited out in `read-resource`, fetches count
 * as traffic for whatever is requested next, a record written from a retained fetch is exempt from
 * the record-time check exactly as a promotion is, and the fetch ledger verifies the interval.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastNavigation, checkFetchLedger, appendAttempt, emptyLog, FETCH_PACING_REQUIRED_FROM,
} from '../run.mjs';
import { fetchLedgerProblems } from '../../evaluation/solo/descriptive.mjs';

const after = (ms) => new Date(FETCH_PACING_REQUIRED_FROM + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const before = (ms) => new Date(FETCH_PACING_REQUIRED_FROM - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

describe('a fetch counts as traffic', () => {
  test('lastNavigation sees a fetch, so the next request is constrained by it', () => {
    // The root cause: a read-resource fetch left no trace the pacer could read.
    const log = { attempts: [], fetches: [{ id: 'f-1', url: 'https://a.govt.nz/sitemap.xml', fetchedAt: after(0) }] };
    assert.equal(lastNavigation(log), FETCH_PACING_REQUIRED_FROM);
  });

  test('a record that states no request was made still contributes nothing', () => {
    // selection-v1.0.11's rule, unchanged.
    const log = {
      attempts: [{ navigatedAt: after(0), navigationPerformed: false }],
      fetches: [],
    };
    assert.equal(lastNavigation(log), null);
  });

  test('the later of a navigation and a fetch wins', () => {
    const log = {
      attempts: [{ navigatedAt: after(0) }],
      fetches: [{ id: 'f-1', url: 'https://a.govt.nz/s.xml', fetchedAt: after(60_000) }],
    };
    assert.equal(lastNavigation(log), FETCH_PACING_REQUIRED_FROM + 60_000);
  });
});

describe('the ledger verifies the interval where the traffic is', () => {
  const fetchAt = (id, at) => ({
    id, url: `https://a.govt.nz/${id}.xml`, fetchedAt: at,
    fetchFile: `${id}.bin`, fetchedSha256: 'a'.repeat(64), fetchedBytes: 10, httpStatus: 200,
  });
  /** Both implementations over one log, required to agree on whether pacing was breached. */
  const both = (log) => {
    const capture = checkFetchLedger(log, null).filter((p) => /ms after the previous request/.test(p));
    const sealer = fetchLedgerProblems(log, null).filter((p) => /ms after the previous request/.test(p));
    assert.equal(capture.length > 0, sealer.length > 0,
      `disagreement:\n  capture: ${JSON.stringify(capture)}\n  sealer: ${JSON.stringify(sealer)}`);
    return capture;
  };

  test('one second between two fetches is refused', () => {
    // Exactly what happened: f-0009 at 09:03:24Z, f-0010 at 09:03:25Z.
    const problems = both({ attempts: [], fetches: [fetchAt('f-1', after(0)), fetchAt('f-2', after(1000))] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /f-2 .* was fetched 1000 ms after the previous request/);
  });

  test('five seconds is permitted', () => {
    assert.deepEqual(both({ attempts: [], fetches: [fetchAt('f-1', after(0)), fetchAt('f-2', after(5000))] }), []);
  });

  test('a fetch too soon after a page NAVIGATION is refused as well', () => {
    // The floor is on requests to the host, whichever command made the previous one.
    const log = {
      attempts: [{ id: 'c-1', navigatedAt: after(0) }],
      fetches: [fetchAt('f-1', after(2000))],
    };
    assert.equal(both(log).length, 1);
  });

  test('fetches recorded before the amendment are grandfathered, and the breach is disclosed instead', () => {
    // The gate has to stay usable, and the log has to keep the fact: v-0010 carries it.
    assert.deepEqual(both({ attempts: [], fetches: [fetchAt('f-1', before(2000)), fetchAt('f-2', before(1000))] }), []);
  });
});

describe('a record derived from a retained fetch generates no traffic', () => {
  test('it is exempt from the record-time floor, as a promotion is', () => {
    // The refusal that exposed all of this: the outcome record for f-0010 could not be written,
    // because it inherited the fetch time of a request that had already happened. Amendment 43
    // settled the principle for promotions - pacing is an obligation on traffic, and a record that
    // generates none cannot breach it.
    const log = emptyLog();
    const fetched = (id, url, at) => ({
      id, url, fetchedAt: at,
      fetchFile: `${id}.bin`, fetchedSha256: 'a'.repeat(64), fetchedBytes: 10, httpStatus: 200,
    });
    log.fetches = [
      fetched('f-0', 'https://a.govt.nz/sitemap.xml', '2026-10-04T09:03:24Z'),
      fetched('f-1', 'https://b.govt.nz/sitemap.xml', '2026-10-04T09:03:25Z'),
    ];
    appendAttempt(log, {
      examinedAt: '2026-10-04T09:03:24Z', navigatedAt: '2026-10-04T09:03:24Z', fetchId: 'f-0',
      agency: 'A', website: 'https://a.govt.nz/', url: 'https://a.govt.nz/sitemap.xml',
      status: 'discovery', discoveryKind: 'sitemap', outcome: 'no-candidates',
      category: 'account-registration', candidateSetVersion: 1, approval: 'pending',
    });
    // One second later, a second fetch-derived record: refused before, permitted now.
    appendAttempt(log, {
      examinedAt: '2026-10-04T09:03:25Z', navigatedAt: '2026-10-04T09:03:25Z', fetchId: 'f-1',
      agency: 'A', website: 'https://b.govt.nz/', url: 'https://b.govt.nz/sitemap.xml',
      status: 'discovery', discoveryKind: 'sitemap', outcome: 'no-candidates',
      category: 'account-registration', candidateSetVersion: 1, approval: 'pending',
    });
    assert.equal(log.attempts.length, 2);
    assert.equal(log.attempts.at(-1).fetchId, 'f-1');
  });

  test('a record that DID navigate is still held to the floor', () => {
    // Removing the backstop for fetch-derived records must not remove it for real traffic.
    const log = emptyLog();
    appendAttempt(log, {
      examinedAt: after(0), navigatedAt: after(0),
      agency: 'A', website: 'https://a.govt.nz/', url: 'https://a.govt.nz/one',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates',
      category: 'account-registration', candidateSetVersion: 1, approval: 'pending',
    });
    assert.throws(() => appendAttempt(log, {
      examinedAt: after(1000), navigatedAt: after(1000),
      agency: 'A', website: 'https://a.govt.nz/', url: 'https://a.govt.nz/two',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates',
      category: 'account-registration', candidateSetVersion: 1, approval: 'pending',
    }), /1000 ms since the previous navigation/);
  });
});
