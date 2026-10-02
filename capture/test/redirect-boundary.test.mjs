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
  renderRefusalProblems, quarantineArtefact, closeDiscoveryPermit, issueDiscoveryPermit,
  permitAudit, checkPermitLedger, ELIGIBILITY_CRITERIA, renderBarredProblems,
  assertRenderEvidenceUsable, answerChain,
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

describe('the corpus’s own pages can be re-examined', () => {
  test('a discovery record may coexist with a candidate assessment for the same URL', () => {
    // selection-v1.0.31. This branch refuses a second JUDGEMENT on one page, and a discovery record
    // is not a judgement on a page - so it was refusing exactly the two URLs the corpus rests on.
    const log = emptyLog();
    log.attempts.push({
      id: 'c-0001', agency: 'A', category: 'enquiry-or-contact', status: 'captured',
      approval: 'approved', url: 'https://a.govt.nz/contact', finalUrl: 'https://a.govt.nz/contact',
      pageId: 'page-1', file: 'page-1.html', htmlSha256: sha256('x'),
      inclusionEvidence: 'has a name field', capturedAt: '2026-09-25T00:00:00Z',
    });
    assert.doesNotThrow(() => appendAttempt(log, {
      examinedAt: '2026-09-28T01:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/contact', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'enquiry-or-contact', candidateSetVersion: 1,
      navigatedAt: '2026-09-28T01:00:00Z', approval: 'approved',
    }));
  });

  test('but a second CANDIDATE assessment of the same URL is still refused', () => {
    const log = emptyLog();
    log.attempts.push({
      id: 'c-0001', agency: 'A', category: 'enquiry-or-contact', status: 'captured',
      approval: 'approved', url: 'https://a.govt.nz/contact', finalUrl: 'https://a.govt.nz/contact',
      pageId: 'page-1', file: 'page-1.html', htmlSha256: sha256('x'),
      inclusionEvidence: 'has a name field', capturedAt: '2026-09-25T00:00:00Z',
    });
    assert.throws(() => appendAttempt(log, {
      examinedAt: '2026-09-28T01:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/contact', status: 'excluded', category: 'enquiry-or-contact',
      exclusionReason: 'a second judgement on one page', capturedAt: '2026-09-28T01:00:00Z',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    }), /is already recorded for A/);
  });
});

describe('rendered bytes nothing accounts for', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-orph-'));
    const renderedDir = join(dir, 'rendered');
    mkdirSync(renderedDir, { recursive: true });
    return { dir, renderedDir };
  };

  test('an unnamed file in rendered/ is reported', () => {
    const { renderedDir } = setup();
    writeFileSync(join(renderedDir, 'stray.html'), '<html></html>');
    const problems = checkRenderLedger(emptyLog(), renderedDir);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /is in rendered\/ but no render or record names it/);
  });

  test('a file the log names is not an orphan', () => {
    const { renderedDir } = setup();
    const html = '<html><body><input id="q7"></body></html>';
    writeFileSync(join(renderedDir, 'g1.html'), html);
    const log = emptyLog();
    log.discoveryPermits = [{
      id: 'p-0001', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
      issuedAt: '2026-09-27T09:00:00Z', consumedAt: '2026-09-27T09:00:30Z',
    }];
    log.renders = [{
      id: 'g-0001', url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-27T09:00:10Z',
      permitId: 'p-0001', renderFile: 'g1.html', renderedSha256: sha256(html),
      renderedBytes: Buffer.byteLength(html), httpStatus: 200, adoptedFrom: 'd-0001', accessBarriers: [],
    }];
    assert.deepEqual(checkRenderLedger(log, renderedDir), []);
  });

  test('quarantine moves the bytes out and records why', () => {
    const { dir, renderedDir } = setup();
    writeFileSync(join(renderedDir, 'stray.html'), '<html>bytes</html>');
    const moved = quarantineArtefact(renderedDir, 'stray.html', { reason: 'not recorded: appendAttempt refused it' });
    assert.ok(moved);
    assert.equal(existsSync(join(renderedDir, 'stray.html')), false);
    assert.equal(existsSync(moved), true, 'the evidence is preserved, not deleted');
    assert.match(readFileSync(`${moved}.reason.txt`, 'utf8'), /appendAttempt refused it/);
    assert.deepEqual(checkRenderLedger(emptyLog(), renderedDir), [], 'and the directory is clean again');
  });
});

describe('a request whose record could not be written', () => {
  const build = () => {
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    issueDiscoveryPermit(log, {
      agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
    });
    return log;
  };

  test('it closes as recording-failed-after-request, naming the quarantined bytes', () => {
    const log = build();
    const closed = closeDiscoveryPermit(log, {
      permitId: 'p-0001', disposition: 'recording-failed-after-request',
      reason: 'the request was made and appendAttempt refused the observation',
      quarantinedFile: 'quarantine/2026-09-28T01-45-42Z-g1.html',
      navigationWindow: { earliest: '2026-09-28T01:12:38Z', latest: '2026-09-28T01:12:55Z' },
    });
    assert.equal(closed.disposition, 'recording-failed-after-request');
    assert.equal(closed.quarantinedFile, 'quarantine/2026-09-28T01-45-42Z-g1.html');
    assert.equal(closed.navigationWindow.earliest, '2026-09-28T01:12:38Z');
    assert.equal(closed.accountedBy, null);
    assert.deepEqual(checkPermitLedger(log), []);
  });

  test('it must name the quarantined bytes, and may not name a record', () => {
    assert.throws(() => closeDiscoveryPermit(build(), {
      permitId: 'p-0001', disposition: 'recording-failed-after-request', reason: 'x',
    }), /must name the quarantined bytes/);
    assert.throws(() => closeDiscoveryPermit(build(), {
      permitId: 'p-0001', disposition: 'recording-failed-after-request', reason: 'x',
      quarantinedFile: 'q/x.html', accountedBy: 'd-0001',
    }), /names no discovery record/);
  });

  test('it counts as authorised traffic, and as no observation', () => {
    const log = build();
    closeDiscoveryPermit(log, {
      permitId: 'p-0001', disposition: 'recording-failed-after-request', reason: 'x',
      quarantinedFile: 'q/x.html',
    });
    const audit = permitAudit(log);
    assert.equal(audit.closedRecordingFailed, 1);
    assert.equal(audit.networkRequestsAuthorised, 1, 'the request happened');
    assert.equal(audit.consumed, 0, 'and produced no observation');
    assert.equal(audit.open, 0);
  });

  test('a navigation window is recorded rather than an invented instant', () => {
    // The exact navigation time was lost with the record that failed to be written. Both ends of
    // the window are observations: the permit's issuance and the moment the bytes hit the disk.
    const log = build();
    const closed = closeDiscoveryPermit(log, {
      permitId: 'p-0001', disposition: 'recording-failed-after-request', reason: 'x',
      quarantinedFile: 'q/x.html',
      navigationWindow: { earliest: '2026-09-28T01:12:38Z', latest: '2026-09-28T01:12:55Z', note: 'issuance to write' },
    });
    assert.equal(closed.navigatedAt, undefined, 'no instant is invented');
    assert.ok(closed.navigationWindow.earliest < closed.navigationWindow.latest);
    assert.match(closed.navigationWindow.note, /issuance to write/);
  });
});

describe('the rendered discovery path has the same headed fallback as capture', () => {
  /**
   * selection-v1.0.32. Without it the record contradicts itself: a headless render of the Health
   * feedback page returns a Cloudflare interstitial, while that page is in the corpus because a HEADED
   * capture read it. Same page, same protocol, opposite statements, differing only by a browser mode
   * one path had and the other did not.
   *
   * Two separate navigations, each with its own permit - so these tests assert the permits as much as
   * the outcomes.
   */
  let barrier;
  let barrierOrigin;
  let blockModes = new Set();
  let barrierHits;

  const CHALLENGE = `<!doctype html><html><head><title>Just a moment...</title></head><body>
    <h1>Checking your browser</h1>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`;
  const REAL = `<!doctype html><html><head><title>Feedback</title></head><body>
    <label for="n">First name</label><input id="n" name="name" type="text" maxlength="255"></body></html>`;
  const WALL = `<!doctype html><html><head><title>Sign in</title></head><body>
    <form><input type="password" name="p"><p>Please sign in to continue</p></form></body></html>`;

  before(async () => {
    barrierHits = [];
    barrier = createServer((req, res) => {
      barrierHits.push(req.url);
      if (req.url === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('User-agent: *\nDisallow: /nothing\n');
      }
      const headless = /HeadlessChrome/.test(req.headers['user-agent'] ?? '');
      const mode = headless ? 'headless' : 'headed';
      if (req.url === '/wall') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(WALL); }
      if (blockModes.has(mode)) {
        res.writeHead(403, { 'content-type': 'text/html' });
        return res.end(CHALLENGE);
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(REAL);
    });
    await new Promise((r) => barrier.listen(0, '127.0.0.1', r));
    barrierOrigin = `http://127.0.0.1:${barrier.address().port}`;
  });
  after(() => { barrier?.closeAllConnections?.(); barrier?.close(); });

  const cli = new URL('../cli-capture.mjs', import.meta.url).pathname;
  const run = (args) => new Promise((resolve) => {
    const child = spawn('node', [cli, ...args]);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });

  const prepare = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-hf-'));
    mkdirSync(join(dir, 'captures'), { recursive: true });
    const log = emptyLog();
    log.candidateSets['A\u0000enquiry-or-contact'] = {
      agency: 'A', category: 'enquiry-or-contact', version: 1, discovered: [], locked: [],
      ordered: [], droppedBeyondBound: [], lockedAt: '2026-09-27T09:00:00Z', approval: 'approved',
      candidateDeclaration: 'none', discoveryRecordIds: [], discoveryMethods: ['navigation'],
    };
    writeFileSync(join(dir, 'capture-log.json'), JSON.stringify(log));
    return dir;
  };
  const renderVia = async (dir, path) => {
    const pf = await run(['preflight-discovery', '--out', dir, '--agency', 'A',
      '--website', `${barrierOrigin}/`, '--url', `${barrierOrigin}${path}`,
      '--category', 'enquiry-or-contact', '--set-version', '1', '--method', 'navigation']);
    assert.equal(pf.status, 0, pf.stderr);
    const permit = pf.stdout.match(/permit (p-\d+):/)?.[1];
    const r = await run(['render-discovery', '--out', dir, '--agency', 'A',
      '--website', `${barrierOrigin}/`, '--url', `${barrierOrigin}${path}`,
      '--category', 'enquiry-or-contact', '--set-version', '1', '--method', 'navigation',
      '--permit-id', permit]);
    return { r, permit, log: () => JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8')) };
  };

  test('headless blocked, headed successful: two observations, two permits, one usable render', async () => {
    blockModes = new Set(['headless']);
    const dir = prepare();
    const { r, log } = await renderVia(dir, '/feedback');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /headless was access-barred/);

    const l = log();
    const obs = l.attempts.filter((a) => a.recordType === 'observation');
    assert.equal(obs.length, 2, 'both attempts are preserved');
    assert.equal(obs[0].outcome, 'retrieval-blocked');
    assert.equal(obs[1].outcome, 'rendered');
    assert.equal(obs[1].followsDiscoveryId, obs[0].id);
    assert.equal(obs[1].renderBarred, undefined, 'headed succeeded, so nothing is terminal');

    // Two navigations, two permits, neither reused.
    assert.notEqual(obs[0].permitId, obs[1].permitId);
    assert.equal(l.discoveryPermits.length, 2);
    assert.ok(l.discoveryPermits.every((p) => p.consumedAt), 'both consumed');
    // Five-second pacing between them, honestly.
    const gap = Date.parse(obs[1].navigatedAt) - Date.parse(obs[0].navigatedAt);
    assert.ok(gap >= 5000, `only ${gap} ms between the two navigations`);

    // Two renders, and only the headed one is usable as evidence.
    assert.equal(l.renders.length, 2);
    const headed = l.renders.find((x) => x.browserMode === 'headed');
    assert.deepEqual(headed.accessBarriers, []);
    assert.equal(headed.controlCount, 1);
    assert.deepEqual(assertRenderEvidenceUsable(l, { renderId: headed.id, capturesRoot: dir }), []);
    const barredRender = l.renders.find((x) => x.browserMode === 'headless');
    assert.ok(assertRenderEvidenceUsable(l, { renderId: barredRender.id, capturesRoot: dir }).length > 0,
      'a judgement may not cite the barred render');
    // The challenge bytes are retained privately.
    assert.ok(existsSync(join(dir, 'rendered', barredRender.renderFile)));
    assert.deepEqual(checkRenderLedger(l, join(dir, 'rendered')), []);
  });

  test('both modes barred: a terminal record that discharges only that URL', async () => {
    blockModes = new Set(['headless', 'headed']);
    const dir = prepare();
    const { r, log } = await renderVia(dir, '/feedback');
    assert.notEqual(r.status, 0, 'the run stops');
    const l = log();
    const obs = l.attempts.filter((a) => a.recordType === 'observation');
    assert.equal(obs.length, 2);
    assert.ok(obs.every((a) => a.outcome === 'retrieval-blocked'));
    assert.equal(obs[1].renderBarred, true);
    assert.deepEqual(renderBarredProblems(l, obs[1]), []);
    assert.deepEqual(checkRenderLedger(l, join(dir, 'rendered')), []);
  });

  test('a sign-in wall causes no fallback: it is a finding, not a barrier', async () => {
    blockModes = new Set();
    const dir = prepare();
    const { r, log } = await renderVia(dir, '/wall');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /headless was access-barred/);
    const l = log();
    assert.equal(l.attempts.filter((a) => a.recordType === 'observation').length, 1,
      'one navigation only');
    assert.equal(l.discoveryPermits.length, 1);
  });

  test('a headed launch failure leaves the obligation outstanding', () => {
    // An environment failure is not evidence that the site blocked access. Asserted as the invariant
    // rather than by breaking Playwright's launcher: sabotaging the browser path breaks the HEADLESS
    // launch too, so no observation is recorded at all and the test proves nothing about this branch.
    //
    // The timeline is anchored to the real clock, in the order the ledger requires: robots read
    // before the permits, the plain-fetch record predating the permit model, and each navigation
    // after the permit that authorised it.
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const t = Date.now();
    const robotsAt = iso(t - 90 * 60_000);
    const issuedOne = iso(t - 80 * 60_000);
    const navigatedOne = iso(t - 80 * 60_000 + 10_000);
    const consumedOne = iso(t - 80 * 60_000 + 20_000);
    const issuedTwo = iso(t - 80 * 60_000 + 30_000);
    const plainAt = iso(t - 3 * 24 * 3600_000);

    const dir = mkdtempSync(join(tmpdir(), 'ff-launch-'));
    mkdirSync(join(dir, 'rendered'), { recursive: true });
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt', fetchedAt: robotsAt,
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    // The plain-fetch record that still owes a render, predating the permit model in this log.
    appendAttempt(log, {
      examinedAt: plainAt, agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/feedback', status: 'discovery', discoveryKind: 'internal-search',
      outcome: 'no-candidates', category: 'enquiry-or-contact', candidateSetVersion: 1,
      navigatedAt: plainAt, approval: 'approved',
    });
    const owing = log.attempts.at(-1);

    const html = '<html><head><title>Just a moment...</title></head><body>challenge</body></html>';
    writeFileSync(join(dir, 'rendered', 'g1.html'), html);
    log.discoveryPermits = [
      {
        id: 'p-0001', agency: 'A', category: 'enquiry-or-contact', candidateSetVersion: 1,
        url: 'https://a.govt.nz/feedback', robotsCheckId: 'r-0001',
        issuedAt: issuedOne, consumedAt: consumedOne,
      },
      {
        id: 'p-0002', agency: 'A', category: 'enquiry-or-contact', candidateSetVersion: 1,
        url: 'https://a.govt.nz/feedback', robotsCheckId: 'r-0001', issuedAt: issuedTwo,
      },
    ];
    log.renders = [{
      id: 'g-0001', url: 'https://a.govt.nz/feedback', navigatedAt: navigatedOne,
      permitId: 'p-0001', renderFile: 'g1.html', renderedSha256: sha256(html),
      renderedBytes: Buffer.byteLength(html), httpStatus: 200, accessBarriers: ['http 403', 'cloudflare interstitial'],
      browserMode: 'headless',
    }];
    appendAttempt(log, {
      recordType: 'observation', permitId: 'p-0001', renderId: 'g-0001',
      examinedAt: navigatedOne, agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/feedback', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'retrieval-blocked', category: 'enquiry-or-contact', candidateSetVersion: 1,
      navigatedAt: navigatedOne, approval: 'approved', evidence: 'rendered-dom',
      renderFile: 'g1.html', renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html), httpStatus: 200,
      accessBarriers: ['http 403', 'cloudflare interstitial'],
      attemptedModes: [{ browserMode: 'headless', accessBarriers: ['http 403'] }],
    });
    const headlessObs = log.attempts.at(-1);
    log.candidateSets['A\u0000enquiry-or-contact'] = {
      agency: 'A', category: 'enquiry-or-contact', version: 1, discovered: [], locked: [],
      lockedAt: plainAt, approval: 'approved', candidateDeclaration: 'none',
      discoveryRecordIds: [owing.id],
    };

    // The headed attempt could not launch: its permit closes unused, with the reason stated.
    closeDiscoveryPermit(log, {
      permitId: 'p-0002', disposition: 'unused',
      reason: 'headed Chromium could not launch (missing display). No request was made under this ' +
        'permit. This is an environment failure, not evidence that the site blocked access, so the ' +
        'render obligation for this URL remains outstanding.',
    });

    assert.ok(!log.attempts.some((a) => a.renderBarred), 'a launch failure is not a terminal finding');
    assert.ok(renderBacklog(log).some((a) => a.id === owing.id), 'the obligation remains outstanding');
    assert.equal(headlessObs.outcome, 'retrieval-blocked', 'and the headless observation stands');
    assert.deepEqual(checkPermitLedger(log), []);
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
  });

  test('the launch-failure branch closes the permit unused and records nothing terminal', () => {
    // The distinction lives in what that branch does NOT do, so it is asserted against the source.
    const src = readFileSync(new URL('../cli-capture.mjs', import.meta.url), 'utf8');
    const branch = src.slice(src.indexOf('if (!headed) {'), src.indexOf('attemptedModes.push({\n    browserMode: \'headed\''));
    assert.match(branch, /PERMIT_DISPOSITIONS\.UNUSED/);
    assert.match(branch, /environment failure, not evidence that the site blocked access/);
    assert.ok(!/renderBarred/.test(branch), 'a launch failure must set no terminal flag');
  });
});

describe('a rendered judgement may answer the plain record it upgrades', () => {
  test('a judgement naming answersDiscoveryId coexists with the record it answers', () => {
    // selection-v1.0.34. Every one of the sixty-six retrospective obligations is a plain-fetch record
    // and the rendered judgement that answers it, in the same round - which the duplicate rule
    // refused. Superseding each instead would withdraw sixty-six records that are not wrong (each was
    // true of the method it used) and would drop the `answersDiscoveryId` link a judgement carries.
    const dir = mkdtempSync(join(tmpdir(), 'ff-ans-'));
    mkdirSync(join(dir, 'rendered'), { recursive: true });
    const html = '<html><body><input id="q7" type="text"></body></html>';
    writeFileSync(join(dir, 'rendered', 'g1.html'), html);
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const t = Date.now();
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt', fetchedAt: iso(t - 90 * 60_000),
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    appendAttempt(log, {
      examinedAt: iso(t - 3 * 24 * 3600_000), agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: iso(t - 3 * 24 * 3600_000), approval: 'approved',
    });
    const plain = log.attempts.at(-1);
    log.discoveryPermits = [{
      id: 'p-0001', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
      issuedAt: iso(t - 80 * 60_000), consumedAt: iso(t - 80 * 60_000 + 20_000),
    }];
    log.renders = [{
      id: 'g-0001', url: 'https://a.govt.nz/apply', navigatedAt: iso(t - 80 * 60_000 + 10_000),
      permitId: 'p-0001', renderFile: 'g1.html', renderedSha256: sha256(html),
      renderedBytes: Buffer.byteLength(html), httpStatus: 200, accessBarriers: [], browserMode: 'headless',
    }];
    appendAttempt(log, {
      recordType: 'observation', permitId: 'p-0001', renderId: 'g-0001',
      examinedAt: iso(t - 80 * 60_000 + 10_000), agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'rendered', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: iso(t - 80 * 60_000 + 10_000), approval: 'approved', evidence: 'rendered-dom',
      renderFile: 'g1.html', renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html), httpStatus: 200,
    });
    const observation = log.attempts.at(-1);
    log.candidateSets['A\u0000service-application'] = {
      agency: 'A', category: 'service-application', version: 1, discovered: [], locked: [],
      lockedAt: iso(t - 2 * 24 * 3600_000), approval: 'approved', candidateDeclaration: 'none',
      discoveryRecordIds: [plain.id],
    };
    assert.ok(renderBacklog(log).some((a) => a.id === plain.id));

    assert.doesNotThrow(() => appendAttempt(log, {
      recordType: 'judgement-only', renderId: 'g-0001', evidenceFromDiscoveryId: observation.id,
      answersDiscoveryId: plain.id,
      examinedAt: iso(t), agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigationPerformed: false, checkedAt: iso(t), evidence: 'rendered-dom',
      renderFile: 'g1.html', renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html), httpStatus: 200,
      approval: 'approved',
    }));
    assert.deepEqual(renderBacklog(log), [], 'and it answers the obligation');
    assert.equal(plain.outcome, 'no-candidates', 'the record it answers is preserved unchanged');
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
    assert.deepEqual(checkPermitLedger(log), []);
  });

  test('a judgement for a DIFFERENT round still cannot slip past the duplicate rule', () => {
    const log = emptyLog();
    appendAttempt(log, {
      examinedAt: '2026-09-20T00:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-20T00:00:00Z', approval: 'approved',
    });
    const plain = log.attempts.at(-1);
    assert.throws(() => appendAttempt(log, {
      recordType: 'judgement-only', renderId: 'g-0001', evidenceFromDiscoveryId: 'd-0001',
      answersDiscoveryId: plain.id,
      examinedAt: '2026-09-28T00:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 2,
      navigationPerformed: false, checkedAt: '2026-09-28T00:00:00Z', approval: 'approved',
    }), /a judgement answers a record in its own round/);
  });
});

describe('the answer link belongs to the correction chain', () => {
  /**
   * selection-v1.0.35. `correct-discovery` copied nothing, so superseding a judgement to fix its note
   * dropped the link saying which obligation it discharged, and that obligation silently reopened. It
   * failed safe once - but "copy from the immediate target" would still lose the link at the second
   * correction of a three-link chain, so the link is a property of the whole chain.
   */
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const build = () => {
    const t = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'ff-chain-'));
    mkdirSync(join(dir, 'rendered'), { recursive: true });
    const html = '<html><body><input id="q" type="text"></body></html>';
    writeFileSync(join(dir, 'rendered', 'g1.html'), html);
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt', fetchedAt: iso(t - 90 * 60_000),
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    appendAttempt(log, {
      examinedAt: iso(t - 3 * 24 * 3600_000), agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: iso(t - 3 * 24 * 3600_000), approval: 'approved',
    });
    const obligation = log.attempts.at(-1);
    log.discoveryPermits = [{
      id: 'p-0001', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
      issuedAt: iso(t - 80 * 60_000), consumedAt: iso(t - 80 * 60_000 + 20_000),
    }];
    log.renders = [{
      id: 'g-0001', url: 'https://a.govt.nz/apply', navigatedAt: iso(t - 80 * 60_000 + 10_000),
      permitId: 'p-0001', renderFile: 'g1.html', renderedSha256: sha256(html),
      renderedBytes: Buffer.byteLength(html), httpStatus: 200, accessBarriers: [], browserMode: 'headless',
    }];
    appendAttempt(log, {
      recordType: 'observation', permitId: 'p-0001', renderId: 'g-0001',
      examinedAt: iso(t - 80 * 60_000 + 10_000), agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'rendered', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: iso(t - 80 * 60_000 + 10_000), approval: 'approved', evidence: 'rendered-dom',
      renderFile: 'g1.html', renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html), httpStatus: 200,
    });
    const observation = log.attempts.at(-1);
    log.candidateSets['A\u0000service-application'] = {
      agency: 'A', category: 'service-application', version: 1, discovered: [], locked: [],
      lockedAt: iso(t - 2 * 24 * 3600_000), approval: 'approved', candidateDeclaration: 'none',
      discoveryRecordIds: [obligation.id],
    };
    const judgement = (over = {}) => ({
      recordType: 'judgement-only', renderId: 'g-0001', evidenceFromDiscoveryId: observation.id,
      examinedAt: iso(t), agency: 'A', website: 'https://a.govt.nz/', url: 'https://a.govt.nz/apply',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates',
      category: 'service-application', candidateSetVersion: 1, navigationPerformed: false,
      checkedAt: iso(t), evidence: 'rendered-dom', renderFile: 'g1.html',
      renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html), httpStatus: 200, approval: 'approved',
      ...over,
    });
    return { dir, log, obligation, observation, judgement };
  };

  test('a correction inheriting the link keeps the obligation discharged', () => {
    const { dir, log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    assert.deepEqual(renderBacklog(log), []);
    // Corrected, carrying the inherited link.
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id, supersedesDiscoveryId: first.id }));
    assert.deepEqual(renderBacklog(log), [], 'still discharged');
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
  });

  test('THE LOST LINK: a correction that drops it is refused at write time', () => {
    const { log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    assert.throws(() => appendAttempt(log, judgement({ supersedesDiscoveryId: first.id })),
      /must keep answering .*; it names none/);
  });

  test('and is reported at trust time when it is already in the log', () => {
    const { dir, log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id, supersedesDiscoveryId: first.id }));
    // Hand-edited afterwards, as a log nobody re-validated would be.
    delete log.attempts.at(-1).answersDiscoveryId;
    const problems = checkRenderLedger(log, join(dir, 'rendered'));
    assert.ok(problems.some((p) => /active end of a chain that answers .* names none/.test(p)), problems.join('; '));
    assert.ok(renderBacklog(log).some((a) => a.id === obligation.id), 'the obligation reopens, which is the symptom');
  });

  test('THE THIRD LINK: the link survives a correction of a correction', () => {
    // "Copy from the immediate target" would lose it here, because the middle link carries it only
    // by inheritance.
    const { dir, log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id, supersedesDiscoveryId: first.id }));
    const second = log.attempts.at(-1);
    assert.throws(() => appendAttempt(log, judgement({ supersedesDiscoveryId: second.id })),
      /must keep answering/);
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id, supersedesDiscoveryId: second.id }));
    assert.deepEqual(renderBacklog(log), []);
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
  });

  test('a correction may not change which obligation the chain answers', () => {
    const { log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    assert.throws(() => appendAttempt(log, judgement({
      answersDiscoveryId: obligation.id === 'd-0001' ? 'd-0002' : 'd-0001',
      supersedesDiscoveryId: first.id,
    })), /must keep answering|matches no recorded attempt/);
  });

  test('CONFLICT: a chain answering two records is refused', () => {
    const { dir, log, obligation, observation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id, supersedesDiscoveryId: first.id }));
    // Hand-edit the middle link to answer something else, so the chain disagrees with itself.
    log.attempts.find((a) => a.id === first.id).answersDiscoveryId = observation.id;
    const problems = checkRenderLedger(log, join(dir, 'rendered'));
    assert.ok(problems.some((p) => /chain answers more than one record/.test(p)), problems.join('; '));
  });

  test('DUPLICATE: two active judgements may not answer one obligation', () => {
    const { dir, log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    // A second, contradictory judgement, written straight into the log.
    log.attempts.push({
      ...judgement({ answersDiscoveryId: obligation.id, outcome: 'candidates-found' }),
      id: 'd-9100',
    });
    const problems = checkRenderLedger(log, join(dir, 'rendered'));
    assert.ok(
      problems.some((p) => /is answered by 2 active judgements/.test(p)),
      problems.join('; ')
    );
    // Both outcomes are visible in the complaint, so a reader sees the contradiction.
    assert.ok(problems.some((p) => /no-candidates/.test(p) && /candidates-found/.test(p)));
  });

  test('a superseded judgement does not count as a second answer', () => {
    const { dir, log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id, supersedesDiscoveryId: first.id }));
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), [],
      'one active judgement, one withdrawn: not a duplicate');
  });

  test('LEGACY: a chain that never carried an answer link stays valid', () => {
    // The NZSIS chain d-0301 -> d-0308 -> d-0309 predates judgements carrying answers. There is
    // nothing for it to have lost, so nothing is required of it.
    const { dir, log, obligation, judgement } = build();
    appendAttempt(log, judgement({ supersedesDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    appendAttempt(log, judgement({ supersedesDiscoveryId: first.id }));
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
    assert.deepEqual(answerChain(log, log.attempts.at(-1)).answers, []);
  });

  test('the two links name different roles, so a correction chain differs in both', () => {
    // selection-v1.0.27 required answersDiscoveryId === supersedesDiscoveryId, which refused the
    // repair that restores an answer link for being exactly what it is.
    const { dir, log, obligation, judgement } = build();
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id }));
    const first = log.attempts.at(-1);
    appendAttempt(log, judgement({ answersDiscoveryId: obligation.id, supersedesDiscoveryId: first.id }));
    const active = log.attempts.at(-1);
    assert.notEqual(active.answersDiscoveryId, active.supersedesDiscoveryId);
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
  });
});
