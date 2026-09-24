/**
 * The capture harness, exercised only against local synthetic pages.
 *
 * Protocol section 4: the capture harness is built and tested with synthetic pages before
 * any real page is opened. Nothing in this file reaches the network.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { capturePage, recordExamination, buildDraft, VIEWPORT, LOCALE, CATEGORIES, LEDGER_HEADER } from '../capture.mjs';
import { emptyLog, appendAttempt, deriveDraft, ELIGIBILITY_CRITERIA } from '../run.mjs';
import { prepareSet } from './helpers.mjs';

const browserFactory = () => chromium.launch();

// The harness accepts only http(s), so synthetic pages are served locally rather than
// loaded from disk. Nothing leaves the machine.
let server;
let origin;
before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  // Chromium keeps connections alive, and close() alone would wait for them, hanging the
  // test process after every assertion has already passed.
  server?.closeAllConnections?.();
  server?.close();
});

const inTemp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-capture-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic</title></head>
<body><form action="#"><label for="n">Full name</label>
<input id="n" name="fullName" autocomplete="name" pattern="[A-Za-z]+">
<button type="submit">Send</button></form>
<script>document.body.dataset.scriptRan = 'yes';</script></body></html>`;

describe('capture harness', () => {
  test('saves the rendered document, after scripts have run', async () => {
    await inTemp(async (dir) => {
      const out = join(dir, 'captures');
      const record = await capturePage({
        browserFactory,
        url: `${origin}/page`,
        agency: 'Synthetic Agency',
        website: 'https://example.invalid/',
        pageId: 'synthetic-001',
        category: 'enquiry-or-contact',
        outDir: out,
      });
      const saved = readFileSync(join(out, 'synthetic-001.html'), 'utf8');
      // The RENDERED document: a script that ran during load is reflected in what is saved.
      assert.match(saved, /data-script-ran="yes"/);
      assert.match(saved, /pattern="\[A-Za-z\]\+"/, 'the constraint under study survives capture');
      assert.equal(record.htmlSha256, createHash('sha256').update(saved).digest('hex'));
    });
  });

  test('records every provenance field the protocol requires', async () => {
    await inTemp(async (dir) => {
      const r = await capturePage({
        browserFactory,
        url: `${origin}/page`,
        agency: 'Synthetic Agency',
        website: 'https://example.invalid/',
        pageId: 'synthetic-002',
        category: 'service-application',
        outDir: join(dir, 'captures'),
      });
      for (const field of ['originalUrl', 'finalUrl', 'capturedAt', 'browser', 'automationTool', 'viewport', 'locale', 'redirects', 'category', 'file', 'htmlSha256']) {
        assert.ok(r[field] !== undefined, `missing provenance field ${field}`);
      }
      assert.deepEqual(r.viewport, VIEWPORT, 'the fixed medium viewport');
      assert.equal(r.locale, LOCALE);
      assert.match(r.browser, /Chromium \d/, 'the browser and version are recorded, not assumed');
      assert.match(r.automationTool, /playwright \d/);
      assert.match(r.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'UTC');
      assert.ok(Array.isArray(r.redirects));
    });
  });

  test('refuses to overwrite a capture', async () => {
    // An overwritten page would change what the corpus manifest hashes without changing
    // the manifest, which is the one thing the seal cannot detect afterwards.
    await inTemp(async (dir) => {
      const args = {
        browserFactory,
        url: `${origin}/page`,
        agency: 'A',
        website: 'https://example.invalid/',
        pageId: 'synthetic-003',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
      };
      await capturePage(args);
      await assert.rejects(() => capturePage(args), /refusing to overwrite/);
    });
  });

  test('rejects a category outside the protocol priority order', async () => {
    await assert.rejects(
      () => capturePage({ browserFactory, url: 'https://example.invalid/x', agency: 'A', website: 'w', pageId: 'x-001', category: 'whatever', outDir: tmpdir() }),
      /category must be one of/
    );
    assert.deepEqual(CATEGORIES, [
      'account-registration',
      'service-application',
      'enquiry-or-contact',
      'subscription-or-newsletter',
    ]);
  });

  test('the ledger records examinations that produced no capture', () => {
    // A ledger listing only successes cannot show that the draw order was followed.
    inTemp(async (dir) => {
      const ledger = join(dir, 'selection-ledger.csv');
      recordExamination(ledger, {
        examinedAt: '2026-09-24T00:00:00Z',
        agency: 'Agency, Comma',
        website: 'https://example.invalid/',
        url: 'https://example.invalid/search',
        status: 'excluded',
        exclusionReason: 'no personal-name field',
      });
      const text = readFileSync(ledger, 'utf8');
      assert.ok(text.startsWith(LEDGER_HEADER));
      assert.match(text, /"Agency, Comma"/, 'a comma in an agency name must not corrupt the ledger');
      assert.match(text, /excluded/);
    });
  });

  test('the draft it builds carries no analysis, only provenance', () => {
    const draft = buildDraft({
      pages: [{
        pageId: 'a-001', agency: 'A', website: 'w', originalUrl: 'u', finalUrl: 'u',
        capturedAt: '2026-09-24T00:00:00Z', browser: 'Chromium 1', automationTool: 'playwright 1',
        viewport: VIEWPORT, locale: LOCALE, redirects: [], category: 'enquiry-or-contact',
        file: 'a-001.html', htmlSha256: 'deadbeef',
      }],
      frameSha256: 'f'.repeat(64),
      drawOrderSha256: 'd'.repeat(64),
    });
    assert.equal(draft.schema, 'formfair/solo-corpus-draft@1');
    assert.equal(draft.synthetic, false);
    const page = draft.pages[0];
    assert.equal(page.htmlSha256, undefined, 'the seal computes hashes itself; the draft does not supply them');
    assert.equal(page.findings, undefined, 'a draft must never carry analyser output');
  });
});


/**
 * The load event, and the page that never fires one.
 *
 * capture-v1.0.3. A real page in the Te Puni Kokiri pilot - the Te Kahui Mangai contact
 * form - returned its document in 373ms and then held the load event open indefinitely on
 * a third-party analytics script. Under `waitUntil: 'load'` the whole page was discarded
 * as a navigation timeout, although its markup and its two personal-name inputs had
 * arrived long before. These tests fix both halves of the behaviour: a normal page is
 * still captured at the load event, and a stalled one is captured anyway and says so.
 *
 * The stalled subresources here are an image and an async script, deliberately. A
 * render-blocking `<script src>` in `<head>` would stall `domcontentloaded` as well, which
 * is a different failure with a different remedy; what the real page did was reach
 * `domcontentloaded` promptly and then never reach `load`.
 */
describe('load state', () => {
  let stallServer;
  let stallOrigin;
  const openSockets = new Set();

  const STALL_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stalled</title>
<script async src="/hang.js"></script></head>
<body><form action="#"><label for="n">Your name</label>
<input id="n" name="contactName" maxlength="60"></form>
<img src="/hang.gif" alt=""></body></html>`;

  before(async () => {
    stallServer = createServer((req, res) => {
      if (req.url === '/hang.js' || req.url === '/hang.gif') {
        // Headers only, body never sent, connection never closed: the subresource stays
        // in flight exactly as the real tracker did.
        res.writeHead(200, {
          'content-type': req.url.endsWith('.js') ? 'application/javascript' : 'image/gif',
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(STALL_PAGE);
    });
    stallServer.on('connection', (s) => {
      openSockets.add(s);
      s.on('close', () => openSockets.delete(s));
    });
    await new Promise((r) => stallServer.listen(0, '127.0.0.1', r));
    stallOrigin = `http://127.0.0.1:${stallServer.address().port}`;
  });

  after(() => {
    // These sockets are deliberately never closed by the handler, so the server would
    // otherwise keep the test process alive after the assertions have passed.
    for (const s of openSockets) s.destroy();
    stallServer?.closeAllConnections?.();
    stallServer?.close();
  });

  test('a page that reaches load records loadState "load" and nothing outstanding', async () => {
    await inTemp(async (dir) => {
      const record = await capturePage({
        browserFactory,
        url: `${origin}/page`,
        agency: 'Synthetic Agency',
        website: origin,
        pageId: 'load-fires',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
        settleMs: 10,
      });
      assert.equal(record.loadState, 'load');
      assert.deepEqual(record.outstandingRequests, []);
    });
  });

  test('a page whose load event never fires is still captured, with its markup intact', async () => {
    await inTemp(async (dir) => {
      const out = join(dir, 'captures');
      const record = await capturePage({
        browserFactory,
        url: `${stallOrigin}/contact`,
        agency: 'Synthetic Agency',
        website: stallOrigin,
        pageId: 'load-stalls',
        category: 'enquiry-or-contact',
        outDir: out,
        settleMs: 10,
        loadEventTimeoutMs: 1000,
      });

      assert.equal(record.loadState, 'domcontentloaded');
      assert.equal(record.httpStatus, 200);

      // The point of the change: the form survived.
      const html = readFileSync(join(out, 'load-stalls.html'), 'utf8');
      assert.match(html, /name="contactName"/);
      assert.match(html, /maxlength="60"/);
      assert.equal(record.htmlSha256, createHash('sha256').update(html).digest('hex'));
    });
  });

  test('the requests that held the load event open are named on the record', async () => {
    await inTemp(async (dir) => {
      const record = await capturePage({
        browserFactory,
        url: `${stallOrigin}/contact`,
        agency: 'Synthetic Agency',
        website: stallOrigin,
        pageId: 'load-stalls-named',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
        settleMs: 10,
        loadEventTimeoutMs: 1000,
      });
      assert.ok(
        record.outstandingRequests.some((u) => u.endsWith('/hang.gif')),
        `expected /hang.gif among ${JSON.stringify(record.outstandingRequests)}`
      );
    });
  });

  test('a stalled page costs the load budget, not the navigation budget', async () => {
    await inTemp(async (dir) => {
      const started = Date.now();
      await capturePage({
        browserFactory,
        url: `${stallOrigin}/contact`,
        agency: 'Synthetic Agency',
        website: stallOrigin,
        pageId: 'load-stalls-budget',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
        settleMs: 10,
        loadEventTimeoutMs: 1000,
      });
      // Generous, because it is asserting that the 45s navigation timeout is no longer
      // what a stalled page waits for, not that Chromium starts in any particular time.
      assert.ok(Date.now() - started < 30000, `stalled capture took ${Date.now() - started}ms`);
    });
  });
});

/**
 * The load deviation survives the whole chain, and a stalled page is bounded at both ends.
 *
 * capture-v1.0.3. `loadState` is only worth recording if it reaches the artefact the seal
 * hashes. If it stopped at the log, two captures of the same page taken in different load
 * states would be indistinguishable in the sealed corpus, and the reproducibility claim
 * the seal exists to support would be false.
 */
describe('the load deviation is carried, not just recorded', () => {
  let stallServer;
  let stallOrigin;
  const openSockets = new Set();

  const STALL_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stalled</title>
<script async src="/hang.js"></script></head>
<body><form action="#"><label for="n">Your name</label>
<input id="n" name="contactName" maxlength="60"></form>
<img src="/hang.gif?session=abc123&cache=987654321#frag" alt=""></body></html>`;

  before(async () => {
    stallServer = createServer((req, res) => {
      if (req.url.startsWith('/hang.js') || req.url.startsWith('/hang.gif')) {
        res.writeHead(200, {
          'content-type': req.url.startsWith('/hang.js') ? 'application/javascript' : 'image/gif',
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(STALL_PAGE);
    });
    stallServer.on('connection', (s) => {
      openSockets.add(s);
      s.on('close', () => openSockets.delete(s));
    });
    await new Promise((r) => stallServer.listen(0, '127.0.0.1', r));
    stallOrigin = `http://127.0.0.1:${stallServer.address().port}`;
  });

  after(() => {
    for (const s of openSockets) s.destroy();
    stallServer?.closeAllConnections?.();
    stallServer?.close();
  });

  const HASH = 'a'.repeat(64);

  test('capture to log to draft preserves the load state, and the draft hash covers it', async () => {
    await inTemp(async (dir) => {
      const record = await capturePage({
        browserFactory,
        url: `${stallOrigin}/contact`,
        agency: 'Te Puni Kokiri',
        website: stallOrigin,
        pageId: 'chain-stalls',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
        settleMs: 10,
        loadEventTimeoutMs: 1000,
      });
      assert.equal(record.loadState, 'domcontentloaded');

      const log = emptyLog();
      prepareSet(log, 'Te Puni Kokiri', 'enquiry-or-contact', [`${stallOrigin}/contact`]);
      appendAttempt(log, {
        examinedAt: '2026-09-24T01:00:00Z',
        ...record,
        url: `${stallOrigin}/contact`,
        status: 'captured',
        inclusionEvidence: 'synthetic page with a personal-name field',
        eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, true])),
      });
      // The discovery record that supports the set is an attempt too, and the draft is
      // held until every decision is approved.
      for (const a of log.attempts) a.approval = 'approved';

      // The log kept it.
      assert.equal(log.attempts.at(-1).loadState, 'domcontentloaded');

      // The draft kept it.
      const draft = deriveDraft(log, { frameSha256: HASH, drawOrderSha256: HASH });
      const page = draft.pages.find((p) => p.pageId === 'chain-stalls');
      assert.equal(page.loadState, 'domcontentloaded');
      assert.ok(page.outstandingRequests.length > 0);

      // And the seal would notice if it changed, because the draft it hashes contains it.
      const digest = (d) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
      const tampered = structuredClone(draft);
      tampered.pages.find((p) => p.pageId === 'chain-stalls').loadState = 'load';
      assert.notEqual(digest(draft), digest(tampered));
    });
  });

  test('a page captured at its load event records loadState "load" in the draft', async () => {
    await inTemp(async (dir) => {
      const record = await capturePage({
        browserFactory,
        url: `${origin}/page`,
        agency: 'Te Puni Kokiri',
        website: origin,
        pageId: 'chain-loads',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
        settleMs: 10,
      });
      const log = emptyLog();
      prepareSet(log, 'Te Puni Kokiri', 'enquiry-or-contact', [`${origin}/page`]);
      appendAttempt(log, {
        examinedAt: '2026-09-24T01:00:00Z',
        ...record,
        url: `${origin}/page`,
        status: 'captured',
        inclusionEvidence: 'synthetic page with a personal-name field',
        eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, true])),
      });
      // The discovery record that supports the set is an attempt too, and the draft is
      // held until every decision is approved.
      for (const a of log.attempts) a.approval = 'approved';
      const draft = deriveDraft(log, { frameSha256: HASH, drawOrderSha256: HASH });
      assert.equal(draft.pages[0].loadState, 'load');
      assert.deepEqual(draft.pages[0].outstandingRequests, []);
    });
  });

  test('an outstanding request is recorded as origin and path, without query or fragment', async () => {
    await inTemp(async (dir) => {
      const record = await capturePage({
        browserFactory,
        url: `${stallOrigin}/contact`,
        agency: 'Te Puni Kokiri',
        website: stallOrigin,
        pageId: 'stalls-sanitised',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
        settleMs: 10,
        loadEventTimeoutMs: 1000,
      });
      const gif = record.outstandingRequests.find((u) => u.endsWith('/hang.gif'));
      assert.ok(gif, `expected a sanitised /hang.gif among ${JSON.stringify(record.outstandingRequests)}`);
      assert.equal(gif, `${stallOrigin}/hang.gif`);
      for (const u of record.outstandingRequests) {
        assert.ok(!u.includes('?'), `query survived in ${u}`);
        assert.ok(!u.includes('#'), `fragment survived in ${u}`);
        assert.ok(!u.includes('session=') && !u.includes('987654321'), `token survived in ${u}`);
      }
    });
  });

  test('a stalled capture is bounded below by its load budget and above by well under the navigation budget', async () => {
    await inTemp(async (dir) => {
      const budget = 1500;
      const settle = 10;
      const started = Date.now();
      await capturePage({
        browserFactory,
        url: `${stallOrigin}/contact`,
        agency: 'Te Puni Kokiri',
        website: stallOrigin,
        pageId: 'stalls-bounded',
        category: 'enquiry-or-contact',
        outDir: join(dir, 'captures'),
        settleMs: settle,
        loadEventTimeoutMs: budget,
      });
      const elapsed = Date.now() - started;
      // Lower bound: it really did wait for the load event rather than capturing at
      // domcontentloaded and calling it a deviation. Without this, shortening the wait to
      // nothing would still pass every other test here.
      assert.ok(elapsed >= budget + settle, `returned in ${elapsed}ms, before the ${budget}ms load budget elapsed`);
      // Upper bound: the 45s navigation timeout is no longer what a stalled page pays.
      assert.ok(elapsed < 30000, `stalled capture took ${elapsed}ms`);
    });
  });

  test('a load-state error that is not a timeout stays a failure', async () => {
    await inTemp(async (dir) => {
      // A browser whose waitForLoadState fails for a reason other than a timeout: the
      // capture did not happen, and must not be downgraded into a successful capture of an
      // unknown document.
      const crashingFactory = async () => {
        const browser = await browserFactory();
        const realNewContext = browser.newContext.bind(browser);
        browser.newContext = async (...args) => {
          const context = await realNewContext(...args);
          const realNewPage = context.newPage.bind(context);
          context.newPage = async () => {
            const page = await realNewPage();
            page.waitForLoadState = async () => {
              const error = new Error('Target page, context or browser has been closed');
              error.name = 'Error';
              throw error;
            };
            return page;
          };
          return context;
        };
        return browser;
      };

      await assert.rejects(
        () =>
          capturePage({
            browserFactory: crashingFactory,
            url: `${origin}/page`,
            agency: 'Te Puni Kokiri',
            website: origin,
            pageId: 'load-error',
            category: 'enquiry-or-contact',
            outDir: join(dir, 'captures'),
            settleMs: 10,
          }),
        /has been closed/
      );
      // Nothing was written: a failure must not leave a partial capture behind.
      assert.equal(existsSync(join(dir, 'captures', 'load-error.html')), false);
    });
  });
});
