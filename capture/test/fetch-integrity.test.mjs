/**
 * Amendment 56: four gaps in Amendment 55's gates, each of which reported clean.
 *
 * Amendment 55 retained the bytes of a plainly-read resource and verified the file, digest and
 * byte length. Four attacks passed both implementations anyway:
 *
 *   1. An extra `fetched/orphan.bin` produced zero problems. Retained bytes nothing accounts for
 *      are either evidence from nowhere or a request nobody recorded, and the rendered tree has
 *      been checked for exactly this since selection-v1.0.26.
 *   2. Changing `rootElement` to `urlset` and `locCount` to `999` produced zero problems. Those
 *      fields were recorded once and never re-derived: a digest proves the bytes are unchanged and
 *      says nothing about whether the log describes them correctly.
 *   3. A served HTTP 200 `text/html` challenge page supported a sitemap `no-candidates` judgement.
 *      The digest matched, the file was present, the permit was accounted for - and the document
 *      never listed anything, so "the sitemap method found nothing" rested on a document that was
 *      not a sitemap.
 *   4. `read-resource` followed redirects automatically, so a redirect target was requested before
 *      anything consulted robots for it.
 *
 * Each is a test here, driven through both implementations and both gates.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  emptyLog, recordFetch, checkFetchLedger, assertFetchEvidenceUsable, corpusBlockers,
  parseRetained, sitemapRepresentationProblems, SITEMAP_ROOT_ELEMENTS, FETCHED_DIR,
} from '../run.mjs';
import {
  fetchLedgerProblems, parseRetainedBytes,
  sitemapRepresentationProblems as sealerRepresentation,
} from '../../evaluation/solo/descriptive.mjs';

const URL_ = 'https://www.sia.govt.nz/sitemap.xml';
const INDEX = '<?xml version="1.0" encoding="UTF-8"?><sitemapindex><sitemap><loc>https://www.sia.govt.nz/sitemap.xml/sitemap/SiteTree/1</loc></sitemap></sitemapindex>';
const CHALLENGE = '<!doctype html><html><head><title>Just a moment...</title></head><body>checking your browser</body></html>';
const digestOf = (t) => createHash('sha256').update(t).digest('hex');

/** The CLI's own source, for the structural guards on the request path. */
const here = dirname(fileURLToPath(import.meta.url));
const cliSource = readFileSync(join(here, '..', 'cli-capture.mjs'), 'utf8');
const readResourceBody = cliSource.slice(
  cliSource.indexOf('async function doReadResource'),
  cliSource.indexOf('function doConcludeInconclusive')
);

const inDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-integ-'));
  try {
    mkdirSync(join(dir, FETCHED_DIR), { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A sound log: one retained sitemap index, one record judging it, the permit that authorised it. */
const soundLog = ({ content = INDEX, entry = {}, record = {} } = {}) => {
  const log = {
    ...emptyLog(),
    discoveryPermits: [{
      id: 'p-0465', url: URL_, agency: 'Social Investment Agency',
      category: 'account-registration', candidateSetVersion: 1,
      issuedAt: '2026-10-03T07:10:00Z', consumedAt: '2026-10-03T07:10:30Z', robotsCheckId: 'r-0083',
    }],
  };
  const parsed = parseRetained(content);
  const f = recordFetch(log, {
    url: URL_, finalUrl: URL_, fetchedAt: '2026-10-03T07:10:30Z', permitId: 'p-0465',
    httpStatus: 200, contentType: 'application/xml; charset="utf-8"',
    fetchedBytes: Buffer.byteLength(content), fetchedSha256: digestOf(content),
    fetchFile: 'p-0465-sound.bin', rootElement: parsed.rootElement, locCount: parsed.locCount,
    ...entry,
  });
  log.attempts.push({
    id: 'd-0972', status: 'discovery', recordType: 'observation', discoveryKind: 'sitemap',
    outcome: 'no-candidates', agency: 'Social Investment Agency',
    category: 'account-registration', candidateSetVersion: 1, url: URL_,
    fetchId: f.id, fetchedSha256: f.fetchedSha256, fetchedBytes: f.fetchedBytes,
    contentType: f.contentType, ...record,
  });
  return log;
};

const write = (dir, content, name = 'p-0465-sound.bin') =>
  writeFileSync(join(dir, FETCHED_DIR, name), content);

/** Both implementations, over one log and one retained tree. */
const verdicts = (log, dir) => {
  const capture = checkFetchLedger(log, join(dir, FETCHED_DIR));
  const sealer = fetchLedgerProblems(log, join(dir, FETCHED_DIR));
  assert.equal(
    capture.length > 0, sealer.length > 0,
    `the two implementations disagree:\n  capture: ${JSON.stringify(capture)}\n  sealer:  ${JSON.stringify(sealer)}`
  );
  return { capture, sealer, clean: capture.length === 0 };
};

describe('a sound retained sitemap still passes', () => {
  test('baseline', () => inDir((dir) => {
    write(dir, INDEX);
    assert.ok(verdicts(soundLog(), dir).clean);
    assert.equal(corpusBlockers(soundLog(), { capturesRoot: dir }).some((b) => b.kind === 'fetch-evidence'), false);
  }));
});

describe('ATTACK 1: retained bytes nothing accounts for', () => {
  test('an unregistered file in the retained tree is caught', () => inDir((dir) => {
    write(dir, INDEX);
    writeFileSync(join(dir, FETCHED_DIR, 'orphan.bin'), 'not registered anywhere');
    const v = verdicts(soundLog(), dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /no retained resource names it/);
    assert.match(v.sealer.join(' '), /no retained resource names it/);
  }));

  test('and it blocks the corpus', () => inDir((dir) => {
    write(dir, INDEX);
    writeFileSync(join(dir, FETCHED_DIR, 'orphan.bin'), 'x');
    assert.ok(corpusBlockers(soundLog(), { capturesRoot: dir }).some((b) => b.kind === 'fetch-evidence'));
  }));

  test('a quarantined file is not in the retained tree, so it raises nothing', () => inDir((dir) => {
    // Bytes from a request that could not be recorded belong in quarantine, not in fetched/.
    write(dir, INDEX);
    mkdirSync(join(dir, 'quarantine'), { recursive: true });
    writeFileSync(join(dir, 'quarantine', 'p-9999-unrecorded.bin'), 'bytes nobody recorded');
    assert.ok(verdicts(soundLog(), dir).clean);
    assert.deepEqual(readdirSync(join(dir, FETCHED_DIR)), ['p-0465-sound.bin']);
  }));
});

describe('ATTACK 2: the description drifting from the bytes', () => {
  test('a rootElement that is not what the document opens with', () => inDir((dir) => {
    write(dir, INDEX);
    const v = verdicts(soundLog({ entry: { rootElement: 'urlset' } }), dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /rootElement/);
  }));

  test('a locCount that is not what the document declares', () => inDir((dir) => {
    write(dir, INDEX);
    const v = verdicts(soundLog({ entry: { locCount: 999 } }), dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /loc entries/);
  }));

  test('both at once, which is the attack as reported', () => inDir((dir) => {
    write(dir, INDEX);
    const v = verdicts(soundLog({ entry: { rootElement: 'urlset', locCount: 999 } }), dir);
    assert.equal(v.clean, false);
    assert.equal(v.capture.length >= 2, true);
  }));

  test('the digest still matching is exactly why re-derivation is needed', () => inDir((dir) => {
    // The bytes are untouched and hash correctly; only the log's description of them is wrong.
    write(dir, INDEX);
    const log = soundLog({ entry: { locCount: 999 } });
    assert.equal(log.fetches[0].fetchedSha256, digestOf(INDEX));
    assert.equal(verdicts(log, dir).clean, false);
  }));

  test('the two implementations derive the same thing', () => {
    for (const doc of [INDEX, CHALLENGE, '<?xml version="1.0"?><!-- c --><urlset><loc>https://a.govt.nz/</loc></urlset>', '']) {
      const a = parseRetained(doc);
      const b = parseRetainedBytes(doc);
      assert.equal(a.rootElement, b.rootElement, JSON.stringify(doc.slice(0, 40)));
      assert.equal(a.locCount, b.locCount);
    }
  });
});

describe('ATTACK 3: a document that is not a sitemap supporting a sitemap judgement', () => {
  test('a served HTML challenge page cannot support no-candidates', () => inDir((dir) => {
    write(dir, CHALLENGE);
    const log = soundLog({
      content: CHALLENGE,
      entry: { contentType: 'text/html; charset=utf-8', fetchedBytes: Buffer.byteLength(CHALLENGE), fetchedSha256: digestOf(CHALLENGE) },
      record: { contentType: 'text/html; charset=utf-8', fetchedBytes: Buffer.byteLength(CHALLENGE), fetchedSha256: digestOf(CHALLENGE) },
    });
    const v = verdicts(log, dir);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /is not a sitemap/);
    assert.match(v.sealer.join(' '), /is not a sitemap/);
  }));

  test('nor candidates-found', () => inDir((dir) => {
    write(dir, CHALLENGE);
    const log = soundLog({
      content: CHALLENGE,
      entry: { contentType: 'text/html', fetchedBytes: Buffer.byteLength(CHALLENGE), fetchedSha256: digestOf(CHALLENGE) },
      record: { outcome: 'candidates-found', contentType: 'text/html', fetchedBytes: Buffer.byteLength(CHALLENGE), fetchedSha256: digestOf(CHALLENGE) },
    });
    assert.equal(verdicts(log, dir).clean, false);
  }));

  test('XML content type alone is not enough: the root element must be a sitemap root', () => {
    // A well-formed XML document of something else entirely.
    const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
    const entry = { httpStatus: 200, contentType: 'application/xml' };
    assert.ok(sitemapRepresentationProblems(entry, rss).length > 0);
    assert.ok(sealerRepresentation(entry, rss).length > 0);
  });

  test('a sitemap root alone is not enough: the content type must be XML', () => {
    const entry = { httpStatus: 200, contentType: 'text/html' };
    assert.ok(sitemapRepresentationProblems(entry, INDEX).length > 0);
    assert.ok(sealerRepresentation(entry, INDEX).length > 0);
  });

  test('a non-2xx status is not a representation at all', () => {
    for (const httpStatus of [301, 403, 404, 500]) {
      const entry = { httpStatus, contentType: 'application/xml' };
      assert.ok(sitemapRepresentationProblems(entry, INDEX).length > 0, `HTTP ${httpStatus}`);
      assert.ok(sealerRepresentation(entry, INDEX).length > 0, `HTTP ${httpStatus}`);
    }
  });

  test('a loc entry that is not an absolute http(s) URL is refused', () => {
    const bad = '<?xml version="1.0"?><urlset><url><loc>javascript:alert(1)</loc></url></urlset>';
    const entry = { httpStatus: 200, contentType: 'application/xml' };
    assert.ok(sitemapRepresentationProblems(entry, bad).some((p) => /absolute http/.test(p)));
    assert.ok(sealerRepresentation(entry, bad).some((p) => /absolute http/.test(p)));
  });

  test('both sitemap roots are accepted', () => {
    assert.deepEqual([...SITEMAP_ROOT_ELEMENTS].sort(), ['sitemapindex', 'urlset']);
    const entry = { httpStatus: 200, contentType: 'application/xml' };
    for (const root of SITEMAP_ROOT_ELEMENTS) {
      const doc = `<?xml version="1.0"?><${root}><loc>https://a.govt.nz/</loc></${root}>`;
      assert.deepEqual(sitemapRepresentationProblems(entry, doc), [], root);
      assert.deepEqual(sealerRepresentation(entry, doc), [], root);
    }
  });

  test('a non-sitemap document is fine for a record that judges nothing', () => inDir((dir) => {
    // The rule binds a sitemap CONTENT judgement. A record that concludes nothing about content
    // may rest on whatever was served - that is what the HTTP 500 search renders do.
    write(dir, CHALLENGE);
    const log = soundLog({
      content: CHALLENGE,
      entry: { contentType: 'text/html', fetchedBytes: Buffer.byteLength(CHALLENGE), fetchedSha256: digestOf(CHALLENGE) },
      record: { outcome: 'retrieval-inconclusive', contentType: 'text/html', fetchedBytes: Buffer.byteLength(CHALLENGE), fetchedSha256: digestOf(CHALLENGE) },
    });
    assert.ok(verdicts(log, dir).clean);
  }));
});

describe('ATTACK 4: a redirect requested before its policy was checked', () => {
  test('read-resource uses manual redirects', () => {
    // The guard is structural: automatic following means the destination is fetched before
    // anything can decide whether it may be.
    const fn = readResourceBody;
    assert.match(fn, /redirect:\s*'manual'/);
    assert.doesNotMatch(fn, /redirect:\s*'follow'/);
  });

  test('it decides every destination against the recorded policy before requesting it', () => {
    const fn = readResourceBody;
    // The same recorded-policy decision the capture path has used since selection-v1.0.28:
    // never a fresh lookup mid-request, and a refusal stops the chain before the next fetch.
    assert.match(fn, /recordedPolicyFor\(log\)/);
    assert.match(fn, /allowed !== true/);
    assert.match(fn, /refusedAt/);
    // The refusal must come before the body of the destination is read.
    assert.ok(fn.indexOf('refusedAt = next') < fn.indexOf('await res.arrayBuffer()'));
  });

  test('it bounds the chain rather than following it indefinitely', () => {
    const fn = readResourceBody;
    assert.match(fn, /hop <= 5/);
    assert.match(fn, /redirected more than 5 times/);
  });

  test('it quarantines bytes when recording fails after the request', () => {
    const fn = readResourceBody;
    assert.match(fn, /quarantineArtefact\(fetchedDir/);
    assert.match(fn, /could not be recorded/);
  });
});


