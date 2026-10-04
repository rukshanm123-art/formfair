/**
 * Amendment 62: a refusal must not cost a request.
 *
 * The researcher authorised exactly ONE fresh retrieval of `www.sia.govt.nz/about/contact-us`, to
 * obtain the live structural report `c-1017` lacks and criterion four needs. The request was made,
 * the page was fetched, the live report was computed - and then `appendAttempt` refused the write,
 * because the duplicate-URL rule had no way to express an authorised re-retrieval. The bytes were
 * quarantined and the computed record was dropped on the floor. The one request was spent on a
 * write that could never have succeeded, and the only thing an offline replay cannot reproduce was
 * the thing discarded.
 *
 * The duplicate-URL and identity rules are pure functions of the log and the arguments: nothing a
 * response can change. `render-discovery` already had this lesson recorded against permits - "a
 * permit is meant to be a precondition of traffic, not a comment on it" - and the identity checks
 * had never been given it.
 *
 * So the test that matters here counts the requests the server actually received. Asserting that a
 * command exited non-zero proves nothing: the refusal that cost a request exited non-zero too.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRUCTURAL_REPORT_VERSION } from '../capture.mjs';
import {
  preRequestProblems, duplicateUrlProblem, extendsTargetProblem, supersedesTargetProblem,
  structuralReportAudit,
} from '../run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'cli-capture.mjs');

const CONTACT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body>
  <form action="/search" method="get"><input type="search" name="q"><input type="submit" value="Search"></form>
  <form action="/contact-us/Form" method="post" id="UserForm">
    <label for="n">Your name*</label><input type="text" name="EditableTextField_dd027" id="n" required>
    <label for="m">Your message*</label><textarea name="EditableTextField_13052" id="m" required></textarea>
    <input type="submit" name="action_process" value="Submit">
  </form>
</body></html>`;

/** Every request the site receives, so "nothing was requested" can be asserted and not assumed. */
let server; let origin; let requests = [];
before(async () => {
  server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\n'); return; }
    // An alias of the contact page, so a duplicate can be discovered from the FINAL url only.
    if (req.url === '/contact-alias') { res.writeHead(302, { location: '/contact-us' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(CONTACT);
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
  const dir = mkdtempSync(join(tmpdir(), 'formfair-prerequest-'));
  try {
    assert.equal((await run(['init'], dir)).status, 0);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const AG = 'Test Agency';
const lockedRound = async (dir, urls = null) => {
  const pre = await run(['preflight-discovery', '--agency', AG, '--website', `${origin}/`, '--url', `${origin}/`,
    '--category', 'enquiry-or-contact', '--set-version', '1', '--method', 'navigation'], dir);
  assert.equal(pre.status, 0, pre.stderr);
  const permit = /permit (p-\d+)/.exec(pre.stdout)[1];
  const rd = await run(['render-discovery', '--agency', AG, '--website', `${origin}/`, '--url', `${origin}/`,
    '--category', 'enquiry-or-contact', '--set-version', '1', '--method', 'navigation',
    '--permit-id', permit], dir);
  assert.equal(rd.status, 0, rd.stderr);
  const render = /observation (g-\d+)/.exec(rd.stdout)[1];
  assert.equal((await run(['classify-render', '--render', render, '--category', 'enquiry-or-contact',
    '--outcome', 'candidates-found', '--set-version', '1', '--note', 'a contact form is linked'], dir)).status, 0);
  assert.equal((await run(['candidates', '--agency', AG, '--category', 'enquiry-or-contact',
    '--add', (urls ?? [`${origin}/contact-us`]).join(',')], dir)).status, 0);
  assert.equal((await run(['lock', '--agency', AG, '--category', 'enquiry-or-contact'], dir)).status, 0);
  assert.equal((await run(['approve-set', '--agency', AG, '--category', 'enquiry-or-contact'], dir)).status, 0);
};

/** The first retrieval of the page: truthful, and in the live log's case report-less. */
const retrieve = (dir, pageId, extra = []) => run([
  'capture', '--retrieve-only', '--agency', AG, '--website', `${origin}/`,
  '--url', `${origin}/contact-us`, '--page-id', pageId, '--category', 'enquiry-or-contact', ...extra,
], dir);

describe('a refused command makes no request', () => {
  test('a second retrieval of the same URL is refused before anything is fetched', started(async (dir) => {
    await lockedRound(dir);
    assert.equal((await retrieve(dir, 'contact')).status, 0);

    // From here on, every request the site receives is one this refusal cost.
    const before = requests.length;
    const again = await retrieve(dir, 'contact-live');
    assert.equal(again.status, 1);
    assert.equal(requests.length, before, `the refusal fetched ${requests.slice(before).join(', ')}`);
    assert.match(again.stderr, /Nothing was requested, fetched or written/);
    // And it says how an authorised re-retrieval is recorded, rather than leaving it to be guessed.
    assert.match(again.stderr, /extendsAttemptId set to c-\d+/);
    // Not even robots: a refusal decidable from the log must not touch the site at all.
    assert.ok(!requests.slice(before).includes('/robots.txt'));
  }));

  test('a colliding pageId is refused before anything is fetched', started(async (dir) => {
    await lockedRound(dir);
    assert.equal((await retrieve(dir, 'contact')).status, 0);
    const before = requests.length;
    // Same pageId, different URL: the collision is knowable without asking the site anything.
    const clash = await run(['capture', '--retrieve-only', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/other`, '--page-id', 'contact', '--category', 'enquiry-or-contact'], dir);
    assert.equal(clash.status, 1);
    assert.match(clash.stderr, /pageId contact is already recorded/);
    assert.equal(requests.length, before, 'a pageId collision must not cost a request');
  }));

  test('extending a retrieval that already carries a live report is refused before fetching', started(async (dir) => {
    await lockedRound(dir);
    assert.equal((await retrieve(dir, 'contact')).status, 0);
    const first = reopen(dir).attempts.filter((a) => a.status === 'retrieved').at(-1);
    // The first retrieval here is post-boundary, so it DOES carry a live report - the SIA case is
    // the opposite, and that is the whole reason a re-retrieval was needed there.
    assert.equal(first.structuralReportSource, 'live');

    const before = requests.length;
    const pointless = await retrieve(dir, 'contact-live', ['--extends', first.id]);
    assert.equal(pointless.status, 1);
    assert.match(pointless.stderr, /already carries a complete live structural report/);
    assert.equal(requests.length, before, 'a request that would establish nothing must not be made');
  }));

  test('--extends on a decision is refused, and makes no request', started(async (dir) => {
    await lockedRound(dir);
    assert.equal((await retrieve(dir, 'contact')).status, 0);
    const first = reopen(dir).attempts.filter((a) => a.status === 'retrieved').at(-1);
    const before = requests.length;
    const bad = await run(['capture', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/contact-us`, '--page-id', 'contact-live', '--category', 'enquiry-or-contact',
      '--extends', first.id, '--evidence', 'a visible name field'], dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--extends requires --retrieve-only/);
    assert.equal(requests.length, before);
  }));
});

describe('an authorised re-retrieval is expressible', () => {
  test('it is permitted, carries a live report, and leaves the first retrieval standing', started(async (dir) => {
    await lockedRound(dir);
    assert.equal((await retrieve(dir, 'contact')).status, 0);
    const log0 = reopen(dir);
    const first = log0.attempts.filter((a) => a.status === 'retrieved').at(-1);

    // Strip the report from the first retrieval, so it stands in for `c-1017`: a truthful
    // retrieval taken before the boundary that carries no structural report.
    const path = join(dir, 'capture-log.json');
    const edited = JSON.parse(readFileSync(path, 'utf8'));
    const target = edited.attempts.find((a) => a.id === first.id);
    for (const f of ['structuralReportVersion', 'structuralReportSource', 'registrationAffordances',
      'nameFields', 'collectedNameFields', 'searchKeyNameFields']) delete target[f];
    // Amendment 61 reads `examinedAt` first, and the CLI stamps it at write time, so setting only
    // `capturedAt` leaves the record post-boundary and the audit rightly demands a report.
    target.capturedAt = '2026-10-04T01:16:04Z';
    target.examinedAt = '2026-10-04T01:16:04Z';
    writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);

    const before = requests.length;
    const again = await retrieve(dir, 'contact-live', ['--extends', first.id]);
    assert.equal(again.status, 0, again.stderr);
    assert.ok(requests.length > before, 'an authorised re-retrieval does make its request');

    const log = reopen(dir);
    const second = log.attempts.filter((a) => a.status === 'retrieved').at(-1);
    assert.notEqual(second.id, first.id);
    assert.equal(second.extendsAttemptId, first.id);
    assert.equal(second.structuralReportVersion, STRUCTURAL_REPORT_VERSION);
    assert.equal(second.structuralReportSource, 'live', 'the point of the request');
    assert.equal(second.collectedNameFields, 1, JSON.stringify(second.nameFields));

    // The first record is incomplete, not false: it stays active and is not superseded.
    assert.equal(second.supersedesAttemptId, undefined);
    assert.ok(!log.attempts.some((a) => a.supersedesAttemptId === first.id));
    const kept = log.attempts.find((a) => a.id === first.id);
    assert.equal(kept.status, 'retrieved');
    // Its own bytes are untouched: a new pageId means a new file.
    assert.notEqual(second.pageId, kept.pageId);
    assert.notEqual(second.file, kept.file);
    assert.ok(existsSync(join(dir, 'captures', kept.file)));
    assert.ok(existsSync(join(dir, 'captures', second.file)));

    assert.deepEqual(structuralReportAudit(log, { capturesRoot: dir }), []);
  }));
});

describe('a write refused AFTER the request keeps what the request obtained', () => {
  test('the computed record is quarantined beside the bytes', started(async (dir) => {
    await lockedRound(dir, [`${origin}/contact-us`, `${origin}/contact-alias`]);

    // A failure only the RESPONSE can reveal, which is the kind the pre-request gate cannot
    // pre-empt by construction: the alias redirects onto a page already captured, and the
    // duplicate is visible only once the final URL is known. The sidecar is the backstop - a live
    // structural report cannot be re-derived from retained markup, and the request cannot be
    // repeated for free.
    assert.equal((await run(['capture', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/contact-us`, '--page-id', 'contact-captured',
      '--category', 'enquiry-or-contact', '--evidence', 'a visible name field'], dir)).status, 0);

    const doomed = await run(['capture', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/contact-alias`, '--page-id', 'contact-doomed',
      '--category', 'enquiry-or-contact', '--evidence', 'a visible name field'], dir);
    assert.equal(doomed.status, 1, `expected the final-URL duplicate to refuse:\n${doomed.stdout}`);
    assert.match(doomed.stderr + doomed.stdout, /already captured|duplicate/i);

    const quarantined = readdirSync(join(dir, 'quarantine'));
    const sidecar = quarantined.find((f) => f.endsWith('.record.json'));
    assert.ok(sidecar, `no record kept; quarantine holds ${quarantined.join(', ')}`);
    const kept = JSON.parse(readFileSync(join(dir, 'quarantine', sidecar), 'utf8'));
    assert.equal(kept.record.structuralReportSource, 'live');
    assert.equal(kept.record.collectedNameFields, 1, 'the live report the request obtained');
    assert.match(kept.note, /NOT a log record/);
    // And it is not mistaken for one.
    assert.ok(!reopen(dir).attempts.some((a) => a.pageId === 'contact-doomed'));
  }));
});

describe('the rules are one implementation, called from both places', () => {
  test('the pre-request gate and the write-time check agree on a duplicate URL', () => {
    const log = { attempts: [{ id: 'c-1', status: 'retrieved', agency: 'A', url: 'https://a.govt.nz/c', approval: 'not-applicable' }] };
    const attempt = { agency: 'A', url: 'https://a.govt.nz/c', status: 'retrieved', pageId: 'new' };
    assert.ok(duplicateUrlProblem(log, attempt));
    assert.deepEqual(preRequestProblems(log, attempt), [duplicateUrlProblem(log, attempt)]);
    // Naming the retrieval it extends clears it in both.
    const extending = { ...attempt, extendsAttemptId: 'c-1' };
    assert.equal(duplicateUrlProblem(log, extending), null);
    assert.equal(extendsTargetProblem(log, extending), null);
    assert.deepEqual(preRequestProblems(log, extending), []);
  });

  test('a supersession naming another page is refused by the gate as well', () => {
    const log = { attempts: [{ id: 'c-1', status: 'excluded', agency: 'A', url: 'https://a.govt.nz/other', approval: 'rejected' }] };
    const attempt = { agency: 'A', url: 'https://a.govt.nz/c', status: 'retrieved', supersedesAttemptId: 'c-1' };
    assert.match(supersedesTargetProblem(log, attempt), /which is not what this attempt supersedes/);
    assert.equal(preRequestProblems(log, attempt).length, 1);
  });
});

describe('Amendment 63: a promotion inherits the bytes, not the re-retrieval marker', () => {
  // Amendment 62 refuses a decision that extends, because a decision makes no request. A
  // promotion carries the retrieval's fields forward, so it inherited `extendsAttemptId` and
  // Amendment 62's own rule refused it: "a captured record may not extend c-1017". That is the
  // performing-versus-inheriting confusion Amendment 61 resolved for the structural report,
  // reappearing one field along. Reproduced against the live log before this fix.
  test('the promotion is permitted, and the chain to the earlier retrieval stays readable', started(async (dir) => {
    await lockedRound(dir);
    assert.equal((await retrieve(dir, 'contact')).status, 0);
    const path = join(dir, 'capture-log.json');
    const edited = JSON.parse(readFileSync(path, 'utf8'));
    const first = edited.attempts.filter((a) => a.status === 'retrieved').at(-1);
    const target = edited.attempts.find((a) => a.id === first.id);
    for (const f of ['structuralReportVersion', 'structuralReportSource', 'registrationAffordances',
      'nameFields', 'collectedNameFields', 'searchKeyNameFields']) delete target[f];
    target.capturedAt = '2026-10-04T01:16:04Z';
    target.examinedAt = '2026-10-04T01:16:04Z';
    writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);

    assert.equal((await retrieve(dir, 'contact-live', ['--extends', first.id])).status, 0);
    const reRetrieval = reopen(dir).attempts.filter((a) => a.status === 'retrieved').at(-1);
    assert.equal(reRetrieval.extendsAttemptId, first.id);

    const promoted = await run(['promote', '--id', reRetrieval.id, '--evidence', 'a visible name field'], dir);
    assert.equal(promoted.status, 0, promoted.stderr);

    const log = reopen(dir);
    const capture = log.attempts.find((a) => a.status === 'captured');
    // The decision does not claim to have made the request.
    assert.equal(capture.extendsAttemptId, undefined);
    // And nothing is lost: decision -> re-retrieval -> the retrieval it extended.
    assert.equal(capture.promotedFrom, reRetrieval.id);
    assert.equal(log.attempts.find((a) => a.id === capture.promotedFrom).extendsAttemptId, first.id);
    // The live report still rides along, because those are the bytes it rests on.
    assert.equal(capture.structuralReportSource, 'live');
    assert.equal(capture.collectedNameFields, 1);
    assert.deepEqual(structuralReportAudit(log, { capturesRoot: dir }), []);
  }));

  test('a decision that asserts the marker itself is still refused', () => {
    // Dropping it on promotion must not weaken the rule for a record that claims it outright.
    const prior = { id: 'c-1', status: 'retrieved', agency: 'A', url: 'https://a.govt.nz/c', pageId: 'p1' };
    const decision = {
      id: 'c-2', status: 'captured', agency: 'A', url: 'https://a.govt.nz/c', pageId: 'p2',
      extendsAttemptId: 'c-1',
    };
    assert.match(extendsTargetProblem({ attempts: [prior, decision] }, decision), /may not extend/);
  });
});
