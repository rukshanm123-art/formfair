/**
 * Amendment 59: the structural report was computed and discarded.
 *
 * Amendments 46 and 51 added four fields to `detectBlocking` - `registrationAffordances`,
 * `nameFields`, `collectedNameFields` and `searchKeyNameFields` - and stated that the researcher's
 * criterion-three assertion must be consistent with the recorded report. BOTH writers dropped them.
 * Across the live log the name-field report was persisted on **zero** of 348 attempts and **zero**
 * of 319 renders, while the affordance report survived on one render that had been populated by
 * hand. So the contract had never held.
 *
 * It had already corrupted an approved decision: `c-0976` cited "the structural name-field report is
 * empty" as evidence that a login page asked for nobody's name. The field did not exist, so a
 * `?? []` default had been read as a finding - the same mistake this project made earlier with
 * `a.bytes` and with `checkedAt`.
 *
 * Both amendments had tests, and both passed, because they tested `detectBlocking` in isolation.
 * Testing the function proved the report was COMPUTED; nothing tested that it was KEPT. So these
 * tests drive the real pipelines - a browser, a served page, a genuine form - and assert the report
 * arrives on the record a reader will actually read.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { capturePage, detectBlocking, structuralReport, STRUCTURAL_REPORT_VERSION, VIEWPORT, LOCALE } from '../capture.mjs';
import { renderDiscoveryPage } from '../render-discovery.mjs';
import {
  structuralReportProblems, structuralReportAudit, bearsDocument, emptyLog,
  STRUCTURAL_REPORT_REQUIRED_FROM, corpusBlockers,
} from '../run.mjs';
import { STRUCTURAL_REPORT_SOURCES } from '../capture.mjs';
import { structuralReportProblems as sealerProblems } from '../../evaluation/solo/descriptive.mjs';

/** A real contact form, of the shape the study exists to measure. */
const CONTACT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact us</title></head>
<body>
  <form action="/search" method="get"><input type="search" name="q" placeholder="Search"><input type="submit" value="Search"></form>
  <form action="/contact-us/Form" method="post" id="UserForm">
    <label for="n">Your name*</label><input type="text" name="EditableTextField_dd027" id="n" required>
    <label for="e">Your email address*</label><input type="email" name="EditableTextField_64a4a" id="e" required>
    <label for="s">Subject*</label><input type="text" name="EditableTextField_87d57" id="s" required>
    <label for="m">Your message*</label><textarea name="EditableTextField_13052" id="m" required></textarea>
    <input type="submit" name="action_process" value="Submit">
  </form>
</body></html>`;

/** A record-search form: a name field that is a QUERY, not a collection. Amendment 51. */
const FINDING_AID = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Search records</title></head>
<body><form action="/search/results" method="get">
  <label for="sn">Surname</label><input type="text" name="field_surname_value" id="sn" maxlength="128">
  <input type="submit" value="Search">
</form></body></html>`;

let server;
let origin;
before(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/contact')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(CONTACT); return; }
    if (req.url.startsWith('/records')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FINDING_AID); return; }
    res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><html><body>no</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const inTemp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-structural-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

describe('THE PIPELINE: a captured page carries the report a reader will read', () => {
  test('a real contact form, captured end to end, persists the report', async () => {
    // This is the test whose absence let the defect through. It does not call `detectBlocking`:
    // it captures a served page and inspects the RECORD.
    await inTemp(async (dir) => {
      const record = await capturePage({
        browserFactory: () => chromium.launch(),
        url: `${origin}/contact-us`, agency: 'Test Agency', website: `${origin}/`,
        pageId: 'contact', category: 'enquiry-or-contact', outDir: dir, settleMs: 200,
        policyFor: () => ({ allowed: true, reason: 'test' }),
      });
      assert.equal(record.refused, false);
      assert.equal(record.httpStatus, 200);
      // The four fields, on the record.
      assert.equal(record.structuralReportVersion, STRUCTURAL_REPORT_VERSION);
      assert.ok(Array.isArray(record.nameFields), 'nameFields must be on the record');
      assert.ok(Array.isArray(record.registrationAffordances));
      assert.equal(typeof record.collectedNameFields, 'number');
      assert.equal(typeof record.searchKeyNameFields, 'number');
      // And it must have found the real name field, classified as collection.
      assert.equal(record.collectedNameFields, 1, JSON.stringify(record.nameFields));
      assert.equal(record.searchKeyNameFields, 0);
      const field = record.nameFields.find((f) => f.role === 'collection');
      assert.match(field.label ?? '', /Your name/);
      assert.deepEqual(structuralReportProblems(record), []);
      assert.deepEqual(sealerProblems({ attempts: [record], renders: [] }), []);
    });
  });

  test('a record-search page persists a QUERY name field, not a collected one', async () => {
    await inTemp(async (dir) => {
      const record = await capturePage({
        browserFactory: () => chromium.launch(),
        url: `${origin}/records`, agency: 'Test Agency', website: `${origin}/`,
        pageId: 'records', category: 'service-application', outDir: dir, settleMs: 200,
        policyFor: () => ({ allowed: true, reason: 'test' }),
      });
      assert.equal(record.searchKeyNameFields, 1, JSON.stringify(record.nameFields));
      assert.equal(record.collectedNameFields, 0);
      assert.deepEqual(structuralReportProblems(record), []);
    });
  });

  test('the RENDER pipeline persists it too, not only the capture pipeline', async () => {
    // Two writers dropped the report, so both pipelines are driven. Testing one would have left
    // the other exactly as it was.
    await inTemp(async (dir) => {
      const render = await renderDiscoveryPage({
        browserFactory: () => chromium.launch(),
        url: `${origin}/contact-us`, outDir: dir, recordId: 'g-test', settleMs: 200,
        policyFor: () => ({ allowed: true, reason: 'test' }),
      });
      assert.equal(render.httpStatus, 200);
      assert.equal(render.structuralReportVersion, STRUCTURAL_REPORT_VERSION);
      assert.ok(Array.isArray(render.nameFields));
      assert.equal(render.collectedNameFields, 1, JSON.stringify(render.nameFields));
      assert.equal(render.searchKeyNameFields, 0);
      assert.deepEqual(structuralReportProblems(render), []);
      assert.deepEqual(sealerProblems({ attempts: [], renders: [render] }), []);
    });
  });

  test('the live report is not an offline replay of the saved markup', async () => {
    // The limitation, tested rather than assumed. `nameFields` depends on VISIBILITY, which is a
    // fact about the live page: the saved HTML has no external stylesheets, so replaying it in a
    // browser can show controls the live page hid, or hide controls it showed. The persisted report
    // is therefore the authority, and re-deriving it offline is not equivalent.
    await inTemp(async (dir) => {
      const live = await capturePage({
        browserFactory: () => chromium.launch(),
        url: `${origin}/contact-us`, agency: 'Test Agency', website: `${origin}/`,
        pageId: 'replay', category: 'enquiry-or-contact', outDir: dir, settleMs: 200,
        policyFor: () => ({ allowed: true, reason: 'test' }),
      });
      // Replay the SAVED bytes with a stylesheet that hides the form, which the live page did not
      // have. The replay disagrees with the live report - and the live report is the record.
      const browser = await chromium.launch();
      try {
        const page = await (await browser.newContext({ viewport: VIEWPORT, locale: LOCALE })).newPage();
        await page.setContent(`<style>#UserForm{display:none}</style>${CONTACT}`);
        const replayed = structuralReport(await detectBlocking(page, 200));
        assert.equal(live.collectedNameFields, 1, 'the live page showed the field');
        assert.equal(replayed.collectedNameFields, 0, 'the replay, styled differently, did not');
        assert.notDeepEqual(replayed.nameFields, live.nameFields);
      } finally {
        await browser.close();
      }
    });
  });
});

describe('a request that obtained no document must carry no report', () => {
  test('bearsDocument distinguishes them', () => {
    assert.equal(bearsDocument({ htmlSha256: 'a'.repeat(64) }), true);
    assert.equal(bearsDocument({ renderedSha256: 'a'.repeat(64) }), true);
    assert.equal(bearsDocument({ refused: true, htmlSha256: 'a'.repeat(64) }), false);
    assert.equal(bearsDocument({}), false);
    assert.equal(bearsDocument(null), false);
  });

  test('a refused request carrying a report is refused', () => {
    const r = { id: 'c-1', refused: true, url: 'https://a.govt.nz/', nameFields: [], structuralReportVersion: 1 };
    const p = structuralReportProblems(r);
    assert.equal(p.length > 0, true);
    assert.match(p.join(' '), /obtained no document/);
    assert.ok(sealerProblems({ attempts: [r], renders: [] }).length > 0);
  });

  test('a refused request with no report is clean', () => {
    assert.deepEqual(structuralReportProblems({ id: 'c-1', refused: true, url: 'https://a.govt.nz/' }), []);
  });
});

describe('the gates reject a report that is missing, malformed or inconsistent', () => {
  const after = new Date(STRUCTURAL_REPORT_REQUIRED_FROM + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sound = (over = {}) => ({
    id: 'c-1', url: 'https://a.govt.nz/contact', htmlSha256: 'a'.repeat(64), htmlBytes: 10,
    capturedAt: after, refused: false,
    structuralReportVersion: 1, structuralReportSource: 'live',
    registrationAffordances: [],
    nameFields: [{ name: 'name', label: 'Your name', role: 'collection', basis: [] }],
    collectedNameFields: 1, searchKeyNameFields: 0, ...over,
  });
  const both = (r, cited) => {
    const capture = structuralReportProblems(r, { citedFrom: cited });
    const sealer = sealerProblems({
      attempts: cited ? [cited, { ...r, evidenceFromAttemptId: cited.id }] : [r], renders: [],
    });
    assert.equal(capture.length > 0, sealer.length > 0,
      `disagreement:\n  capture: ${JSON.stringify(capture)}\n  sealer: ${JSON.stringify(sealer)}`);
    return { capture, clean: capture.length === 0 };
  };

  test('a sound report passes both', () => {
    assert.ok(both(sound()).clean);
  });

  test('MISSING: a document-bearing record after the boundary with no report', () => {
    const r = { id: 'c-1', url: 'https://a.govt.nz/contact', htmlSha256: 'a'.repeat(64), capturedAt: after, refused: false };
    const v = both(r);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /carries no structural report/);
  });

  test('MALFORMED: nameFields not an array, a bad role, a missing basis', () => {
    assert.equal(both(sound({ nameFields: 'lots' })).clean, false);
    assert.equal(both(sound({ nameFields: [{ role: 'maybe', basis: [] }], collectedNameFields: 0 })).clean, false);
    assert.equal(both(sound({ nameFields: [{ role: 'collection' }] })).clean, false);
  });

  test('MALFORMED: a count that is not a count', () => {
    assert.equal(both(sound({ collectedNameFields: '1' })).clean, false);
    assert.equal(both(sound({ searchKeyNameFields: -1 })).clean, false);
  });

  test('INCONSISTENT COUNTS: the counts must be the counts', () => {
    // Worse than no report: a reader takes the counts as the finding.
    const v = both(sound({ collectedNameFields: 7 }));
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /but nameFields holds 1/);
  });

  test('VERSION: an unversioned report must not pass as current', () => {
    const v = both(sound({ structuralReportVersion: undefined }));
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /structuralReportVersion/);
  });

  test('VERSION: a version this protocol never issued is refused', () => {
    assert.equal(both(sound({ structuralReportVersion: 99 })).clean, false);
  });

  test('COPIED INCONSISTENTLY: a report differing from the evidence it cites', () => {
    const source = sound({ id: 'c-0', url: 'https://a.govt.nz/contact' });
    const copy = sound({ id: 'c-2', nameFields: [], collectedNameFields: 0 });
    const v = both(copy, source);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /differs from c-0/);
  });

  test('WRONG PAGE: a report attached to evidence for another URL', () => {
    const source = sound({ id: 'c-0', url: 'https://a.govt.nz/other' });
    const v = both(sound({ id: 'c-2' }), source);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /different page|not https/);
  });

  test('a faithful copy of the cited evidence passes', () => {
    const source = sound({ id: 'c-0' });
    assert.ok(both(sound({ id: 'c-2' }), source).clean);
  });

  test('and the corpus gate raises it', () => {
    const log = { ...emptyLog(), attempts: [sound({ collectedNameFields: 7 })] };
    assert.ok(structuralReportAudit(log).length > 0);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'structural-report'));
  });
});

describe('records from before the boundary are grandfathered, not laundered', () => {
  const before = new Date(STRUCTURAL_REPORT_REQUIRED_FROM - 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  test('a pre-boundary record with no report at all is accepted', () => {
    // 348 attempts and 319 renders predate the repair. Failing them would be rewriting history.
    const r = { id: 'c-1', url: 'https://a.govt.nz/', htmlSha256: 'a'.repeat(64), capturedAt: before, refused: false };
    assert.deepEqual(structuralReportProblems(r), []);
  });

  test('a pre-boundary PARTIAL report is accepted, as g-0163 is', () => {
    // `g-0163`'s `registrationAffordances` was derived by hand from the retained bytes during the
    // Amendment 46 reclassification. It is real evidence and materially different from a report
    // that never existed, so it is kept.
    const g = {
      id: 'g-0163', url: 'https://a.govt.nz/login', renderedSha256: 'a'.repeat(64),
      navigatedAt: before, registrationAffordances: [{ label: 'Register', element: 'a', target: '/r' }],
    };
    assert.deepEqual(structuralReportProblems(g), []);
    assert.equal(g.structuralReportVersion, undefined, 'and it is marked pre-amendment by having no version');
  });

  test('but a pre-boundary record cannot claim a current version it never had', () => {
    const g = {
      id: 'g-0163', url: 'https://a.govt.nz/login', renderedSha256: 'a'.repeat(64),
      navigatedAt: before, structuralReportVersion: 42,
    };
    assert.ok(structuralReportProblems(g).length > 0);
  });

});

describe('Amendment 60: a report declares how it was obtained', () => {
  const after = new Date(STRUCTURAL_REPORT_REQUIRED_FROM + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const preBoundary = new Date(STRUCTURAL_REPORT_REQUIRED_FROM - 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // Evidence captured before any report existed - exactly c-0974's situation.
  const evidence = {
    id: 'c-0974', url: 'https://a.govt.nz/login', htmlSha256: 'a'.repeat(64),
    capturedAt: preBoundary, refused: false,
  };
  const reanalysis = (over = {}) => ({
    id: 'c-0978', url: evidence.url, htmlSha256: evidence.htmlSha256, examinedAt: after,
    refused: false, evidenceFromAttemptId: 'c-0974',
    structuralReportVersion: 1, structuralReportSource: 'offline-reanalysis',
    registrationAffordances: [], nameFields: [], collectedNameFields: 0, searchKeyNameFields: 0,
    ...over,
  });
  const both = (r, cited) => {
    const capture = structuralReportProblems(r, { citedFrom: cited });
    const sealer = sealerProblems({ attempts: cited ? [cited, r] : [r], renders: [] });
    assert.equal(capture.length > 0, sealer.length > 0,
      `disagreement:\n  capture: ${JSON.stringify(capture)}\n  sealer: ${JSON.stringify(sealer)}`);
    return { capture, clean: capture.length === 0 };
  };

  test('a reanalysis of pre-amendment bytes is permitted, which Amendment 59 refused', () => {
    // The repair this enables: c-0976 rested on a report that never existed, and the evidence it
    // cites was captured before any report was taken. Under Amendment 59 alone the corrected
    // record could not be written at all.
    assert.ok(both(reanalysis(), evidence).clean);
  });

  test('the same report claiming to be live is refused', () => {
    // Equality with the cited evidence is the rule for a copy, and there is nothing to copy.
    const v = both(reanalysis({ structuralReportSource: 'live' }), evidence);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /differs from c-0974/);
  });

  test('a reanalysis citing nothing is refused', () => {
    assert.equal(both(reanalysis({ evidenceFromAttemptId: undefined })).clean, false);
  });

  test('a reanalysis citing evidence that holds no document is refused', () => {
    const empty = { id: 'c-0974', url: evidence.url, refused: true, capturedAt: preBoundary };
    const v = both(reanalysis(), empty);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /holds no document/);
  });

  test('a reanalysis of a different page is refused', () => {
    const other = { ...evidence, url: 'https://a.govt.nz/elsewhere' };
    assert.equal(both(reanalysis(), other).clean, false);
  });

  test('an unknown source is refused', () => {
    assert.equal(both(reanalysis({ structuralReportSource: 'guessed' }), evidence).clean, false);
  });

  test('the pipelines record live, never a reanalysis', () => {
    assert.equal(structuralReport({}).structuralReportSource, 'live');
    assert.equal(structuralReport({}, { source: 'offline-reanalysis' }).structuralReportSource, 'offline-reanalysis');
  });
});
