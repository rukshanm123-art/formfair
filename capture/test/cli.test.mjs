/**
 * The capture command, end to end, against a local synthetic server.
 *
 * Protocol section 4 again: the harness is exercised on synthetic pages before any real
 * page is opened. Nothing here leaves the machine.
 *
 * The end-to-end test is the one that matters, because the defect it guards is not in any
 * single function. Capture, ledger and draft used to be three separate calls with nothing
 * keeping them in step. This drives the real CLI and then hands the result to the FROZEN
 * corpus seal, so the chain is checked at the point it is actually used.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'cli-capture.mjs');
const repo = join(here, '..', '..');

// The frozen frame digests the seal verifies against.
const FRAME = '11a0bcd30489648050dc287775d88cc4d99c54e2c9022b7226f157796df8c3ce';
const DRAW = '30dc8c27bbf601ce43da2d781c4bdff43db5dd074704268bb2532a21ce0fabf1';

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body><h1>Contact us</h1>
<form action="/submitted" method="post">
  <label for="fn">First name</label>
  <input id="fn" name="firstName" autocomplete="given-name" pattern="[A-Za-z]+">
  <button type="submit">Send</button>
</form>
<script>
  window.__events = [];
  document.addEventListener('submit', (e) => { window.__events.push('submit'); e.preventDefault(); }, true);
  for (const i of document.querySelectorAll('input')) {
    i.addEventListener('input', () => window.__events.push('input'));
    i.addEventListener('keydown', () => window.__events.push('keydown'));
  }
  document.documentElement.setAttribute('data-events', '');
  const sync = () => document.documentElement.setAttribute('data-events', window.__events.join(','));
  new MutationObserver(sync).observe(document.body, {subtree:true, childList:true});
  setInterval(sync, 100);
</script>
</body></html>`;

let server;
let origin;
let robots = 'User-agent: *\nDisallow: /private\n';

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robots);
    }
    if (req.url.startsWith('/private')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(FORM);
    }
    if (req.url === '/locked') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><html><body><form><input type="password" name="p"><p>Please sign in</p></form></body></html>');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(FORM);
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

/**
 * Runs the CLI asynchronously.
 *
 * NOT spawnSync. The synthetic server lives in this process, and spawnSync blocks the
 * event loop, so the server could never answer the request the CLI was waiting on - the
 * two deadlocked with no output at all. Every test that drives the CLI is therefore async.
 */
const run = (args, cwd) =>
  new Promise((resolve) => {
    const child = spawn('node', [cli, ...args], { cwd: cwd ?? repo, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });

/** The corpus seal, likewise async for the same reason. */
const seal = (args) =>
  new Promise((resolve) => {
    const child = spawn('node', [join(repo, 'evaluation', 'solo', 'cli-seal-corpus.mjs'), ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });

/**
 * Records and locks a candidate set, which assessment now requires.
 *
 * The locked-set step is what makes canonicalisation and ordering binding rather than
 * merely available, so every capture in these tests goes through it, exactly as a real run
 * would.
 */
let discoveryTick = 0;
const lockSet = async (dir, agency, category, urls) => {
  // A set must be supported by the discovery round that produced it.
  // selection-v1.0.12: a permit authorises a FUTURE request, so the navigation must fall after
  // the permit is issued. A fixed past timestamp now correctly fails that check.
  //
  // Which leaves the five-second pacing minimum to satisfy honestly: the time really has to
  // pass, because a synthetic future timestamp would then precede the next real capture and
  // break pacing in the other direction. The capture path already sleeps for the pacer, so this
  // waits only where a discovery record is the thing being spaced.
  discoveryTick++;
  await new Promise((r) => setTimeout(r, 6500));
  const discoveryUrl = `${origin}/discovery/${category}/${discoveryTick}`;
  // selection-v1.0.11: the robots check happens BEFORE the navigation, so a discovery record
  // needs a permit issued by preflight. The synthetic server serves no robots.txt, which is a
  // 404 - unavailable, therefore permitted - so a permit is issued.
  const permit = await run(['preflight-discovery', '--out', dir, '--agency', agency,
    '--website', origin, '--url', discoveryUrl, '--category', category,
    '--set-version', '1', '--method', 'navigation']);
  assert.equal(permit.status, 0, permit.stderr);
  // selection-v1.0.14: the record names the permit that authorised it.
  const permitId = permit.stdout.match(/permit (p-\d+):/)?.[1];
  assert.ok(permitId, `no permit id in: ${permit.stdout}`);
  // Taken AFTER the permit exists. Timestamps are truncated to the second, so a value read
  // before the preflight can land a second earlier than the permit and be rejected as
  // retrospective - which is the check working, and the fixture getting the order wrong.
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const disc = await run(['discovery', '--out', dir, '--agency', agency, '--website', origin,
    '--url', discoveryUrl, '--method', 'navigation',
    '--outcome', 'candidates-found', '--category', category, '--set-version', '1',
    '--navigated-at', at, '--permit-id', permitId]);
  assert.equal(disc.status, 0, disc.stderr);
  const add = await run(['candidates', '--out', dir, '--agency', agency, '--category', category, '--add', urls.join(',')]);
  assert.equal(add.status, 0, add.stderr);
  const locked = await run(['lock', '--out', dir, '--agency', agency, '--category', category]);
  assert.equal(locked.status, 0, locked.stderr);
  // Assessment requires the researcher to approve the set, which is its own gate.
  // And spaced from whatever navigates next: each CLI invocation builds a fresh pacer, so a
  // following `capture` in its own process does not sleep on this record's behalf. In a real run
  // that gap is the operator's own working time.
  await new Promise((r) => setTimeout(r, 6500));
  const approved = await run(['approve-set', '--out', dir, '--agency', agency, '--category', category]);
  assert.equal(approved.status, 0, approved.stderr);
  return locked;
};

const inTemp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-cli-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('capture CLI', () => {
  test('capture, approve, build and seal, end to end', async () => {
    await inTemp(async (dir) => {
      await lockSet(dir, 'Synthetic Agency', 'enquiry-or-contact', [`${origin}/contact`]);
      const cap = await run(['capture', '--out', dir, '--agency', 'Synthetic Agency',
        '--website', origin, '--url', `${origin}/contact`, '--page-id', 'synthetic-001',
        '--category', 'enquiry-or-contact', '--evidence', 'declares a First name field',
        '--synthetic', '--frame-sha256', FRAME, '--draw-order-sha256', DRAW]);
      assert.equal(cap.status, 0, cap.stderr);
      assert.match(cap.stdout, /captured synthetic-001/);

      // The capture exists, and the ledger names it.
      assert.ok(existsSync(join(dir, 'captures', 'synthetic-001.html')));
      const ledger = readFileSync(join(dir, 'captures', 'selection-ledger.csv'), 'utf8');
      assert.match(ledger, /synthetic-001/);
      assert.match(ledger, /pending/, 'a fresh capture is pending approval');

      // The draft is withheld while approval is pending - the corpus cannot be built on
      // judgements nobody confirmed.
      assert.match(cap.stdout, /draft held: .*(pending researcher approval|work is unfinished)/);
      assert.ok(!existsSync(join(dir, 'corpus-draft.json')));

      const ok = await run(['approve', '--out', dir, '--url', `${origin}/contact`,
        '--frame-sha256', FRAME, '--draw-order-sha256', DRAW, '--synthetic']);
      assert.equal(ok.status, 0, ok.stderr);

      const built = await run(['build', '--out', dir, '--frame-sha256', FRAME,
        '--draw-order-sha256', DRAW, '--synthetic']);
      assert.equal(built.status, 0, built.stderr);
      const draft = JSON.parse(readFileSync(join(dir, 'corpus-draft.json'), 'utf8'));
      assert.equal(draft.pages.length, 1);
      assert.equal(draft.pages[0].pageId, 'synthetic-001');
      assert.equal(draft.pages[0].htmlSha256, undefined, 'the seal hashes; the draft does not claim');

      // And the FROZEN seal accepts it. This is the join the separate calls could not
      // guarantee: capture -> ledger -> draft -> corpus.
      const sealed = await seal([
        '--draft', join(dir, 'corpus-draft.json'),
        '--captures', join(dir, 'captures'),
        '--out', join(dir, 'corpus.json'),
        '--synthetic', '--development',
      ]);
      assert.equal(sealed.status, 0, sealed.stderr);
      const corpus = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'));
      assert.equal(corpus.pages.length, 1);
      assert.ok(corpus.pages[0].sha256 ?? corpus.pages[0].htmlSha256, 'the seal recorded a content hash');
    });
  });

  test('no submit event fires and no input receives typed data', () => {
    // The protocol forbids entering personal information or submitting a form. The page
    // records every submit, input and keydown it sees into an attribute, so the captured
    // markup itself is the evidence that none occurred.
    inTemp(async (dir) => {
      await lockSet(dir, 'A', 'enquiry-or-contact', [`${origin}/events`]);
      const cap = await run(['capture', '--out', dir, '--agency', 'A', '--website', origin,
        '--url', `${origin}/events`, '--page-id', 'events-001', '--category', 'enquiry-or-contact',
        '--evidence', 'has a name field', '--synthetic']);
      assert.equal(cap.status, 0, cap.stderr);
      const html = readFileSync(join(dir, 'captures', 'events-001.html'), 'utf8');
      const recorded = /data-events="([^"]*)"/.exec(html)?.[1] ?? '';
      assert.equal(recorded, '', `the page observed events during capture: ${recorded}`);
      assert.match(html, /value=""|<input(?![^>]*\svalue=)/, 'no input carries a typed value');
    });
  });

  test('robots.txt is honoured, and the refusal is recorded not silent', async () => {
    await inTemp(async (dir) => {
      await lockSet(dir, 'A', 'enquiry-or-contact', [`${origin}/private/form`]);
      const cap = await run(['capture', '--out', dir, '--agency', 'A', '--website', origin,
        '--url', `${origin}/private/form`, '--page-id', 'private-001',
        '--category', 'enquiry-or-contact', '--evidence', 'would qualify', '--synthetic']);
      assert.equal(cap.status, 0, cap.stderr);
      assert.match(cap.stdout, /robots\.txt disallows/);
      assert.ok(!existsSync(join(dir, 'captures', 'private-001.html')), 'nothing was fetched');
      assert.match(readFileSync(join(dir, 'captures', 'selection-ledger.csv'), 'utf8'), /robots\.txt disallows/);
    });
  });

  test('a sign-in wall is excluded, never bypassed', async () => {
    await inTemp(async (dir) => {
      await lockSet(dir, 'A', 'account-registration', [`${origin}/locked`]);
      const cap = await run(['capture', '--out', dir, '--agency', 'A', '--website', origin,
        '--url', `${origin}/locked`, '--page-id', 'locked-001',
        '--category', 'account-registration', '--evidence', 'looked like a registration form', '--synthetic']);
      assert.equal(cap.status, 0, cap.stderr);
      assert.match(cap.stdout, /excluded: .*password field/);
      assert.match(readFileSync(join(dir, 'captures', 'selection-ledger.csv'), 'utf8'), /not publicly reachable/);
    });
  });

  test('required arguments are named, not guessed', async () => {
    const r = await run(['capture', '--out', '/tmp/x']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--agency is required/);
  });

  test('an unsafe pageId and a non-http URL are refused', async () => {
    await inTemp(async (dir) => {
      const bad = await run(['capture', '--out', dir, '--agency', 'A', '--website', origin,
        '--url', `${origin}/x`, '--page-id', '../escape', '--category', 'enquiry-or-contact',
        '--evidence', 'e']);
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /pageId must be/);

      const scheme = await run(['capture', '--out', dir, '--agency', 'A', '--website', origin,
        '--url', 'file:///etc/passwd', '--page-id', 'x-001', '--category', 'enquiry-or-contact',
        '--evidence', 'e']);
      assert.notEqual(scheme.status, 0);
      assert.match(scheme.stderr, /only http and https/);
    });
  });

  test('the same URL cannot be recorded twice for one agency', async () => {
    await inTemp(async (dir) => {
      await lockSet(dir, 'A', 'enquiry-or-contact', [`${origin}/dup`]);
      const args = ['capture', '--out', dir, '--agency', 'A', '--website', origin,
        '--url', `${origin}/dup`, '--page-id', 'dup-001', '--category', 'enquiry-or-contact',
        '--evidence', 'e', '--synthetic'];
      assert.equal((await run(args)).status, 0);
      const again = await run([...args.slice(0, -1), '--page-id', 'dup-002', '--synthetic']);
      assert.notEqual(again.status, 0, 'a second attempt at the same URL for one agency must be refused');
    });
  });
});
