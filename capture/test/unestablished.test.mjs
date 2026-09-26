/**
 * The robots-representation rule, and the accounting that had to change to record nine
 * navigations honestly.
 *
 * Each test here is an attack that worked against selection-v1.0.20 and capture-v1.0.6. The
 * first one is the live breach: all three New Zealand Security Intelligence Service hosts answer
 * `/robots.txt` with HTTP 200 and a 212-byte Imperva/Incapsula challenge page, which the previous
 * code recorded as a valid, permissive robots file. Six requests were authorised on that basis.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DISPOSITION, dispositionForStatus, classifyResponse, classifyRepresentation, evaluatePolicy,
  fetchRobotsPolicy,
} from '../robots-policy.mjs';
import {
  emptyLog, recordRobotsCheck, robotsCheckIsFresh, ROBOTS_MAX_AGE_MS, issueDiscoveryPermit,
  consumeDiscoveryPermit, appendAttempt, permitAudit, recordCandidates, lockCandidateSet,
  recordDeviation, checkDeviations, corpusBlockers, checkCaptureFiles, quarantineCapture,
  PERMIT_TTL_MS, sha256,
} from '../run.mjs';
import { DISCOVERY_OUTCOMES, TECHNICAL_ATTRITION_OUTCOMES } from '../selection.mjs';
import { captureDisposition, needsHeadedFallback } from '../capture.mjs';

/** The real thing, byte for byte, from https://www.nzsis.govt.nz/robots.txt on 2026-09-26. */
const INCAPSULA = Buffer.from(
  '<html>\r\n<head>\r\n<META NAME="robots" CONTENT="noindex,nofollow">\r\n' +
    '<script src="/_Incapsula_Resource?SWJIYLWA=5074a744d9d8b63c4e5a1e0d1f2c3b4a"></script>\r\n' +
    '<body></body>\r\n</html>'
);

const REAL_ROBOTS = Buffer.from('User-agent: *\nDisallow: /user/register\nDisallow: /search?\n');

const response = (status, contentType, bytes) => ({
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
  async arrayBuffer() { return bytes; },
  async text() { return bytes.toString('utf8'); },
});

describe('a 2xx is not proof that a robots file was served', () => {
  test('an Incapsula challenge page with HTTP 200 is unestablished, not rules', () => {
    const { disposition, representation } = classifyResponse({
      status: 200, contentType: 'text/html', bytes: INCAPSULA,
    });
    assert.equal(disposition, DISPOSITION.UNESTABLISHED);
    assert.equal(representation.valid, false);
    assert.equal(representation.challenge, 'Imperva/Incapsula');
  });

  test('the breach: it must not resolve to "no applicable rule" for /user/register', () => {
    // This is the exact sequence that issued p-0084 to p-0089. parseRobots finds no directives in
    // HTML, isAllowed then reports no applicable rule, and the log recorded permission.
    const policy = { ...classifyResponse({ status: 200, contentType: 'text/html', bytes: INCAPSULA }), httpStatus: 200 };
    const verdict = evaluatePolicy(policy, '/user/register');
    assert.equal(verdict.allowed, false, 'a challenge page must not authorise a request');
    assert.equal(verdict.unestablished, true);
    assert.match(verdict.reason, /Imperva\/Incapsula/);
    assert.doesNotMatch(verdict.reason, /no applicable rule/);
  });

  test('a status code alone never yields rules', () => {
    for (const status of [200, 201, 204, 299]) {
      assert.equal(dispositionForStatus(status), DISPOSITION.UNESTABLISHED, `HTTP ${status}`);
    }
  });

  test('4xx, 5xx and network failure keep their RFC 9309 readings', () => {
    assert.equal(dispositionForStatus(404), DISPOSITION.ALLOW_ALL);
    assert.equal(dispositionForStatus(403), DISPOSITION.ALLOW_ALL);
    assert.equal(dispositionForStatus(503), DISPOSITION.DISALLOW_ALL);
    assert.equal(dispositionForStatus(null), DISPOSITION.DISALLOW_ALL);
  });
});

describe('what counts as a robots representation', () => {
  test('text/plain with directives is rules, and the directives govern', () => {
    const { disposition } = classifyResponse({ status: 200, contentType: 'text/plain', bytes: REAL_ROBOTS });
    assert.equal(disposition, DISPOSITION.RULES);
    const policy = { disposition, httpStatus: 200, body: REAL_ROBOTS.toString('utf8') };
    assert.equal(evaluatePolicy(policy, '/user/register').allowed, false);
    assert.equal(evaluatePolicy(policy, '/contact').allowed, true);
  });

  test('a charset parameter is allowed', () => {
    for (const ct of ['text/plain; charset=utf-8', 'text/plain;charset=UTF-8', 'TEXT/PLAIN; charset=us-ascii']) {
      assert.equal(
        classifyResponse({ status: 200, contentType: ct, bytes: REAL_ROBOTS }).disposition,
        DISPOSITION.RULES, ct
      );
    }
  });

  test('an EMPTY text/plain robots file is rules and permits everything', () => {
    // A server may legitimately publish a robots file with no directives. Requiring at least one
    // would turn a real, permissive policy into an unreadable one.
    const { disposition, representation } = classifyResponse({
      status: 200, contentType: 'text/plain', bytes: Buffer.alloc(0),
    });
    assert.equal(disposition, DISPOSITION.RULES);
    assert.equal(representation.valid, true);
    assert.equal(evaluatePolicy({ disposition, httpStatus: 200, body: '' }, '/user/register').allowed, true);
  });

  test('bytes that are not valid UTF-8 are unestablished', () => {
    const { disposition, representation } = classifyResponse({
      status: 200, contentType: 'text/plain', bytes: Buffer.from([0x55, 0x73, 0xff, 0xfe, 0x0a]),
    });
    assert.equal(disposition, DISPOSITION.UNESTABLISHED);
    assert.match(representation.reason, /not valid UTF-8/);
  });

  test('markup mislabelled as text/plain is still unestablished', () => {
    // The media type is a claim by the server, so it is checked rather than trusted.
    const { disposition, representation } = classifyResponse({
      status: 200, contentType: 'text/plain', bytes: INCAPSULA,
    });
    assert.equal(disposition, DISPOSITION.UNESTABLISHED);
    assert.equal(representation.challenge, 'Imperva/Incapsula');
  });

  test('a missing content type is unestablished, not assumed to be text', () => {
    assert.equal(
      classifyResponse({ status: 200, contentType: null, bytes: REAL_ROBOTS }).disposition,
      DISPOSITION.UNESTABLISHED
    );
  });

  test('other vendors are named too', () => {
    const cf = Buffer.from('<html><head><title>Attention Required! | Cloudflare</title></head></html>');
    assert.equal(classifyRepresentation({ contentType: 'text/html', bytes: cf }).challenge, 'Cloudflare');
  });
});

describe('unestablished is neither permission nor refusal', () => {
  const policy = {
    disposition: DISPOSITION.UNESTABLISHED, httpStatus: 200,
    representation: { valid: false, reason: 'the media type was text/html, not text/plain', challenge: 'Imperva/Incapsula' },
  };

  test('every path is withheld', () => {
    for (const path of ['/user/register', '/', '/sitemap.xml', '/contact?x=1']) {
      assert.equal(evaluatePolicy(policy, path).allowed, false, path);
    }
  });

  test('/robots.txt stays retrievable, so the origin can be re-checked', () => {
    assert.equal(evaluatePolicy(policy, '/robots.txt').allowed, true);
  });

  test('it is flagged so a caller cannot record it as a disallow', () => {
    // The distinction that matters downstream: `disallowed` says the host forbade the path.
    // Nothing here was forbidden by anyone.
    const v = evaluatePolicy(policy, '/user/register');
    assert.equal(v.unestablished, true);
    const disallow = evaluatePolicy({ disposition: DISPOSITION.DISALLOW_ALL, httpStatus: 503 }, '/x');
    assert.equal(disallow.unestablished, undefined);
    assert.notEqual(v.reason, disallow.reason);
  });

  test('it is cached for no longer than 24 hours', () => {
    const log = emptyLog();
    const at = Date.parse('2026-09-27T00:00:00Z');
    const check = recordRobotsCheck(log, { ...policy, origin: 'https://x.govt.nz', fetchedAt: '2026-09-27T00:00:00Z' });
    assert.equal(robotsCheckIsFresh(check, at + ROBOTS_MAX_AGE_MS - 1000), true);
    assert.equal(robotsCheckIsFresh(check, at + ROBOTS_MAX_AGE_MS + 1000), false);
  });
});

test('fetchRobotsPolicy records the content type and the challenge, and keeps no body', async () => {
  const policy = await fetchRobotsPolicy('https://www.nzsis.govt.nz', {
    fetchImpl: async () => response(200, 'text/html', INCAPSULA),
  });
  assert.equal(policy.disposition, DISPOSITION.UNESTABLISHED);
  assert.equal(policy.contentType, 'text/html');
  assert.equal(policy.representation.challenge, 'Imperva/Incapsula');
  assert.equal(policy.bytes, INCAPSULA.length, 'the evidence is sized as received');
  assert.equal(policy.body, '', 'a challenge page is not a policy and must not be stored as one');
  assert.equal(policy.sha256, sha256(INCAPSULA));
});

describe('the three attrition outcomes', () => {
  test('they are valid discovery outcomes and are marked as attrition', () => {
    for (const o of ['robots-unestablished', 'retrieval-blocked', 'retrieval-inconclusive']) {
      assert.ok(DISCOVERY_OUTCOMES.includes(o), o);
      assert.ok(TECHNICAL_ATTRITION_OUTCOMES.includes(o), o);
    }
  });

  test('no-candidates is NOT attrition, because it is a finding about the agency', () => {
    for (const o of ['candidates-found', 'no-candidates', 'unavailable', 'disallowed']) {
      assert.equal(TECHNICAL_ATTRITION_OUTCOMES.includes(o), false, o);
    }
  });

  test('a round of nothing but attrition locks as an empty set', () => {
    const log = emptyLog();
    const agency = 'A';
    for (const [i, outcome] of ['retrieval-blocked', 'retrieval-blocked', 'retrieval-inconclusive'].entries()) {
      appendAttempt(log, {
        examinedAt: `2026-09-26T19:0${i}:00Z`, agency, website: 'https://a.govt.nz/',
        url: `https://a.govt.nz/p${i}`, status: 'discovery', discoveryKind: 'navigation',
        outcome, category: 'account-registration', candidateSetVersion: 1,
        navigatedAt: `2026-09-26T19:0${i}:00Z`, approval: 'approved',
      });
    }
    recordCandidates(log, { agency, category: 'account-registration', urls: [], declaration: 'none' });
    const set = lockCandidateSet(log, { agency, category: 'account-registration' });
    assert.equal(set.locked.length, 0);
    assert.equal(set.candidateDeclaration, 'none');
  });
});

describe('the capture decision, taken once from the final record', () => {
  const r = (over = {}) => ({ httpStatus: 200, accessBarriers: [], ...over });

  test('the fallback is for automation barriers only', () => {
    assert.equal(needsHeadedFallback(r({ accessBarriers: ['cloudflare interstitial'] })), true);
    assert.equal(needsHeadedFallback(r({ accessBarriers: ['http 403'] })), true);
    assert.equal(needsHeadedFallback(r({ accessBarriers: ['sign-in wall'] })), false,
      'a sign-in wall is what the public sees; a visible window would not change it');
    assert.equal(needsHeadedFallback(r()), false);
    assert.equal(needsHeadedFallback(null), false);
  });

  test('the case that used to be unreachable: challenge, then a sign-in wall behind it', () => {
    // capture-v1.0.6 checked for a sign-in wall BEFORE the fallback and never again, so this
    // record matched no branch and died inside validation on the adoption path.
    const headless = r({ accessBarriers: ['cloudflare interstitial'] });
    assert.equal(needsHeadedFallback(headless), true);
    const headed = r({ accessBarriers: ['sign-in wall'] });
    assert.equal(captureDisposition(headed).kind, 'excluded-sign-in');
  });

  test('the whole table', () => {
    assert.equal(captureDisposition(r()).kind, 'adopt');
    assert.equal(captureDisposition(r({ accessBarriers: ['sign-in wall'] })).kind, 'excluded-sign-in');
    assert.equal(captureDisposition(r({ accessBarriers: ['http 403'] })).kind, 'capture-blocked');
    assert.equal(captureDisposition(r({ accessBarriers: ['sign-in wall', 'http 403'] })).kind, 'excluded-sign-in');
    assert.equal(captureDisposition(r({ httpStatus: 429 })).kind, 'rate-limited');
    assert.equal(captureDisposition(null).kind, 'failed');
  });

  test('a 429 outranks every other reading, including a clean page', () => {
    // The markup for a 429 is already on disk, so this branch has to run before adoption.
    assert.equal(captureDisposition(r({ httpStatus: 429, accessBarriers: [] })).kind, 'rate-limited');
    assert.equal(captureDisposition(r({ httpStatus: 429, accessBarriers: ['sign-in wall'] })).kind, 'rate-limited');
  });
});

describe('capture files must match the log by bytes, not by name', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-files-'));
    const captures = join(dir, 'captures');
    mkdirSync(captures, { recursive: true });
    return { dir, captures };
  };

  test('a file edited after capture is detected', () => {
    const { captures } = setup();
    const html = '<html><body><input name="name"></body></html>';
    writeFileSync(join(captures, 'p.html'), html, 'utf8');
    const log = emptyLog();
    log.attempts.push({
      id: 'c-0001', status: 'captured', file: 'p.html', htmlSha256: sha256(html),
      agency: 'A', url: 'https://a.govt.nz/f', approval: 'approved',
    });
    assert.deepEqual(checkCaptureFiles(log, captures), [], 'the untouched file passes');

    writeFileSync(join(captures, 'p.html'), `${html}<!-- edited -->`, 'utf8');
    const problems = checkCaptureFiles(log, captures);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /hashes to .* but c-0001 records/);
  });

  test('an unreadable file is a problem, not a pass', () => {
    const { captures } = setup();
    const log = emptyLog();
    log.attempts.push({
      id: 'c-0001', status: 'captured', file: 'gone.html', htmlSha256: sha256('x'),
      agency: 'A', url: 'https://a.govt.nz/f', approval: 'approved',
    });
    assert.match(checkCaptureFiles(log, captures).join('\n'), /is not on disk/);
  });
});

describe('a refusal after the markup is written leaves no orphan', () => {
  test('quarantine moves the file out and records why', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-q-'));
    const captures = join(dir, 'captures');
    mkdirSync(captures, { recursive: true });
    writeFileSync(join(captures, 'p.html'), '<html>429 body</html>', 'utf8');

    const moved = quarantineCapture(captures, 'p.html', { reason: 'HTTP 429; run stopped by policy' });
    assert.ok(moved, 'the file was moved');
    assert.equal(existsSync(join(captures, 'p.html')), false, 'nothing is left in the captures directory');
    assert.equal(existsSync(moved), true, 'the evidence is preserved, not deleted');
    assert.match(readdirSync(join(dir, 'quarantine')).join(' '), /reason\.txt/);

    // And the captures directory now passes the orphan gate, which it did not before.
    assert.deepEqual(checkCaptureFiles(emptyLog(), captures), []);
  });

  test('an orphan left behind IS caught, so the quarantine is load-bearing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-q2-'));
    const captures = join(dir, 'captures');
    mkdirSync(captures, { recursive: true });
    writeFileSync(join(captures, 'p.html'), '<html>429 body</html>', 'utf8');
    assert.match(checkCaptureFiles(emptyLog(), captures).join('\n'), /no captured attempt owns it/);
  });

  test('quarantining a file that is not there is not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-q3-'));
    const captures = join(dir, 'captures');
    mkdirSync(captures, { recursive: true });
    assert.equal(quarantineCapture(captures, 'nothing.html', { reason: 'x' }), null);
  });
});

describe('a real past navigation can be written down late, and only honestly', () => {
  // The nine NZSIS navigations were each made seconds after their own permit, and could not be
  // recorded a day later because the rule also governed the bookkeeping. The permit's life governs
  // the REQUEST; being slow to write it down is a disclosure problem, so it is disclosed.
  //
  // Built RELATIVE to now rather than from fixed dates. A fixture dated by the calendar passes or
  // fails depending on when the suite is run, which is how the first draft of these two tests
  // silently asserted nothing: the permits they were modelled on turned out to be forty-seven
  // minutes old, not thirteen hours, so the expiry they were checking had not happened yet.
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const build = ({ hoursAgo = 25 } = {}) => {
    const issuedMs = Date.now() - hoursAgo * 60 * 60 * 1000;
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: iso(issuedMs - 10_000), httpStatus: 404, disposition: 'allow-all',
      sha256: sha256(''), bytes: 0, body: '',
    });
    const permit = issueDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', robotsCheckId: 'r-0001', reason: 'unavailable',
    });
    permit.issuedAt = iso(issuedMs);
    return { log, permit, issuedMs, navigatedAt: iso(issuedMs + 6_000) };
  };

  test('a navigation inside the permit life is accepted however late the record is', () => {
    const { log, permit, navigatedAt } = build();
    const consumed = consumeDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', navigatedAt, permitId: permit.id,
    });
    assert.ok(consumed.consumedAt);
  });

  test('and the delay is disclosed, derived from the timestamps rather than declared', () => {
    const { log, permit, navigatedAt } = build();
    consumeDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', navigatedAt, permitId: permit.id,
    });
    appendAttempt(log, {
      permitId: permit.id, examinedAt: navigatedAt, agency: 'A',
      website: 'https://a.govt.nz/', url: 'https://a.govt.nz/', status: 'discovery',
      discoveryKind: 'navigation', outcome: 'retrieval-inconclusive',
      category: 'account-registration', candidateSetVersion: 1,
      navigatedAt, approval: 'approved',
    });
    const audit = permitAudit(log);
    assert.equal(audit.recordedLate, 1);
    assert.equal(audit.lateRecords[0].permitId, permit.id);
    assert.ok(audit.lateRecords[0].delayMs > PERMIT_TTL_MS);
  });

  test('a navigation OUTSIDE the permit life is still refused', () => {
    const { log, permit, issuedMs } = build();
    assert.throws(() => consumeDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', navigatedAt: iso(issuedMs + 2 * 60 * 60 * 1000), permitId: permit.id,
    }), /more than an hour after permit/);
  });

  test('a navigation before its own permit is still refused', () => {
    const { log, permit, issuedMs } = build();
    assert.throws(() => consumeDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', navigatedAt: iso(issuedMs - 60_000), permitId: permit.id,
    }), /precedes permit/);
  });

  test('a stale permit consumed with NO navigation time is still refused', () => {
    // This is the path that must stay strict: with nothing saying when the request happened,
    // consumption time is the only evidence of it.
    const { log, permit } = build();
    assert.throws(() => consumeDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', permitId: permit.id,
    }), /has expired/);
  });

  test('a navigation dated after its own consumption is caught by the ledger gate', () => {
    // Not refused at write time: the rule lives in `checkPermitLedger`, which every gate runs.
    // This asserts the gate actually holds it, rather than assuming it does.
    const { log, permit, issuedMs } = build({ hoursAgo: 0 });
    consumeDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', navigatedAt: iso(issuedMs + 30 * 60 * 1000), permitId: permit.id,
    });
    appendAttempt(log, {
      permitId: permit.id, examinedAt: iso(issuedMs), agency: 'A',
      website: 'https://a.govt.nz/', url: 'https://a.govt.nz/', status: 'discovery',
      discoveryKind: 'navigation', outcome: 'retrieval-blocked',
      category: 'account-registration', candidateSetVersion: 1,
      navigatedAt: iso(issuedMs + 30 * 60 * 1000), approval: 'approved',
    });
    const blockers = corpusBlockers(log);
    const ledger = blockers.find((b) => b.kind === 'permit-ledger');
    assert.ok(ledger, 'the ledger gate reports it');
    assert.match(ledger.items.join('\n'), /was consumed at .*, before .* navigated at/);
  });
});

describe('a deviation must name evidence that exists and must not contradict it', () => {
  const withRecords = () => {
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: '2026-09-26T19:06:40Z', httpStatus: 200, disposition: 'rules',
      sha256: sha256('x'), bytes: 1, body: '',
    });
    issueDiscoveryPermit(log, {
      agency: 'A', category: 'account-registration', candidateSetVersion: 1,
      url: 'https://a.govt.nz/', robotsCheckId: 'r-0001', reason: 'no applicable rule',
    });
    return log;
  };

  test('a deviation naming a permit that does not exist is refused', () => {
    const log = withRecords();
    assert.throws(() => recordDeviation(log, {
      kind: 'robots-misclassification', summary: 's', detail: 'd', permitIds: ['p-9999'],
    }), /names permit p-9999, which does not exist/);
    assert.equal((log.deviations ?? []).length, 0, 'and nothing is left behind');
  });

  test('a deviation naming a robots check that does not exist is refused', () => {
    const log = withRecords();
    assert.throws(() => recordDeviation(log, {
      kind: 'k', summary: 's', detail: 'd', robotsCheckIds: ['r-0001', 'r-0404'],
    }), /names robots check r-0404/);
  });

  test('a deviation with no detail is refused', () => {
    const log = withRecords();
    assert.throws(() => recordDeviation(log, { kind: 'k', summary: 's', detail: '  ' }), /has no detail/);
  });

  test('a real deviation records and validates', () => {
    const log = withRecords();
    const d = recordDeviation(log, {
      kind: 'robots-misclassification',
      summary: 'a challenge page was read as a permissive robots file',
      detail: 'HTTP 200 with text/html was classified as rules.',
      robotsCheckIds: ['r-0001'], permitIds: ['p-0001'], requestsAffected: 1,
      candidateEvidenceObtained: false,
    });
    assert.equal(d.id, 'v-0001');
    assert.deepEqual(checkDeviations(log), []);
    assert.equal(corpusBlockers(log).some((b) => b.kind === 'deviations'), false);
  });

  test('claiming no candidate evidence while naming a candidates-found record is refused', () => {
    const log = withRecords();
    appendAttempt(log, {
      permitId: 'p-0001', examinedAt: '2026-09-26T19:06:56Z', agency: 'A',
      website: 'https://a.govt.nz/', url: 'https://a.govt.nz/', status: 'discovery',
      discoveryKind: 'navigation', outcome: 'candidates-found',
      category: 'account-registration', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:06:56Z', approval: 'approved',
    });
    assert.throws(() => recordDeviation(log, {
      kind: 'k', summary: 's', detail: 'd',
      attemptIds: ['d-0001'], candidateEvidenceObtained: false,
    }), /report candidates-found/);
  });

  test('an inconsistent deviation shows up as a corpus blocker, not only at write time', () => {
    const log = withRecords();
    recordDeviation(log, { kind: 'k', summary: 's', detail: 'd', permitIds: ['p-0001'] });
    log.deviations[0].permitIds = ['p-9999']; // tampered with after the fact
    assert.equal(corpusBlockers(log).some((b) => b.kind === 'deviations'), true);
  });
});
