/**
 * Amendment 66: one pre-request pacing function, and an audit that measures every request.
 *
 * Amendment 65 paced `read-resource` and `recheck-robots` and left the rest. Five paths still had
 * incomplete coverage, and two attacks still passed both trust-time implementations with zero
 * problems:
 *
 *   - A robots fetch at T and a page navigation at T+1s. Navigation entries carried no `url`, and
 *     the audit skipped any entry without one, so a navigation was only ever a PREDECESSOR and
 *     never a SUBJECT.
 *   - A ten-second crawl-delay, a robots refresh six seconds in, and a refreshed file that drops
 *     the delay. The refresh was audited against the policy it had just brought back, so the file
 *     excused the request that fetched it.
 *
 * At runtime, capture and render seeded from `lastNavigation`, which excludes robots traffic; the
 * robots fetches inside `capture` and `preflight-discovery` were not paced at all; and
 * `continue-headed` starts a fresh process, so the headed fallback's pacer began at zero.
 *
 * The timing tests here read the timestamps the SERVER recorded. A test that asserts the harness
 * called a pacing function proves the call, not the wait.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pacingProblems as capturePacing, FETCH_PACING_REQUIRED_FROM } from '../run.mjs';
import { pacingProblems as sealerPacing } from '../../evaluation/solo/descriptive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'cli-capture.mjs');
const source = readFileSync(join(here, '..', 'cli-capture.mjs'), 'utf8');

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body><form action="/contact-us/Form" method="post" id="UserForm">
  <label for="n">Your name*</label><input type="text" name="EditableTextField_dd027" id="n" required>
  <input type="submit" name="action_process" value="Submit">
</form></body></html>`;

/** Every request with the millisecond the server saw it. The wait is what is under test. */
let server; let origin; let hits = [];
before(async () => {
  server = createServer((req, res) => {
    hits.push({ url: req.url, at: Date.now() });
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\n'); return; }
    if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE);
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

const started = (fn) => async () => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-pacing-'));
  hits = [];
  try {
    assert.equal((await run(['init'], dir)).status, 0);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const AG = 'Test Agency';
/** The smallest interval the server actually observed between consecutive requests. */
const tightestGap = () => {
  const times = hits.map((h) => h.at).sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < times.length; i += 1) min = Math.min(min, times[i] - times[i - 1]);
  return min;
};

describe('every traffic path waits, across separate processes', () => {
  test('a robots fetch and the navigation that follows it are spaced', started(async (dir) => {
    // The attack, at runtime: preflight fetches robots, then render-discovery navigates. Two
    // processes, and before this amendment neither seeded from the other's robots request.
    const pre = await run(['preflight-discovery', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/`, '--category', 'enquiry-or-contact', '--set-version', '1',
      '--method', 'navigation'], dir);
    assert.equal(pre.status, 0, pre.stderr);
    const permit = /permit (p-\d+)/.exec(pre.stdout)[1];
    const rd = await run(['render-discovery', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/`, '--category', 'enquiry-or-contact', '--set-version', '1',
      '--method', 'navigation', '--permit-id', permit], dir);
    assert.equal(rd.status, 0, rd.stderr);

    assert.ok(hits.some((h) => h.url === '/robots.txt'), 'robots was fetched');
    assert.ok(hits.some((h) => h.url === '/'), 'the page was requested');
    assert.ok(tightestGap() >= 5000, `the server saw requests ${tightestGap()} ms apart`);
  }));

  test('recheck-robots and a later retrieval are spaced', started(async (dir) => {
    const rc = await run(['recheck-robots', '--origin', origin], dir);
    assert.equal(rc.status, 0, rc.stderr);
    const pre = await run(['preflight-discovery', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/`, '--category', 'enquiry-or-contact', '--set-version', '1',
      '--method', 'navigation'], dir);
    assert.equal(pre.status, 0, pre.stderr);
    const permit = /permit (p-\d+)/.exec(pre.stdout)[1];
    assert.equal((await run(['render-discovery', '--agency', AG, '--website', `${origin}/`,
      '--url', `${origin}/`, '--category', 'enquiry-or-contact', '--set-version', '1',
      '--method', 'navigation', '--permit-id', permit], dir)).status, 0);
    assert.ok(tightestGap() >= 5000, `the server saw requests ${tightestGap()} ms apart`);
  }));

  test('two read-resource invocations are spaced', started(async (dir) => {
    // The pair that breached: f-0009 and f-0010, one second apart in two processes.
    for (const n of [1, 2]) {
      const pre = await run(['preflight-discovery', '--agency', AG, '--website', `${origin}/`,
        '--url', `${origin}/sitemap.xml`, '--category', 'enquiry-or-contact', '--set-version', '1',
        '--method', 'sitemap'], dir);
      assert.equal(pre.status, 0, `${n}: ${pre.stderr}`);
      const permit = /permit (p-\d+)/.exec(pre.stdout)[1];
      const rr = await run(['read-resource', '--agency', AG, '--url', `${origin}/sitemap.xml`,
        '--category', 'enquiry-or-contact', '--set-version', '1', '--permit-id', permit], dir);
      assert.equal(rr.status, 0, `${n}: ${rr.stderr}`);
    }
    assert.equal(hits.filter((h) => h.url === '/sitemap.xml').length, 2);
    assert.ok(tightestGap() >= 5000, `the server saw requests ${tightestGap()} ms apart`);
  }));
});

describe('one pacing function owns the obligation', () => {
  // The defect was five paths each deciding for itself, and three of them deciding wrongly. A
  // structural check is the only kind that keeps a sixth path from being added the same way.
  test('nothing but beforeRequest touches the pacer', () => {
    const calls = [...source.matchAll(/pacer\.(seen|beforeNavigation)\(/g)];
    assert.equal(calls.length, 2, `expected both pacer calls inside beforeRequest, found ${calls.length}`);
    const fn = /async function beforeRequest\(log, url\) \{([\s\S]*?)\n\}/.exec(source);
    assert.ok(fn, 'beforeRequest must exist');
    assert.match(fn[1], /pacer\.seen\(lastRequest\(log\)\)/, 'it seeds from every request type');
    assert.match(fn[1], /pacer\.beforeNavigation\(crawlDelayFor\(log, url\)\)/, 'and honours crawl-delay');
  });

  test('no traffic path seeds from lastNavigation, which excludes robots', () => {
    assert.equal(/pacer\.seen\(lastNavigation\(/.test(source), false);
  });

  test('every robots fetch in the CLI is preceded by a pacing call', () => {
    for (const m of source.matchAll(/fetchRobotsPolicy\(/g)) {
      const before = source.slice(Math.max(0, m.index - 400), m.index);
      assert.match(before, /await beforeRequest\(/,
        `a fetchRobotsPolicy call at offset ${m.index} is not preceded by beforeRequest`);
    }
  });
});

describe('the audit measures every request type as subject and predecessor', () => {
  const at = (ms) => new Date(FETCH_PACING_REQUIRED_FROM + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const check = (id, when, crawlDelay, o = 'https://a.govt.nz') => ({
    id, origin: o, url: `${o}/robots.txt`, fetchedAt: when, httpStatus: 200, disposition: 'rules',
    policy: { groups: crawlDelay ? [{ crawlDelay }] : [] },
  });
  const both = (log) => {
    const c = capturePacing(log); const s = sealerPacing(log);
    assert.equal(c.length > 0, s.length > 0,
      `disagreement:\n  capture: ${JSON.stringify(c)}\n  sealer: ${JSON.stringify(s)}`);
    return c;
  };

  test('a navigation one second after a robots fetch is refused', () => {
    const log = {
      attempts: [{ id: 'd-1', url: 'https://a.govt.nz/page', navigatedAt: at(1000), status: 'discovery' }],
      fetches: [], robotsChecks: [check('r-1', at(0))],
    };
    const problems = both(log);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /d-1 .*1000 ms after the previous request/);
  });

  test('a navigation audited as subject is still spaced correctly when it is', () => {
    const log = {
      attempts: [{ id: 'd-1', url: 'https://a.govt.nz/page', navigatedAt: at(5000), status: 'discovery' }],
      fetches: [], robotsChecks: [check('r-1', at(0))],
    };
    assert.deepEqual(both(log), []);
  });

  test('a record with no usable URL is reported rather than skipped', () => {
    // Skipping it is what hid every navigation; silence is not a pass.
    const log = {
      attempts: [{ id: 'd-1', navigatedAt: at(10_000), status: 'discovery' }],
      fetches: [], robotsChecks: [],
    };
    assert.match(both(log).join(' '), /no usable URL/);
  });

  test('a robots refresh does not govern itself', () => {
    // Six seconds into a ten-second delay, and the refreshed file drops the delay: the request
    // was audited against the policy it had just brought back.
    const log = {
      attempts: [], fetches: [],
      robotsChecks: [check('r-1', at(0), 10), check('r-2', at(6000), null)],
    };
    const problems = both(log);
    assert.ok(problems.some((p) => /r-2/.test(p)), JSON.stringify(problems));
    assert.match(problems.find((p) => /r-2/.test(p)), /10000 ms/);
  });

  test('a refresh that waits out the old delay is permitted', () => {
    const log = {
      attempts: [], fetches: [],
      robotsChecks: [check('r-1', at(0), 10), check('r-2', at(10_000), null)],
    };
    assert.deepEqual(both(log).filter((p) => /r-2/.test(p)), []);
  });

  test('the delay a later request honours is the refreshed one', () => {
    // Forward, the new policy governs: it was known before that request was made.
    const log = {
      attempts: [], fetches: [{
        id: 'f-1', url: 'https://a.govt.nz/s.xml', fetchedAt: at(16_000),
        fetchFile: 'f-1.bin', fetchedSha256: 'a'.repeat(64), fetchedBytes: 10, httpStatus: 200,
      }],
      robotsChecks: [check('r-1', at(0), 10), check('r-2', at(10_000), null)],
    };
    assert.deepEqual(both(log).filter((p) => /f-1/.test(p)), []);
  });
});
