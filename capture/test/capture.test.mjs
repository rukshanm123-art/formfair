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
