/**
 * Amendment 61: the report reaches `capture-log.json`, or it does not exist.
 *
 * Amendment 59 made `renderDiscoveryPage()` RETURN the structural report and both CLI writers that
 * build the registry entry still omitted all five fields. Amendment 59's "render pipeline" test
 * inspected the object the function returned and never reopened the log — so it repeated, one layer
 * up, the exact producer-versus-consumer defect Amendment 59 was written to describe. The decision
 * writers were worse: `exclude` and `not-selected` copied only the digest and byte length, so a
 * post-boundary decision resting on retained evidence carried no report and the gate refused it,
 * leaving the repair with no working command path at all.
 *
 * So every test here runs a COMMAND and then reads `capture-log.json` back off disk. Nothing in this
 * file inspects a return value.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STRUCTURAL_REPORT_VERSION } from '../capture.mjs';
import { structuralReportAudit, offlineStructuralReport, ELIGIBILITY_CRITERIA } from '../run.mjs';

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

let server; let origin;
before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\n'); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(CONTACT);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

/**
 * The CLI as a child process, awaited ASYNCHRONOUSLY.
 *
 * `spawnSync` blocks this process's event loop, so the in-process server could never answer the
 * child's robots request: every preflight timed out after 20 seconds and recorded `disallowed`
 * under RFC 9309's fail-closed rule. The harness was deadlocking itself and the log was right.
 */
const run = (args, dir) => new Promise((resolve) => {
  const child = spawn('node', [cli, ...args, '--out', dir]);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', (status) => resolve({ status, stdout, stderr }));
});
/** The log as it is ON DISK, which is the only thing these tests trust. */
const reopen = (dir) => JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));

const started = (fn) => async () => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-persist-'));
  try {
    assert.equal((await run(['init'], dir)).status, 0);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Everything a round needs before a page may be assessed, done through the CLI. */
const lockedRound = async (dir, url, urls = null) => {
  const AG = 'Test Agency';
  const pre = await run(['preflight-discovery', '--agency', AG, '--website', `${origin}/`, '--url', `${origin}/`,
    '--category', 'enquiry-or-contact', '--set-version', '1', '--method', 'navigation'], dir);
  assert.equal(pre.status, 0, pre.stderr);
  const pm = /permit (p-\d+)/.exec(pre.stdout);
  assert.ok(pm, `preflight issued no permit:\n  stdout: ${pre.stdout}\n  stderr: ${pre.stderr}`);
  const permit = pm[1];
  const rd = await run(['render-discovery', '--agency', AG, '--website', `${origin}/`, '--url', `${origin}/`,
    '--category', 'enquiry-or-contact', '--set-version', '1', '--method', 'navigation',
    '--permit-id', permit], dir);
  assert.equal(rd.status, 0, rd.stderr);
  const match = /observation (g-\d+)/.exec(rd.stdout);
  assert.ok(match, `render-discovery printed no observation:\n  stdout: ${rd.stdout}\n  stderr: ${rd.stderr}`);
  const render = match[1];
  assert.equal((await run(['classify-render', '--render', render, '--category', 'enquiry-or-contact',
    '--outcome', 'candidates-found', '--set-version', '1', '--note', 'a contact form is linked'], dir)).status, 0);
  const add = (urls ?? [url]).join(',');
  assert.equal((await run(['candidates', '--agency', AG, '--category', 'enquiry-or-contact', '--add', add], dir)).status, 0);
  assert.equal((await run(['lock', '--agency', AG, '--category', 'enquiry-or-contact'], dir)).status, 0);
  assert.equal((await run(['approve-set', '--agency', AG, '--category', 'enquiry-or-contact'], dir)).status, 0);
  return { AG, render };
};

const hasReport = (r, where) => {
  assert.equal(r.structuralReportVersion, STRUCTURAL_REPORT_VERSION, `${where}: version`);
  assert.ok(Array.isArray(r.nameFields), `${where}: nameFields`);
  assert.ok(Array.isArray(r.registrationAffordances), `${where}: registrationAffordances`);
  assert.equal(typeof r.collectedNameFields, 'number', `${where}: collectedNameFields`);
  assert.equal(typeof r.searchKeyNameFields, 'number', `${where}: searchKeyNameFields`);
  assert.ok(['live', 'offline-reanalysis'].includes(r.structuralReportSource), `${where}: source`);
};

describe('the RENDER registry entry in the log carries the report', () => {
  test('the headless writer persists it', started(async (dir) => {
    const { render } = await lockedRound(dir, `${origin}/contact-us`);
    // Reopened from disk: this is the check Amendment 59's test omitted.
    const log = reopen(dir);
    const entry = log.renders.find((g) => g.id === render);
    hasReport(entry, 'the render registry entry');
    assert.equal(entry.structuralReportSource, 'live');
    assert.equal(entry.collectedNameFields, 1, JSON.stringify(entry.nameFields));
    assert.deepEqual(structuralReportAudit(log, { capturesRoot: dir }), []);
  }));
});

describe('the CAPTURE record in the log carries the report', () => {
  test('a retrieval persists it, and an exclusion inherits it', started(async (dir) => {
    const { AG } = await lockedRound(dir, `${origin}/contact-us`);
    const cap = await run(['capture', '--retrieve-only', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/contact-us`, '--page-id', 'contact', '--category', 'enquiry-or-contact'], dir);
    assert.equal(cap.status, 0, cap.stderr);
    let log = reopen(dir);
    const retrieval = log.attempts.filter((a) => a.status === 'retrieved').at(-1);
    hasReport(retrieval, 'the retrieval');
    assert.equal(retrieval.collectedNameFields, 1);

    // The decision writer: `exclude` copied only the digest and byte length.
    const ex = await run(['exclude', '--agency', AG, '--website', `${origin}/`, '--url', `${origin}/contact-us`,
      '--category', 'enquiry-or-contact', '--fails', 'asksForTheNameOfANaturalPerson',
      '--evidence-from', retrieval.id, '--reason', 'a trial exclusion resting on the retained evidence'], dir);
    assert.equal(ex.status, 0, ex.stderr);
    log = reopen(dir);
    const exclusion = log.attempts.filter((a) => a.status === 'excluded').at(-1);
    hasReport(exclusion, 'the exclusion');
    assert.deepEqual(exclusion.nameFields, retrieval.nameFields, 'the exclusion inherits the finding verbatim');
    assert.deepEqual(structuralReportAudit(log, { capturesRoot: dir }), []);
  }));

  test('a promotion carries it, and eligible-not-selected inherits it', started(async (dir) => {
    const { AG } = await lockedRound(dir, `${origin}/contact-us`, [`${origin}/contact-us`, `${origin}/zz-other-contact`]);
    assert.equal((await run(['capture', '--retrieve-only', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/contact-us`, '--page-id', 'contact', '--category', 'enquiry-or-contact'], dir)).status, 0);
    // The politeness floor is 5s between top-level navigations, and it is not overridable: the
    // first attempt here was correctly refused and its bytes quarantined.
    await new Promise((r) => setTimeout(r, 5200));
    const second = await run(['capture', '--retrieve-only', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/zz-other-contact`, '--page-id', 'other', '--category', 'enquiry-or-contact'], dir);
    assert.equal(second.status, 0, `the second retrieval must succeed:\n${second.stderr}`);
    let log = reopen(dir);
    const retrieval = log.attempts.filter((a) => a.status === 'retrieved' && a.pageId === 'contact').at(-1);
    const other = log.attempts.filter((a) => a.status === 'retrieved' && a.pageId === 'other').at(-1);

    const pr = await run(['promote', '--id', retrieval.id, '--evidence', 'eligible on all five criteria in this trial'], dir);
    assert.equal(pr.status, 0, pr.stderr);
    log = reopen(dir);
    const captured = log.attempts.filter((a) => a.status === 'captured').at(-1);
    hasReport(captured, 'the promotion');
    assert.deepEqual(captured.nameFields, retrieval.nameFields);

    const ns = await run(['not-selected', '--agency', AG, '--website', `${origin}/`, '--url', `${origin}/zz-other-contact`,
      '--category', 'enquiry-or-contact', '--evidence-from', other.id, '--in-favour-of', captured.id,
      '--reason', 'eligible but not selected in this trial'], dir);
    assert.equal(ns.status, 0, ns.stderr);
    log = reopen(dir);
    const notSelected = log.attempts.filter((a) => a.status === 'eligible-not-selected').at(-1);
    hasReport(notSelected, 'eligible-not-selected');
    assert.deepEqual(notSelected.nameFields, other.nameFields);
    assert.deepEqual(structuralReportAudit(log, { capturesRoot: dir }), []);
  }));
});

describe('the offline reanalysis command', () => {
  /** A pre-boundary retrieval with real bytes and no report, as c-0974 is. */
  const seedHistorical = (dir) => {
    mkdirSync(join(dir, 'captures'), { recursive: true });
    writeFileSync(join(dir, 'captures', 'old.html'), CONTACT);
    const log = reopen(dir);
    log.candidateSets['Old Agency\u0000enquiry-or-contact'] = {
      agency: 'Old Agency', category: 'enquiry-or-contact', version: 1,
      discovered: ['https://old.govt.nz/contact'], locked: ['https://old.govt.nz/contact'],
      lockedAt: '2026-10-04T01:00:00Z', approval: 'approved', approvedAt: '2026-10-04T01:00:00Z',
      discoveryRecordIds: ['d-0001'], candidateDeclaration: null,
    };
    log.attempts.push({
      id: 'c-0001', status: 'retrieved', approval: 'not-applicable',
      agency: 'Old Agency', website: 'https://old.govt.nz/', url: 'https://old.govt.nz/contact',
      category: 'enquiry-or-contact', candidateSetVersion: 1,
      pageId: 'old', file: 'old.html',
      htmlSha256: createHash('sha256').update(CONTACT).digest('hex'),
      htmlBytes: Buffer.byteLength(CONTACT),
      examinedAt: '2026-10-04T01:16:00Z', capturedAt: '2026-10-04T01:16:00Z', refused: false,
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    });
    writeFileSync(join(dir, 'capture-log.json'), `${JSON.stringify(log, null, 2)}\n`);
  };

  test('it records a report derived from the retained bytes', started(async (dir) => {
    seedHistorical(dir);
    const r = await run(['reanalyse-structure', '--id', 'c-0001', '--note', 'offline reanalysis of retained bytes'], dir);
    assert.equal(r.status, 0, r.stderr);
    const log = reopen(dir);
    const record = log.attempts.at(-1);
    hasReport(record, 'the reanalysis');
    assert.equal(record.recordType, 'structural-reanalysis');
    assert.equal(record.structuralReportSource, 'offline-reanalysis');
    assert.equal(record.evidenceFromAttemptId, 'c-0001');
    assert.equal(record.permitId, undefined, 'it makes no request');
    assert.equal(record.navigationPerformed, false);
    // Exactly what the defined derivation produces, and nothing the caller chose.
    const expected = offlineStructuralReport(CONTACT);
    assert.deepEqual(record.nameFields, expected.nameFields);
    assert.equal(record.collectedNameFields, 1);
    // It concludes nothing: a markup derivation cannot establish visibility.
    assert.ok(Object.values(record.eligibility).every((v) => v === null));
    assert.deepEqual(structuralReportAudit(log, { capturesRoot: dir }), []);
  }));

  test('it refuses evidence that already carries a live report', started(async (dir) => {
    const { AG } = await lockedRound(dir, `${origin}/contact-us`);
    assert.equal((await run(['capture', '--retrieve-only', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/contact-us`, '--page-id', 'contact', '--category', 'enquiry-or-contact'], dir)).status, 0);
    const retrieval = reopen(dir).attempts.filter((a) => a.status === 'retrieved').at(-1);
    const r = await run(['reanalyse-structure', '--id', retrieval.id, '--note', 'should be refused'], dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /already carries a complete live report/);
  }));

  test('it refuses when the retained bytes no longer match their digest', started(async (dir) => {
    seedHistorical(dir);
    writeFileSync(join(dir, 'captures', 'old.html'), `${CONTACT}<!-- changed -->`);
    const r = await run(['reanalyse-structure', '--id', 'c-0001', '--note', 'should be refused'], dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /hashes to|changed/);
  }));

  test('a decision may then rest on the reanalysed evidence', started(async (dir) => {
    // The whole point: the c-0976 replacement needs a command path that works.
    seedHistorical(dir);
    assert.equal((await run(['reanalyse-structure', '--id', 'c-0001', '--note', 'offline reanalysis'], dir)).status, 0);
    const reanalysis = reopen(dir).attempts.at(-1);
    const ex = await run(['exclude', '--agency', 'Old Agency', '--website', 'https://old.govt.nz/',
      '--url', 'https://old.govt.nz/contact', '--category', 'enquiry-or-contact',
      '--fails', 'asksForTheNameOfANaturalPerson', '--evidence-from', reanalysis.id,
      '--reason', 'an exclusion resting on the reanalysed evidence'], dir);
    assert.equal(ex.status, 0, ex.stderr);
    const log = reopen(dir);
    const exclusion = log.attempts.filter((a) => a.status === 'excluded').at(-1);
    hasReport(exclusion, 'the exclusion on reanalysed evidence');
    assert.equal(exclusion.structuralReportSource, 'offline-reanalysis');
    assert.deepEqual(structuralReportAudit(log, { capturesRoot: dir }), []);
  }));
});
