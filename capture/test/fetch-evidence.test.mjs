/**
 * Amendment 55: a plainly-read resource retains its bytes, like a render does.
 *
 * The sitemap method read a resource outside the browser and the harness kept NOTHING: `discovery`
 * recorded an outcome the operator supplied, and the bytes were gone. So every sitemap judgement in
 * this study rested on a reading no reader could check, and the log could not distinguish a
 * document that was read from one that was described.
 *
 * That is not hypothetical. Four approved Ministry of Health records - `d-0276`, `d-0278`, `d-0280`
 * and `d-0282` - state that the index's "SiteTree sitemap lists /footer/contact-us/", and the log
 * contains no retrieval of any child sitemap: zero of its permits were ever issued for one. The
 * claim could not be checked because nothing was retained, and it is disclosed as deviation
 * `v-0003`.
 *
 * So the registry mirrors the render registry deliberately - same shape, same verification - and
 * these tests are mostly the ways a retained reading must fail to verify.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  emptyLog, recordFetch, findFetch, assertFetchEvidenceUsable, checkFetchLedger,
  corpusBlockers, FETCHED_DIR,
} from '../run.mjs';
import { fetchLedgerProblems } from '../../evaluation/solo/descriptive.mjs';

const URL_ = 'https://www.sia.govt.nz/sitemap.xml';
const XML = '<?xml version="1.0" encoding="UTF-8"?><sitemapindex><sitemap><loc>https://www.sia.govt.nz/sitemap.xml/sitemap/SiteTree/1</loc></sitemap></sitemapindex>';
const DIGEST = createHash('sha256').update(XML).digest('hex');

const inDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-fetch-'));
  try {
    mkdirSync(join(dir, FETCHED_DIR), { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A log with one retained fetch, one record citing it, and the permit that authorised it. */
const logWith = (over = {}, recordOver = {}) => {
  const log = {
    ...emptyLog(),
    discoveryPermits: [{
      id: 'p-0462', url: URL_, agency: 'Social Investment Agency',
      category: 'account-registration', candidateSetVersion: 1,
      issuedAt: '2026-10-02T22:18:00Z', consumedAt: '2026-10-02T22:18:38Z',
      robotsCheckId: 'r-0083',
    }],
  };
  const entry = recordFetch(log, {
    url: URL_, finalUrl: URL_, fetchedAt: '2026-10-02T22:18:38Z', permitId: 'p-0462',
    httpStatus: 200, contentType: 'application/xml; charset="utf-8"',
    fetchedBytes: Buffer.byteLength(XML), fetchedSha256: DIGEST, fetchFile: 'p-0462-abc.bin',
    rootElement: 'sitemapindex', locCount: 1, ...over,
  });
  log.attempts.push({
    id: 'd-0969', status: 'discovery', recordType: 'observation', discoveryKind: 'sitemap',
    outcome: 'no-candidates', agency: 'Social Investment Agency',
    category: 'account-registration', candidateSetVersion: 1, url: URL_,
    fetchId: entry.id, fetchedSha256: entry.fetchedSha256, fetchedBytes: entry.fetchedBytes,
    contentType: entry.contentType, ...recordOver,
  });
  return log;
};

const onDisk = (dir, content = XML, name = 'p-0462-abc.bin') =>
  writeFileSync(join(dir, FETCHED_DIR, name), content);

/** Both implementations, over one log. The sealer may not import the capture package. */
const verdicts = (log, dir) => {
  const capture = checkFetchLedger(log, join(dir, FETCHED_DIR));
  const sealer = fetchLedgerProblems(log, join(dir, FETCHED_DIR));
  assert.equal(
    capture.length > 0, sealer.length > 0,
    `the two implementations disagree:\n  capture: ${JSON.stringify(capture)}\n  sealer:  ${JSON.stringify(sealer)}`
  );
  return { capture, sealer, clean: capture.length === 0 };
};

describe('a retained reading verifies against its bytes', () => {
  test('a resource on disk with the recorded digest and length passes', () => inDir((dir) => {
    const log = logWith();
    onDisk(dir);
    assert.ok(verdicts(log, dir).clean);
    assert.deepEqual(assertFetchEvidenceUsable(log, { fetchId: 'f-0001', capturesRoot: dir }), []);
  }));

  test('the registry records what a reader needs to check it', () => inDir((dir) => {
    const log = logWith();
    const entry = findFetch(log, 'f-0001');
    // The four things the amendment requires: file, digest, byte length, content type.
    assert.equal(typeof entry.fetchFile, 'string');
    assert.match(entry.fetchedSha256, /^[0-9a-f]{64}$/);
    assert.equal(entry.fetchedBytes, Buffer.byteLength(XML));
    assert.match(entry.contentType, /application\/xml/);
    assert.equal(entry.httpStatus, 200);
  }));
});

describe('a reading that cannot be re-verified is refused', () => {
  test('bytes that are not on disk', () => inDir((dir) => {
    const v = verdicts(logWith(), dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /not on disk/);
  }));

  test('bytes on disk that hash to something else', () => inDir((dir) => {
    // Evidence swapped underneath the record it supports.
    onDisk(dir, XML.replace('sitemapindex', 'urlset'));
    const v = verdicts(logWith(), dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /hash|digest/i);
  }));

  test('a recorded length that does not match the file', () => inDir((dir) => {
    onDisk(dir);
    const v = verdicts(logWith({ fetchedBytes: 1 }), dir);
    assert.equal(v.clean, false);
  }));

  test('a digest that is not a digest', () => inDir((dir) => {
    onDisk(dir);
    assert.equal(verdicts(logWith({ fetchedSha256: 'not-a-digest' }), dir).clean, false);
  }));

  test('a served resource with no content type', () => inDir((dir) => {
    // 200 with no content-type means the reading cannot say what it read.
    onDisk(dir);
    const v = verdicts(logWith({ contentType: undefined }, { contentType: undefined }), dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /contentType/);
  }));

  test('a file name that tries to escape the retained tree', () => inDir((dir) => {
    onDisk(dir);
    const v = verdicts(logWith({ fetchFile: '../capture-log.json' }, { }), dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /plain file name/);
  }));

  test('no httpStatus at all', () => inDir((dir) => {
    onDisk(dir);
    assert.equal(verdicts(logWith({ httpStatus: undefined }), dir).clean, false);
  }));
});

describe('the registry and the records must agree', () => {
  test('a record citing a fetch that is not registered', () => inDir((dir) => {
    onDisk(dir);
    const log = logWith({}, { fetchId: 'f-9999' });
    const v = verdicts(log, dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /not (in the fetch registry|registered)/);
  }));

  test('a record whose digest differs from the registry', () => inDir((dir) => {
    onDisk(dir);
    assert.equal(verdicts(logWith({}, { fetchedSha256: 'f'.repeat(64) }), dir).clean, false);
  }));

  test('a record whose content type differs from the registry', () => inDir((dir) => {
    onDisk(dir);
    assert.equal(verdicts(logWith({}, { contentType: 'text/html' }), dir).clean, false);
  }));

  test('a record of a different URL than the resource read', () => inDir((dir) => {
    onDisk(dir);
    const v = verdicts(logWith({}, { url: 'https://thehub.sia.govt.nz/sitemap.xml' }), dir);
    assert.equal(v.clean, false);
  }));

  test('a registry entry no record cites is evidence from nowhere', () => inDir((dir) => {
    onDisk(dir);
    const log = logWith();
    log.attempts = [];
    const v = verdicts(log, dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /no record citing it/);
  }));

  test('a fetch naming a permit that authorised a different URL', () => inDir((dir) => {
    onDisk(dir);
    const log = logWith();
    log.discoveryPermits[0].url = 'https://www.sia.govt.nz/robots.txt';
    const v = verdicts(log, dir);
    assert.equal(v.capture.some((p) => /authorised/.test(p)), true);
  }));
});

describe('the corpus gate fails closed', () => {
  test('retained evidence with no capture root is a blocker, not a pass', () => inDir((dir) => {
    onDisk(dir);
    const log = logWith();
    // `could not check` must never read as `checked and fine`.
    const blockers = corpusBlockers(log);
    assert.ok(blockers.some((b) => b.kind === 'fetch-evidence'));
  }));

  test('a mismatched reading is a blocker', () => inDir((dir) => {
    onDisk(dir, 'something else entirely');
    const log = logWith();
    const blockers = corpusBlockers(log, { capturesRoot: dir });
    assert.ok(blockers.some((b) => b.kind === 'fetch-evidence'));
  }));

  test('a sound reading raises no fetch blocker', () => inDir((dir) => {
    onDisk(dir);
    const log = logWith();
    const blockers = corpusBlockers(log, { capturesRoot: dir });
    assert.equal(blockers.some((b) => b.kind === 'fetch-evidence'), false);
  }));
});

describe('what the retained document is allowed to establish', () => {
  test('the loc entries are counted, and the children are not fetched', () => inDir((dir) => {
    // The frozen method names the linked sitemap or /sitemap.xml as the inspected resource.
    // References beyond it are outside the bound - so they are recorded and never followed.
    const log = logWith();
    const entry = findFetch(log, 'f-0001');
    assert.equal(entry.rootElement, 'sitemapindex');
    assert.equal(entry.locCount, 1);
    const childRequests = (log.discoveryPermits ?? []).filter((p) => /sitemap\.xml\//.test(p.url));
    assert.deepEqual(childRequests, [], 'no permit may be issued for a child sitemap');
  }));

  test('a served index is read, so its record is a judgement and not attrition', () => inDir((dir) => {
    // The correction this amendment accompanies: an HTTP 200 index WAS successfully read.
    // References beyond the inspected resource are outside the bound, not technical attrition.
    onDisk(dir);
    const log = logWith();
    assert.ok(verdicts(log, dir).clean);
    assert.equal(log.attempts[0].outcome, 'no-candidates');
  }));
});
