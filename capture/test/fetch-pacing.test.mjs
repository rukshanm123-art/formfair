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
  pacingProblems as capturePacing, lastRequest,
} from '../run.mjs';
import {
  fetchLedgerProblems, pacingProblems as sealerPacing,
} from '../../evaluation/solo/descriptive.mjs';

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

describe('Amendment 65: the three holes Amendment 64 left in the trust-time audit', () => {
  // Each was reproduced against the frozen code before being closed: all three returned ZERO
  // problems from both implementations. A green CI run on Amendment 64 did not close any of them,
  // which is the point of driving both implementations over one adversarial table.
  const at = (ms) => new Date(FETCH_PACING_REQUIRED_FROM + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const fetchAt = (id, when, origin = 'https://a.govt.nz') => ({
    id, url: `${origin}/${id}.xml`, fetchedAt: when,
    fetchFile: `${id}.bin`, fetchedSha256: 'a'.repeat(64), fetchedBytes: 10, httpStatus: 200,
  });
  const policy = (origin, when, crawlDelay) => ({
    id: `r-${origin.length}`, origin, url: `${origin}/robots.txt`, fetchedAt: when,
    httpStatus: 200, disposition: 'rules',
    policy: { groups: crawlDelay ? [{ crawlDelay }] : [] },
  });
  const both = (log) => {
    const capture = capturePacing(log);
    const sealer = sealerPacing(log);
    assert.equal(capture.length > 0, sealer.length > 0,
      `disagreement:\n  capture: ${JSON.stringify(capture)}\n  sealer: ${JSON.stringify(sealer)}`);
    return capture;
  };

  test('two requests at the SAME timestamp are refused', () => {
    // `t < at` found no predecessor for either, so simultaneous requests passed - and simultaneous
    // is worse than one second apart, not better.
    const problems = both({ attempts: [], fetches: [fetchAt('f-1', at(0)), fetchAt('f-2', at(0))] });
    assert.equal(problems.length, 2, JSON.stringify(problems));
    assert.match(problems[0], /0 ms after the previous request/);
  });

  test('a request is never measured against itself', () => {
    // The `<=` comparison must exclude the entry's own identity, or a lone request self-reports 0.
    assert.deepEqual(both({ attempts: [], fetches: [fetchAt('f-1', at(0))] }), []);
  });

  test('a crawl-delay longer than the floor is enforced', () => {
    // Ten seconds asked for, six observed: both ledgers passed it.
    const log = {
      attempts: [],
      robotsChecks: [policy('https://a.govt.nz', at(-60_000), 10)],
      fetches: [fetchAt('f-1', at(0)), fetchAt('f-2', at(6000))],
    };
    const problems = both(log);
    assert.ok(problems.some((p) => /f-2/.test(p)), JSON.stringify(problems));
    assert.match(problems.find((p) => /f-2/.test(p)), /10000 ms/);
  });

  test('the same crawl-delay is satisfied when it is actually observed', () => {
    const log = {
      attempts: [],
      robotsChecks: [policy('https://a.govt.nz', at(-60_000), 10)],
      fetches: [fetchAt('f-1', at(0)), fetchAt('f-2', at(10_000))],
    };
    assert.deepEqual(both(log).filter((p) => /f-2/.test(p)), []);
  });

  test('a crawl-delay is read from the policy governing THAT origin', () => {
    // A ten-second policy on one host must not impose itself on requests to another.
    const log = {
      attempts: [],
      robotsChecks: [policy('https://slow.govt.nz', at(-60_000), 10)],
      fetches: [fetchAt('f-1', at(0), 'https://fast.govt.nz'), fetchAt('f-2', at(6000), 'https://fast.govt.nz')],
    };
    assert.deepEqual(both(log).filter((p) => /f-2/.test(p)), []);
  });

  test('the boundary begins before the freeze that introduced it', () => {
    // It stood at 09:30:00Z while the Amendment 64 commit was created at 09:09:56Z, so twenty
    // minutes of post-freeze traffic was never verified.
    assert.ok(FETCH_PACING_REQUIRED_FROM <= Date.parse('2026-10-04T09:09:56Z'),
      'the boundary must not sit after the commit that froze it');
    // And the two real sitemap fetches stay grandfathered, disclosed instead of hidden.
    assert.ok(FETCH_PACING_REQUIRED_FROM > Date.parse('2026-10-04T09:03:25Z'));
  });

  test('a robots.txt fetch is audited like any other request', () => {
    // r-0088 and r-0089 were 3000 ms apart and nothing counted them.
    const log = {
      attempts: [], fetches: [],
      robotsChecks: [policy('https://a.govt.nz', at(0)), policy('https://bb.govt.nz', at(3000))],
    };
    assert.equal(both(log).length, 1, JSON.stringify(both(log)));
  });

  test('the floor is global, not per-origin, because that is what this study publishes', () => {
    // f-0009 and f-0010 were different hosts one second apart. Different hosts do not excuse it.
    const log = {
      attempts: [],
      fetches: [fetchAt('f-1', at(0), 'https://one.govt.nz'), fetchAt('f-2', at(1000), 'https://two.govt.nz')],
    };
    assert.equal(both(log).length, 1);
  });
});
