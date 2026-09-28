/**
 * The permit boundary must survive a redirect.
 *
 * selection-v1.0.28 / capture-v1.0.8. Reproduced against `selection-v1.0.27`: `/allowed` returned 302
 * to `/forbidden`, Chromium requested both, and the disallowed page came back HTTP 200 and rendered -
 * its name field and all. A permit and a policy check covering the requested URL covered exactly one
 * hop.
 *
 * The assertion that matters in every case below is the DESTINATION SERVER'S REQUEST LOG. A refusal
 * that still lets the request leave is not a refusal, and two earlier attempts at this failed exactly
 * there: `page.route` is not called for a redirected request, and fulfilling a 3xx makes Chromium
 * follow it without interception. Both leaked.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { renderDiscoveryPage } from '../render-discovery.mjs';
import { capturePage } from '../capture.mjs';
import { MAX_REDIRECT_HOPS } from '../redirect-guard.mjs';
import {
  emptyLog, recordRobotsCheck, renderBacklog, appendAttempt, sha256, checkRenderLedger,
  renderRefusalProblems,
} from '../run.mjs';
import { evaluatePolicy } from '../robots-policy.mjs';

const FORM = '<html><head><title>Destination</title></head><body><input id="q7" type="text"></body></html>';

/** Two independent servers, so "which server was asked" is unambiguous. */
let origin;
let other;
let hits;
let otherHits;
let bounced;
let server;
let otherServer;

before(async () => {
  hits = [];
  otherHits = [];
  bounced = 0;
  server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /forbidden\n');
    }
    if (req.url === '/to-forbidden') { res.writeHead(302, { location: '/forbidden' }); return res.end(); }
    if (req.url === '/to-other') { res.writeHead(302, { location: `${other}/anything` }); return res.end(); }
    if (req.url === '/to-allowed') { res.writeHead(302, { location: '/fine' }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop2' }); return res.end(); }
    if (req.url === '/loop2') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (req.url === '/bounce') {
      bounced += 1;
      if (bounced === 1) { res.writeHead(302, { location: '/bounce-back' }); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(FORM);
    }
    if (req.url === '/bounce-back') { res.writeHead(302, { location: '/bounce' }); return res.end(); }
    if (req.url === '/forbidden' || req.url === '/fine' || req.url === '/direct') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(FORM);
    }
    res.writeHead(404); res.end();
  });
  otherServer = createServer((req, res) => {
    otherHits.push(req.url);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(FORM);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => otherServer.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  other = `http://127.0.0.1:${otherServer.address().port}`;
});
after(() => {
  server?.closeAllConnections?.(); server?.close();
  otherServer?.closeAllConnections?.(); otherServer?.close();
});

/** A policy source holding ONLY the first origin's robots file, freshly recorded. */
const policySource = () => {
  const log = emptyLog();
  recordRobotsCheck(log, {
    origin, url: `${origin}/robots.txt`,
    fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    httpStatus: 200, disposition: 'rules',
    sha256: sha256('User-agent: *\nDisallow: /forbidden\n'),
    bytes: 41, body: 'User-agent: *\nDisallow: /forbidden\n',
  });
  return (target) => {
    let u = null;
    try { u = new URL(target); } catch { return { allowed: false, reason: 'unusable URL' }; }
    const check = (log.robotsChecks ?? []).find((c) => c.origin === u.origin);
    if (!check) return { allowed: false, reason: `no recorded robots policy for ${u.origin}` };
    const v = evaluatePolicy(check, u.pathname + u.search, 'chromium');
    return { allowed: v.allowed === true, reason: v.reason, robotsCheckId: check.id, disposition: check.disposition };
  };
};

const render = (url, outDir, policyFor) => renderDiscoveryPage({
  browserFactory: () => chromium.launch({ headless: true }),
  url, outDir, recordId: `r${Math.random().toString(36).slice(2)}`, settleMs: 50, policyFor,
});

describe('a redirect to a disallowed same-origin path', () => {
  test('is refused, and the destination receives zero requests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd1-'));
    hits.length = 0;
    const out = await render(`${origin}/to-forbidden`, dir, policySource());

    assert.equal(out.refused, true);
    assert.equal(out.refusal.url, `${origin}/forbidden`);
    assert.match(out.refusal.reason, /Disallow: \/forbidden/);
    // THE assertion: the forbidden path was never asked for.
    assert.ok(hits.includes('/to-forbidden'), 'the permitted URL was requested');
    assert.ok(!hits.includes('/forbidden'), `the forbidden path was requested: ${JSON.stringify(hits)}`);
    // And no evidence-shaped fields are left behind.
    assert.equal(out.renderFile, null);
    assert.equal(out.renderedSha256, null);
    assert.deepEqual(readdirSync(dir), [], 'nothing was written');
    // The chain is recorded, with the policy that decided it.
    assert.equal(out.redirectChain.length, 1);
    assert.equal(out.redirectChain[0].httpStatus, 302);
    assert.equal(out.redirectChain[0].allowed, false);
    assert.equal(out.redirectChain[0].robotsCheckId, 'r-0001');
  });
});

describe('a redirect to an origin with no recorded policy', () => {
  test('is refused, and that origin receives zero requests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd2-'));
    hits.length = 0;
    otherHits.length = 0;
    const out = await render(`${origin}/to-other`, dir, policySource());

    assert.equal(out.refused, true);
    assert.match(out.refusal.reason, /no recorded robots policy for/);
    assert.equal(out.refusal.url, `${other}/anything`);
    // THE assertion: the other server was never contacted at all - not even for its robots file,
    // because a render may not go fetching policy under a permit that does not cover it.
    assert.deepEqual(otherHits, [], `the unknown origin was contacted: ${JSON.stringify(otherHits)}`);
    assert.deepEqual(readdirSync(dir), []);
  });
});

describe('a permitted redirect still works', () => {
  test('a redirect to an allowed path is followed and rendered', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd3-'));
    hits.length = 0;
    const out = await render(`${origin}/to-allowed`, dir, policySource());

    assert.equal(out.refused, false);
    assert.equal(out.finalUrl, `${origin}/fine`);
    assert.equal(out.title, 'Destination');
    assert.equal(out.controls.length, 1, 'the destination rendered');
    assert.ok(existsSync(join(dir, out.renderFile)));
    assert.equal(out.redirectChain.length, 1);
    assert.equal(out.redirectChain[0].allowed, true);
    assert.equal(out.redirectChain[0].to, `${origin}/fine`);
  });

  test('a page that does not redirect is unaffected, and records an empty chain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd4-'));
    const out = await render(`${origin}/direct`, dir, policySource());
    assert.equal(out.refused, false);
    assert.deepEqual(out.redirectChain, []);
    assert.equal(out.controls.length, 1);
  });
});

describe('fail-closed and bounded', () => {
  test('with no policy source, no redirect may be followed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd5-'));
    hits.length = 0;
    const out = await renderDiscoveryPage({
      browserFactory: () => chromium.launch({ headless: true }),
      url: `${origin}/to-allowed`, outDir: dir, recordId: 'nopolicy', settleMs: 50,
    });
    assert.equal(out.refused, true, 'a caller that forgets policyFor must not inherit the old behaviour');
    assert.match(out.refusal.reason, /no recorded robots policy was made available/);
    assert.ok(!hits.includes('/fine'));
  });

  test('a redirect loop is refused rather than walked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd6-'));
    const out = await render(`${origin}/loop`, dir, policySource());
    assert.equal(out.refused, true);
    assert.match(out.refusal.reason, new RegExp(`more than ${MAX_REDIRECT_HOPS} redirects`));
  });
});

describe('the capture path enforces the same boundary', () => {
  test('a capture whose page redirects to a disallowed path is refused, with zero requests to it', async () => {
    // Worse than a discovery inspection doing it: the corpus is what gets analysed and published.
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd7-'));
    mkdirSync(join(dir, 'captures'), { recursive: true });
    hits.length = 0;
    const out = await capturePage({
      browserFactory: () => chromium.launch({ headless: true }),
      url: `${origin}/to-forbidden`, agency: 'A', website: origin, pageId: 'redir-001',
      category: 'enquiry-or-contact', outDir: join(dir, 'captures'), settleMs: 50,
      policyFor: policySource(),
    });
    assert.equal(out.refused, true);
    assert.equal(out.file, null);
    assert.equal(out.htmlSha256, null);
    assert.ok(!hits.includes('/forbidden'), `the forbidden path was requested: ${JSON.stringify(hits)}`);
    assert.deepEqual(readdirSync(join(dir, 'captures')), [], 'no capture file was written');
  });

  test('a capture whose redirect is permitted still captures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd8-'));
    mkdirSync(join(dir, 'captures'), { recursive: true });
    const out = await capturePage({
      browserFactory: () => chromium.launch({ headless: true }),
      url: `${origin}/to-allowed`, agency: 'A', website: origin, pageId: 'redir-002',
      category: 'enquiry-or-contact', outDir: join(dir, 'captures'), settleMs: 50,
      policyFor: policySource(),
    });
    assert.equal(out.refused, false);
    assert.equal(out.finalUrl, `${origin}/fine`);
    assert.ok(existsSync(join(dir, 'captures', 'redir-002.html')));
  });
});

describe('an unreachable page discharges its backlog obligation as attrition', () => {
  test('a recorded render refusal clears its own URL, and no other', () => {
    // Otherwise the obligation is unsatisfiable and the corpus draft is withheld for ever - and the
    // exclusion must be keyed on the URL, or one unreachable page would excuse every other.
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    const plain = (url, at) => {
      appendAttempt(log, {
        examinedAt: at, agency: 'A', website: 'https://a.govt.nz/', url,
        status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates',
        category: 'service-application', candidateSetVersion: 1, navigatedAt: at,
        approval: 'approved',
      });
      return log.attempts.at(-1);
    };
    const unreachable = plain('https://a.govt.nz/apply', '2026-09-26T19:00:00Z');
    const reachable = plain('https://a.govt.nz/other', '2026-09-26T19:05:00Z');
    log.candidateSets['A\u0000service-application'] = {
      agency: 'A', category: 'service-application', version: 1, discovered: [], locked: [],
      lockedAt: '2026-09-26T20:00:00Z', approval: 'approved', candidateDeclaration: 'none',
      discoveryRecordIds: [unreachable.id, reachable.id],
    };
    assert.equal(renderBacklog(log).length, 2);

    // A render of /apply was attempted and refused at the policy boundary. selection-v1.0.29: the
    // refusal must carry its permit, its navigation and a continuous chain, or it discharges nothing.
    log.discoveryPermits = [{
      id: 'p-0001', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
      issuedAt: '2026-09-26T19:09:00Z', consumedAt: '2026-09-26T19:10:30Z',
    }];
    appendAttempt(log, {
      permitId: 'p-0001',
      examinedAt: '2026-09-26T19:10:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'disallowed', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:10:00Z', approval: 'approved',
      renderRefused: true,
      redirectChain: [{
        from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/forbidden',
        httpStatus: 302, allowed: false, reason: 'more than 10 redirects',
      }],
    });
    assert.deepEqual(renderBacklog(log).map((a) => a.id), [reachable.id],
      '/apply is discharged as attrition; /other still owes a render');
  });
});

describe('a discharge must carry the evidence that discharged it', () => {
  /**
   * selection-v1.0.29. Both attacks below worked against selection-v1.0.28 with zero ledger
   * problems. The first is one line long.
   */
  const build = ({ destinationPolicy = null, chain = null, refusalFields = {}, flag = true } = {}) => {
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    if (destinationPolicy) recordRobotsCheck(log, destinationPolicy);
    appendAttempt(log, {
      examinedAt: '2026-09-27T09:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-27T09:00:00Z', approval: 'approved',
    });
    const plain = log.attempts.at(-1);
    log.candidateSets['A\u0000service-application'] = {
      agency: 'A', category: 'service-application', version: 1, discovered: [], locked: [],
      lockedAt: '2026-09-27T09:30:00Z', approval: 'approved', candidateDeclaration: 'none',
      discoveryRecordIds: [plain.id],
    };
    log.discoveryPermits = [{
      id: 'p-0001', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
      issuedAt: '2026-09-27T09:59:00Z', consumedAt: '2026-09-27T10:00:30Z',
    }];
    if (flag) {
      appendAttempt(log, {
        permitId: 'p-0001',
        examinedAt: '2026-09-27T10:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
        url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
        outcome: 'disallowed', category: 'service-application', candidateSetVersion: 1,
        navigatedAt: '2026-09-27T10:00:00Z', approval: 'approved',
        renderRefused: true,
        redirectChain: chain ?? [{
          from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/forbidden',
          httpStatus: 302, allowed: false, robotsCheckId: 'r-0001', reason: 'Disallow: /forbidden',
        }],
        ...refusalFields,
      });
    }
    return { log, plain, refusal: flag ? log.attempts.at(-1) : null };
  };
  const dischargedIn = (log, id) => !renderBacklog(log).some((a) => a.id === id);

  test('THE ATTACK: the bare boolean on an ordinary record discharges nothing', () => {
    // One line, against selection-v1.0.28: backlog 66 -> 65, both ledgers silent.
    const { log, plain } = build({ flag: false });
    assert.equal(dischargedIn(log, plain.id), false);
    plain.renderRefused = true;
    assert.equal(dischargedIn(log, plain.id), false, 'the flag alone must discharge nothing');
    const problems = checkRenderLedger(log, mkdtempSync(join(tmpdir(), 'ff-x-')));
    assert.ok(problems.some((p) => /with no redirect chain/.test(p)), problems.join('; '));
  });

  test('a well-formed refusal against a confirmed disallow DOES discharge', () => {
    const { log, plain } = build({
      destinationPolicy: {
        origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
        fetchedAt: new Date(Date.now() - 30_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        httpStatus: 200, disposition: 'rules',
        sha256: sha256('x'), bytes: 1, body: 'User-agent: *\nDisallow: /forbidden\n',
      },
    });
    assert.equal(dischargedIn(log, plain.id), true);
    assert.deepEqual(checkRenderLedger(log, mkdtempSync(join(tmpdir(), 'ff-x-'))), []);
  });

  test('THE ATTACK: a missing destination policy does not discharge, and a permitting one restores it', () => {
    const { log, plain } = build({
      chain: [{
        from: 'https://a.govt.nz/apply', to: 'https://elsewhere.invalid/x',
        httpStatus: 302, allowed: false, reason: 'no recorded robots policy for https://elsewhere.invalid',
      }],
    });
    assert.equal(dischargedIn(log, plain.id), false, 'unchecked is not unreachable');

    // A fresh policy that PERMITS the destination must bring the render back, not leave it retired.
    recordRobotsCheck(log, {
      origin: 'https://elsewhere.invalid', url: 'https://elsewhere.invalid/robots.txt',
      fetchedAt: new Date(Date.now() - 10_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 404, disposition: 'allow-all', sha256: sha256(''), bytes: 0, body: '',
    });
    assert.equal(dischargedIn(log, plain.id), false, 'a permitted destination means retry, not attrition');

    // And a fresh policy that FORBIDS it discharges.
    recordRobotsCheck(log, {
      origin: 'https://elsewhere.invalid', url: 'https://elsewhere.invalid/robots.txt',
      fetchedAt: new Date(Date.now() - 5_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256('y'), bytes: 1,
      body: 'User-agent: *\nDisallow: /x\n',
    });
    assert.equal(dischargedIn(log, plain.id), true);
  });

  test('a stale or unestablished destination policy does not discharge either', () => {
    for (const policy of [
      {
        origin: 'https://elsewhere.invalid', url: 'https://elsewhere.invalid/robots.txt',
        fetchedAt: '2026-09-01T00:00:00Z', httpStatus: 200, disposition: 'rules',
        sha256: sha256('y'), bytes: 1, body: 'User-agent: *\nDisallow: /x\n',
      },
      {
        origin: 'https://elsewhere.invalid', url: 'https://elsewhere.invalid/robots.txt',
        fetchedAt: new Date(Date.now() - 10_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        httpStatus: 200, disposition: 'unestablished', sha256: sha256('z'), bytes: 212, body: '',
        representation: { valid: false, reason: 'the media type was text/html, not text/plain', challenge: 'Imperva/Incapsula' },
      },
    ]) {
      const { log, plain } = build({
        destinationPolicy: policy,
        chain: [{
          from: 'https://a.govt.nz/apply', to: 'https://elsewhere.invalid/x',
          httpStatus: 302, allowed: false, reason: 'not permitted',
        }],
      });
      assert.equal(dischargedIn(log, plain.id), false, policy.disposition);
    }
  });

  test('a loop and an unusable target are terminal whatever any policy says', () => {
    for (const reason of ['more than 10 redirects', 'the redirect target is not a usable URL']) {
      const { log, plain } = build({
        chain: [{ from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/loop', httpStatus: 302, allowed: false, reason }],
      });
      assert.equal(dischargedIn(log, plain.id), true, reason);
    }
  });

  test('a broken chain discharges nothing, and is reported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-x-'));
    const cases = [
      ['starting somewhere else', [{ from: 'https://a.govt.nz/other', to: 'https://a.govt.nz/forbidden', httpStatus: 302, allowed: false }], /does not start at|starts at/],
      ['not continuous', [
        { from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/one', httpStatus: 302, allowed: true },
        { from: 'https://a.govt.nz/elsewhere', to: 'https://a.govt.nz/forbidden', httpStatus: 302, allowed: false },
      ], /not continuous/],
      ['ending in an allowed hop', [{ from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/fine', httpStatus: 302, allowed: true }], /its last hop was allowed/],
      ['refused before the end', [
        { from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/one', httpStatus: 302, allowed: false },
        { from: 'https://a.govt.nz/one', to: 'https://a.govt.nz/forbidden', httpStatus: 302, allowed: false },
      ], /should have stopped there/],
    ];
    for (const [name, chain, pattern] of cases) {
      const { log, plain } = build({ chain });
      assert.equal(dischargedIn(log, plain.id), false, name);
      assert.ok(checkRenderLedger(log, dir).some((p) => pattern.test(p)), `${name}: ${checkRenderLedger(log, dir).join('; ')}`);
    }
  });

  test('a refusal with no permit, or one for another page, discharges nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-x-'));
    const noPermit = build({ refusalFields: { permitId: undefined } });
    assert.equal(dischargedIn(noPermit.log, noPermit.plain.id), false);
    assert.ok(checkRenderLedger(noPermit.log, dir).some((p) => /with no permit/.test(p)));

    const wrongScope = build();
    wrongScope.log.discoveryPermits[0].url = 'https://a.govt.nz/elsewhere';
    assert.equal(dischargedIn(wrongScope.log, wrongScope.plain.id), false);
    assert.ok(checkRenderLedger(wrongScope.log, dir).some((p) => /which authorised/.test(p)));

    const unconsumed = build();
    unconsumed.log.discoveryPermits[0].consumedAt = null;
    assert.equal(dischargedIn(unconsumed.log, unconsumed.plain.id), false);
  });

  test('renderRefused: false is not a value, it is absent', () => {
    const { log } = build({ flag: false });
    log.attempts[0].renderRefused = false;
    assert.ok(checkRenderLedger(log, mkdtempSync(join(tmpdir(), 'ff-x-')))
      .some((p) => /it is true or absent/.test(p)));
  });
});

describe('every hop is recorded, including one back to the authorised URL', () => {
  test('a redirect returning to the original URL appears in the chain', async () => {
    // selection-v1.0.29: it was counted and left out, contradicting the protocol's own claim - and
    // leaving a gap that would have broken the continuity check above.
    const dir = mkdtempSync(join(tmpdir(), 'ff-rd9-'));
    const out = await render(`${origin}/bounce`, dir, policySource());
    assert.equal(out.refused, false);
    assert.ok(out.redirectChain.length >= 2, `chain was ${JSON.stringify(out.redirectChain)}`);
    assert.equal(out.redirectChain[0].to, `${origin}/bounce-back`);
    assert.equal(out.redirectChain[1].to, `${origin}/bounce`);
    assert.match(out.redirectChain[1].reason, /back to the URL this permit authorises/);
    // Continuous, which is what the refusal validator relies on.
    assert.equal(out.redirectChain[1].from, out.redirectChain[0].to);
  });
});

describe('a retrospective render can be authorised for a closed round', () => {
  test('preflight issues a permit for a locked, approved set without reopening it', async () => {
    // selection-v1.0.30. `recordCandidates` refuses to touch a locked set, which is right for a set
    // that would grow - but the preflight's call adds nothing, and refusing it made every
    // retrospective render impossible: all sixty-six backlog records belong to rounds that are
    // locked and approved, so no permit could be issued for any of them.
    const dir = mkdtempSync(join(tmpdir(), 'ff-closed-'));
    mkdirSync(join(dir, 'captures'), { recursive: true });
    const log = emptyLog();
    log.candidateSets['A\u0000account-registration'] = {
      agency: 'A', category: 'account-registration', version: 2, discovered: [], locked: [],
      ordered: [], droppedBeyondBound: [], lockedAt: '2026-09-25T03:00:00Z', approval: 'approved',
      candidateDeclaration: 'none', declaredAt: '2026-09-25T03:00:00Z',
      discoveryRecordIds: [], discoveryMethods: ['navigation'],
    };
    writeFileSync(join(dir, 'capture-log.json'), JSON.stringify(log));

    const cli = new URL('../cli-capture.mjs', import.meta.url).pathname;
    // Asynchronously: `spawnSync` blocks this process's event loop, and the robots server the child
    // must reach lives in this process - so a synchronous spawn deadlocks until the fetch times out.
    const run = (args) => new Promise((resolve) => {
      const child = spawn('node', [cli, ...args]);
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('exit', (status) => resolve({ status, stdout, stderr }));
    });

    const ok = await run(['preflight-discovery', '--out', dir, '--agency', 'A', '--website', `${origin}/`,
      '--url', `${origin}/direct`, '--category', 'account-registration', '--set-version', '2',
      '--method', 'navigation']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /permit p-0001/);

    // The set is untouched: still locked, still approved, still version 2.
    const after = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
    const set = after.candidateSets['A\u0000account-registration'];
    assert.equal(set.lockedAt, '2026-09-25T03:00:00Z');
    assert.equal(set.approval, 'approved');
    assert.equal(set.version, 2);

    // And the version is still checked: a wrong one is refused rather than silently accepted.
    const wrong = await run(['preflight-discovery', '--out', dir, '--agency', 'A', '--website', `${origin}/`,
      '--url', `${origin}/other`, '--category', 'account-registration', '--set-version', '1',
      '--method', 'navigation']);
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /is version 2, not 1/);
  });
});
