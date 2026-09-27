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
import { mkdtempSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { renderDiscoveryPage } from '../render-discovery.mjs';
import { capturePage } from '../capture.mjs';
import { MAX_REDIRECT_HOPS } from '../redirect-guard.mjs';
import { emptyLog, recordRobotsCheck, renderBacklog, appendAttempt, sha256 } from '../run.mjs';
import { evaluatePolicy } from '../robots-policy.mjs';

const FORM = '<html><head><title>Destination</title></head><body><input id="q7" type="text"></body></html>';

/** Two independent servers, so "which server was asked" is unambiguous. */
let origin;
let other;
let hits;
let otherHits;
let server;
let otherServer;

before(async () => {
  hits = [];
  otherHits = [];
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

    // A render of /apply was attempted and refused at the policy boundary.
    appendAttempt(log, {
      examinedAt: '2026-09-26T19:10:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'disallowed', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:10:00Z', approval: 'approved',
      renderRefused: true,
      redirectChain: [{ from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/forbidden', httpStatus: 302, allowed: false }],
    });
    assert.deepEqual(renderBacklog(log).map((a) => a.id), [reachable.id],
      '/apply is discharged as attrition; /other still owes a render');
  });
});
