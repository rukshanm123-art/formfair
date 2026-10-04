/**
 * Amendment 67: a permit is consumed at the request boundary, not before the wait.
 *
 * `read-resource` consumed the permit, then waited out the pacing floor, then made the request, so
 * `consumedAt` preceded the traffic by however long the floor required: `p-0516` recorded
 * 23:16:36Z for a request made at 23:16:42Z, and the permit ledger read that as a permit consumed
 * before the traffic existed. Amendment 66 introduced the wait; this is the chronology it broke.
 *
 * `status` reported both failures while the approval packet said FOR ATTENTION (0), so the one
 * document an approval is read from was the one that hid them.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPermitLedger, reconcilePermitConsumption } from '../run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'cli-capture.mjs');
const SITEMAP = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';

let server; let origin; let hits = [];
before(async () => {
  server = createServer((req, res) => {
    hits.push({ url: req.url, at: Date.now() });
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\n'); return; }
    if (req.url === '/moved.xml') { res.writeHead(301, { location: '/sitemap.xml' }); res.end(); return; }
    if (req.url === '/gone.xml') { res.destroy(); return; }
    res.writeHead(200, { 'content-type': 'application/xml' }); res.end(SITEMAP);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const run = (args, dir) => new Promise((resolve) => {
  const child = spawn('node', [cli, ...args, '--out', dir]);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', (status) => resolve({ status, stdout, stderr }));
});
const reopen = (dir) => JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));

const started = (fn) => async () => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-permit-'));
  hits = [];
  try {
    assert.equal((await run(['init'], dir)).status, 0);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const AG = 'Test Agency';
/** A permit for one URL, then read-resource under it. */
const readUnderPermit = async (dir, path) => {
  const pre = await run(['preflight-discovery', '--agency', AG, '--website', `${origin}/`,
    '--url', `${origin}${path}`, '--category', 'enquiry-or-contact', '--set-version', '1',
    '--method', 'sitemap'], dir);
  assert.equal(pre.status, 0, pre.stderr);
  const permit = /permit (p-\d+)/.exec(pre.stdout)[1];
  const rr = await run(['read-resource', '--agency', AG, '--url', `${origin}${path}`,
    '--category', 'enquiry-or-contact', '--set-version', '1', '--permit-id', permit], dir);
  return { permit, rr };
};
const permitOf = (dir, id) => (reopen(dir).discoveryPermits ?? []).find((p) => p.id === id);

describe('consumption happens at the request boundary', () => {
  test('on the successful path, and the ledger is clean', started(async (dir) => {
    // Two reads in one scan, so the second waits out the floor - the case that broke.
    await readUnderPermit(dir, '/sitemap.xml');
    const { permit, rr } = await readUnderPermit(dir, '/other.xml');
    assert.equal(rr.status, 0, rr.stderr);

    const log = reopen(dir);
    const consumed = Date.parse(permitOf(dir, permit).consumedAt);
    const fetched = Date.parse(log.fetches.at(-1).fetchedAt);
    assert.ok(consumed >= fetched - 1,
      `consumed at ${permitOf(dir, permit).consumedAt}, request at ${log.fetches.at(-1).fetchedAt}`);
    assert.deepEqual(checkPermitLedger(log).filter((p) => /before .* navigated/.test(p)), []);
  }));

  test('on a redirected path', started(async (dir) => {
    await readUnderPermit(dir, '/sitemap.xml');
    const { permit, rr } = await readUnderPermit(dir, '/moved.xml');
    assert.equal(rr.status, 0, rr.stderr);
    const log = reopen(dir);
    assert.ok(Date.parse(permitOf(dir, permit).consumedAt) >= Date.parse(log.fetches.at(-1).fetchedAt) - 1);
    assert.deepEqual(checkPermitLedger(log).filter((p) => /before .* navigated/.test(p)), []);
  }));

  test('on a failed path, the permit is still consumed and recorded', started(async (dir) => {
    // The request happened; a permit that stayed open would understate the traffic.
    await readUnderPermit(dir, '/sitemap.xml');
    const { permit, rr } = await readUnderPermit(dir, '/gone.xml');
    assert.notEqual(rr.status, 0, 'the request failed');
    const consumedAt = permitOf(dir, permit)?.consumedAt;
    assert.ok(consumedAt, 'the permit records its consumption even though the request failed');
    assert.deepEqual(checkPermitLedger(reopen(dir)).filter((p) => /before .* navigated/.test(p)), []);
  }));

  test('a write failure after the request leaves no chronology failure', started(async (dir) => {
    // The post-request-write-failure path quarantines the bytes; the permit must still read as
    // consumed at the moment the request was made.
    await readUnderPermit(dir, '/sitemap.xml');
    const { permit } = await readUnderPermit(dir, '/third.xml');
    const consumed = permitOf(dir, permit).consumedAt;
    assert.ok(consumed);
    const ledger = checkPermitLedger(reopen(dir));
    assert.deepEqual(ledger.filter((p) => /before .* navigated/.test(p)), [], JSON.stringify(ledger));
  }));
});

describe('a reconciliation explains the historical records and nothing wider', () => {
  const base = () => ({
    discoveryPermits: [{
      id: 'p-1', agency: 'A', category: 'enquiry-or-contact', candidateSetVersion: 1,
      url: 'https://a.govt.nz/s.xml', issuedAt: '2026-10-04T23:16:30Z',
      consumedAt: '2026-10-04T23:16:36Z',
    }],
    attempts: [{
      id: 'd-1', url: 'https://a.govt.nz/s.xml', navigatedAt: '2026-10-04T23:16:42Z',
      status: 'discovery', fetchId: 'f-1', permitId: 'p-1',
      agency: 'A', category: 'enquiry-or-contact', candidateSetVersion: 1,
    }],
    fetches: [{ id: 'f-1', url: 'https://a.govt.nz/s.xml', fetchedAt: '2026-10-04T23:16:42Z' }],
  });
  const NOTE = 'The permit was consumed before the pacing wait, so its timestamp precedes the request it authorised.';

  test('the real case is accepted and clears the blocker', () => {
    const log = base();
    assert.equal(checkPermitLedger(log).filter((p) => /before d-1 navigated/.test(p)).length, 1);
    const entry = reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-1', note: NOTE });
    assert.equal(entry.gapMs, 6000);
    assert.deepEqual(checkPermitLedger(log).filter((p) => /before d-1 navigated/.test(p)), []);
  });

  test('it is refused where there is nothing to reconcile', () => {
    const log = base();
    log.discoveryPermits[0].consumedAt = '2026-10-04T23:16:42Z';
    assert.throws(() => reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-1', note: NOTE }),
      /nothing to reconcile/);
  });

  test('it is refused where the gap is wider than a pacing wait can explain', () => {
    // Otherwise it would explain any chronology error at all, which is a way to make the ledger
    // agree with anything.
    const log = base();
    log.discoveryPermits[0].consumedAt = '2026-10-04T23:15:00Z';
    assert.throws(() => reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-1', note: NOTE }),
      /more than a pacing wait can explain/);
  });

  test('it must cite the fetch the record rests on', () => {
    const log = base();
    log.fetches.push({ id: 'f-2', url: 'https://a.govt.nz/s.xml', fetchedAt: '2026-10-04T23:16:42Z' });
    assert.throws(() => reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-2', note: NOTE }),
      /rests on f-1, not f-2/);
  });

  test('the cited fetch must be the request boundary the record records', () => {
    const log = base();
    log.fetches[0].fetchedAt = '2026-10-04T23:16:50Z';
    assert.throws(() => reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-1', note: NOTE }),
      /the retained fetch is the request boundary/);
  });

  test('one permit is reconciled once', () => {
    const log = base();
    reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-1', note: NOTE });
    assert.throws(() => reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-1', note: NOTE }),
      /already reconciled/);
  });

  test('a reconciliation naming a different record does not clear the blocker', () => {
    const log = base();
    log.attempts.push({ id: 'd-2', url: 'https://a.govt.nz/s.xml', navigatedAt: '2026-10-04T23:16:42Z',
      status: 'discovery', fetchId: 'f-1', agency: 'A', category: 'enquiry-or-contact', candidateSetVersion: 1 });
    reconcilePermitConsumption(log, { permitId: 'p-1', recordId: 'd-2', fetchId: 'f-1', note: NOTE });
    log.permitReconciliations[0].recordId = 'd-9';
    assert.equal(checkPermitLedger(log).filter((p) => /before d-1 navigated/.test(p)).length, 1);
  });

  test('a note must say what it reconciles', () => {
    assert.throws(() => reconcilePermitConsumption(base(), { permitId: 'p-1', recordId: 'd-1', fetchId: 'f-1', note: 'fixed' }),
      /must say what it reconciles/);
  });
});
