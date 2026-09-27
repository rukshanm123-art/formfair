/**
 * The robots-representation rule, and the accounting that had to change to record nine
 * navigations honestly.
 *
 * Each test here is an attack that worked against selection-v1.0.20 and capture-v1.0.6. The
 * first one is the live breach: all three New Zealand Security Intelligence Service hosts answer
 * `/robots.txt` with HTTP 200 and a 212-byte Imperva/Incapsula challenge page, which the previous
 * code recorded as a valid, permissive robots file. Six requests were authorised on that basis.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import {
  DISPOSITION, dispositionForStatus, classifyResponse, classifyRepresentation, evaluatePolicy,
  fetchRobotsPolicy,
} from '../robots-policy.mjs';
import {
  emptyLog, recordRobotsCheck, robotsCheckIsFresh, ROBOTS_MAX_AGE_MS, issueDiscoveryPermit,
  consumeDiscoveryPermit, appendAttempt, permitAudit, recordCandidates, lockCandidateSet,
  recordDeviation, checkDeviations, corpusBlockers, checkCaptureFiles, quarantineCapture,
  PERMIT_TTL_MS, sha256, approveCandidateSet, exhaustAgency, agencyResolution, agencyResolutions,
  AGENCY_RESOLUTIONS, BOUNDED_COMPLETE_REASON, ATTRITION_REASON, reResolveExhaustion,
  renderBacklog, renderBacklogByUrl, renderPrerequisite, SUPERSEDED_COMPLETE_REASONS,
  recordRender, findRender, findRenderForUrl, checkRenderLedger, assertRenderEvidenceUsable,
  reResolveCandidateSet, staleSetBindings, approveCandidateSet as approveSet,
  assertPermitUsable, adoptRender, publishProvenance, checkPermitLedger,
} from '../run.mjs';
import {
  DISCOVERY_OUTCOMES, TECHNICAL_ATTRITION_OUTCOMES, CATEGORY_ORDER, parseDrawOrder,
} from '../selection.mjs';
import { captureDisposition, needsHeadedFallback } from '../capture.mjs';
import { buildPacket, renderPacket } from '../packet.mjs';
import { renderDiscoveryPage } from '../render-discovery.mjs';

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


/** A fresh, permissive robots policy for one origin. */
const withPolicyFor = (log, origin, body = '') => {
  recordRobotsCheck(log, {
    origin, url: `${origin}/robots.txt`,
    fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    httpStatus: 200, disposition: 'rules', sha256: sha256(body), bytes: body.length, body,
  });
  return log;
};


/**
 * Binds every discovery record in the log into a current candidate set, per category.
 *
 * selection-v1.0.26: the backlog counts only evidence a CURRENT set stands on, so a fixture that
 * binds nothing has an empty backlog - correctly. Eight tests written before that rule had to be
 * given bindings, which is what a real round always has.
 */
const bindAll = (log) => {
  for (const a of log.attempts.filter((x) => x.status === 'discovery')) {
    const key = `${a.agency}\u0000${a.category}`;
    const set = (log.candidateSets[key] ??= {
      agency: a.agency, category: a.category, version: a.candidateSetVersion ?? 1,
      discovered: [], locked: [], lockedAt: '2026-09-26T23:00:00Z', approval: 'approved',
      candidateDeclaration: 'none', discoveryRecordIds: [],
    });
    if (!set.discoveryRecordIds.includes(a.id)) set.discoveryRecordIds.push(a.id);
  }
  return log;
};

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

describe('the packet must not call an unreadable origin an empty one', () => {
  // The wording that was wrong: "none - this category yields no eligible form" asserts the agency
  // publishes none. For NZSIS nothing of the kind was established: two origins refused every
  // request and the third answered with 404s and a client-rendered shell.
  const roundWith = (rows) => {
    const log = emptyLog();
    const agency = 'NZSIS';
    rows.forEach(([url, outcome, method], i) => {
      appendAttempt(log, {
        examinedAt: `2026-09-26T19:0${i}:00Z`, agency, website: new URL(url).origin + '/',
        url, status: 'discovery', discoveryKind: method ?? 'navigation', outcome,
        category: 'account-registration', candidateSetVersion: 1,
        navigatedAt: `2026-09-26T19:0${i}:00Z`, approval: 'approved',
      });
    });
    recordCandidates(log, { agency, category: 'account-registration', urls: [], declaration: 'none' });
    lockCandidateSet(log, { agency, category: 'account-registration' });
    return renderPacket(buildPacket(log, { agency, category: 'account-registration' }));
  };

  test('an empty set built on attrition says so, per origin', () => {
    const text = roundWith([
      ['https://a.govt.nz/robots.txt', 'retrieval-blocked', 'robots'],
      ['https://a.govt.nz/', 'retrieval-blocked'],
      ['https://b.govt.nz/robots.txt', 'unavailable', 'robots'],
      ['https://b.govt.nz/', 'retrieval-inconclusive'],
    ]);
    assert.doesNotMatch(text, /this category yields no eligible form/,
      'it must not claim the agency publishes none');
    assert.match(text, /NOT because the category was searched and found empty/);
    assert.match(text, /https:\/\/a\.govt\.nz - retrieval-blocked x2/);
    // The distinction the first attempt at this collapsed: b was not blocked, it answered.
    assert.match(text, /https:\/\/b\.govt\.nz - unavailable x1, retrieval-inconclusive x1/);
    assert.match(text, /Nothing here establishes/);
  });

  test('an empty set that really was searched keeps the finding', () => {
    const text = roundWith([
      ['https://a.govt.nz/', 'no-candidates'],
      ['https://a.govt.nz/contact', 'no-candidates'],
    ]);
    assert.match(text, /every inspection was read, and this category yields no eligible form/);
  });

  test('attrition is raised for attention, marked as not read', () => {
    const text = roundWith([['https://a.govt.nz/', 'retrieval-blocked']]);
    assert.match(text, /NOT READ \(retrieval-blocked\): navigation https:\/\/a\.govt\.nz\//);
  });
});

describe('an agency leaves the scan under one of two resolutions', () => {
  // selection-v1.0.23. `BOUNDED_COMPLETE_REASON` asserted that all four categories "were searched".
  // For NZSIS that is false: two of three websites answer every request with an Incapsula
  // challenge, so the categories were ATTEMPTED. Filing that as a completed search would put it
  // in the denominator of every prevalence figure.
  const order = parseDrawOrder(
    readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
  );
  const AGENCY = order[0].agency;
  const iso = (n) => `2026-09-26T0${Math.floor(n / 6)}:${String((n % 6) * 10).padStart(2, '0')}:00Z`;

  /** Four settled, approved sets for one agency, each bound to its own discovery record. */
  const settledAgency = (log, outcomes) => {
    let n = 0;
    for (const category of CATEGORY_ORDER) {
      appendAttempt(log, {
        examinedAt: iso(n), agency: AGENCY, website: 'https://a.govt.nz/',
        url: `https://a.govt.nz/${category}`, status: 'discovery', discoveryKind: 'navigation',
        outcome: outcomes[category] ?? 'no-candidates', category, candidateSetVersion: 1,
        navigatedAt: iso(n), approval: 'approved',
      });
      n += 1;
      recordCandidates(log, { agency: AGENCY, category, urls: [], declaration: 'none' });
      lockCandidateSet(log, { agency: AGENCY, category });
      approveCandidateSet(log, { agency: AGENCY, category, approved: true });
    }
    return log;
  };

  test('a completed bounded procedure means bounded-discovery-complete', () => {
    const log = settledAgency(emptyLog(), {});
    const r = agencyResolution(log, AGENCY);
    assert.equal(r.resolution, AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE);
    assert.equal(r.reason, BOUNDED_COMPLETE_REASON);
    assert.deepEqual(r.attritionRecordIds, []);
  });

  test('one bound unreadable record is enough to mean technical attrition', () => {
    for (const outcome of TECHNICAL_ATTRITION_OUTCOMES) {
      const log = settledAgency(emptyLog(), { 'account-registration': outcome });
      const r = agencyResolution(log, AGENCY);
      assert.equal(r.resolution, AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION, outcome);
      assert.equal(r.reason, ATTRITION_REASON);
      assert.equal(r.attritionRecordIds.length, 1);
      assert.deepEqual(r.attritionByOutcome, { [outcome]: 1 });
      assert.notEqual(r.reason, BOUNDED_COMPLETE_REASON);
    }
  });

  test('`unavailable` and `disallowed` are findings, not attrition', () => {
    // A 404 says the resource is not there; a Disallow says the host forbids it. Both were read.
    for (const outcome of ['unavailable', 'disallowed', 'no-candidates']) {
      const log = settledAgency(emptyLog(), { 'service-application': outcome });
      assert.equal(agencyResolution(log, AGENCY).resolution, AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE, outcome);
    }
  });

  test('exhaust writes the derived resolution and its evidence, and nothing else', () => {
    const log = settledAgency(emptyLog(), { 'enquiry-or-contact': 'retrieval-blocked' });
    const record = exhaustAgency(log, order);
    assert.equal(record.agency, AGENCY);
    assert.equal(record.resolution, AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION);
    assert.equal(record.reason, ATTRITION_REASON);
    assert.equal(record.attritionRecordIds.length, 1);
    assert.deepEqual(record.attritionByOutcome, { 'retrieval-blocked': 1 });

    const clean = exhaustAgency(settledAgency(emptyLog(), {}), order);
    assert.equal(clean.resolution, AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE);
    assert.equal(clean.reason, BOUNDED_COMPLETE_REASON);
    assert.equal(clean.attritionRecordIds, undefined, 'a full search names no attrition evidence');
  });

  test('the counts are kept apart, never summed into "agencies searched"', () => {
    const log = settledAgency(emptyLog(), { 'account-registration': 'retrieval-blocked' });
    exhaustAgency(log, order);
    const { counts, records, disagreements } = agencyResolutions(log);
    assert.equal(counts[AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION], 1);
    assert.equal(counts[AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE], 0);
    assert.equal(records[0].agency, AGENCY);
    assert.deepEqual(disagreements, []);
  });

  test('a legacy record with no resolution reads as bounded-discovery-complete', () => {
    const log = settledAgency(emptyLog(), {});
    log.exhausted = [{ agency: AGENCY, exhaustedAt: iso(9), reason: BOUNDED_COMPLETE_REASON, categorySetVersions: {} }];
    const { counts, disagreements } = agencyResolutions(log);
    assert.equal(counts[AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE], 1);
    assert.deepEqual(disagreements, [], 'and its claim is still true, so nothing is reported');
  });

  test('THE DRIFT: a stored full search contradicted by later evidence is reported at the gate', () => {
    // An exhaustion cannot be written wrongly by `exhaustAgency` - it derives. But a round
    // corrected afterwards can make a true record false, and the resolution is what the
    // denominator means, so the gate re-checks it rather than trusting what was written.
    const log = settledAgency(emptyLog(), {});
    exhaustAgency(log, order);
    assert.deepEqual(agencyResolutions(log).disagreements, []);

    const bound = log.candidateSets[`${AGENCY}\u0000account-registration`].discoveryRecordIds[0];
    log.attempts.find((a) => a.id === bound).outcome = 'retrieval-blocked';

    const { disagreements } = agencyResolutions(log);
    assert.equal(disagreements.length, 1);
    assert.match(disagreements[0], /recorded as bounded-discovery-complete but its bound evidence supports technical-discovery-attrition/);
    const blocker = corpusBlockers(log).find((b) => b.kind === 'resolution-disagreements');
    assert.ok(blocker, 'and the corpus gate withholds the draft for it');
  });

  test('an unreadable record no set is bound to does not change the resolution', () => {
    // Evidence a set does not claim is not part of the round the exhaustion rests on.
    const log = settledAgency(emptyLog(), {});
    appendAttempt(log, {
      examinedAt: iso(10), agency: AGENCY, website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/stray', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'retrieval-blocked', category: 'account-registration', candidateSetVersion: 1,
      navigatedAt: iso(10), approval: 'approved',
    });
    assert.equal(agencyResolution(log, AGENCY).resolution, AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE);
  });
});

describe('the packet heading counts records, not inspections', () => {
  test('a round of refusals is not described as nine inspections', () => {
    // Six of the nine NZSIS records inspected no agency content; they record a refusal. The
    // heading is the line a reviewer is most likely to read and least likely to question.
    const log = emptyLog();
    const agency = 'NZSIS';
    const rows = [
      ['https://a.govt.nz/robots.txt', 'retrieval-blocked', 'robots'],
      ['https://a.govt.nz/', 'retrieval-blocked', 'navigation'],
      ['https://b.govt.nz/', 'retrieval-inconclusive', 'navigation'],
      ['https://b.govt.nz/sitemap.xml', 'unavailable', 'sitemap'],
    ];
    rows.forEach(([url, outcome, method], i) => {
      appendAttempt(log, {
        examinedAt: `2026-09-26T19:0${i}:00Z`, agency, website: `${new URL(url).origin}/`,
        url, status: 'discovery', discoveryKind: method, outcome,
        category: 'account-registration', candidateSetVersion: 1,
        navigatedAt: `2026-09-26T19:0${i}:00Z`, approval: 'approved',
      });
    });
    recordCandidates(log, { agency, category: 'account-registration', urls: [], declaration: 'none' });
    lockCandidateSet(log, { agency, category: 'account-registration' });
    const text = renderPacket(buildPacket(log, { agency, category: 'account-registration' }));

    assert.doesNotMatch(text, /^inspections/m, 'the heading must not call a refusal an inspection');
    assert.match(text, /discovery records 4 active/);
    // Three of the four yielded nothing to judge - and the 404 is not one of them, because that
    // resource was read and was simply not there.
    assert.match(text, /3 yielded no candidate judgement: retrieval-blocked x2, retrieval-inconclusive x1/);
  });

  test('a fully readable round carries no such line', () => {
    const log = emptyLog();
    const agency = 'Readable';
    appendAttempt(log, {
      examinedAt: '2026-09-26T19:00:00Z', agency, website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'account-registration', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:00:00Z', approval: 'approved',
    });
    recordCandidates(log, { agency, category: 'account-registration', urls: [], declaration: 'none' });
    lockCandidateSet(log, { agency, category: 'account-registration' });
    const text = renderPacket(buildPacket(log, { agency, category: 'account-registration' }));
    assert.doesNotMatch(text, /yielded no candidate judgement/);
  });
});

describe('the agency resolution cannot be typed by an operator', () => {
  const cli = new URL('../cli-capture.mjs', import.meta.url).pathname;
  const runCli = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  for (const forbidden of ['reason', 'resolution']) {
    test(`exhaust refuses --${forbidden}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'ff-exh-'));
      mkdirSync(join(dir, 'captures'), { recursive: true });
      writeFileSync(join(dir, 'capture-log.json'), JSON.stringify(emptyLog()));
      const r = runCli(['exhaust', '--out', dir, `--${forbidden}`, 'anything at all']);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, new RegExp(`--${forbidden} cannot be given`));
      assert.match(r.stderr, /derived from the discovery records/);
    });
  }
});

test('an exhaustion bound to no evidence is refused, not resolved as a full search', () => {
  // The vacuity: with nothing bound, the derivation returns `searched-in-full` by default - the
  // stronger claim, from no evidence. Found while checking the real log, where fifteen legacy
  // Te Puni Kokiri records carry neither an id nor an outcome and so can never be bound.
  const order = parseDrawOrder(
    readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
  );
  const AGENCY = order[0].agency;
  const log = emptyLog();
  let n = 0;
  for (const category of CATEGORY_ORDER) {
    const at = `2026-09-26T0${Math.floor(n / 6)}:${String((n % 6) * 10).padStart(2, '0')}:00Z`;
    appendAttempt(log, {
      examinedAt: at, agency: AGENCY, website: 'https://a.govt.nz/',
      url: `https://a.govt.nz/${category}`, status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category, candidateSetVersion: 1, navigatedAt: at,
      approval: 'approved',
    });
    n += 1;
    recordCandidates(log, { agency: AGENCY, category, urls: [], declaration: 'none' });
    lockCandidateSet(log, { agency: AGENCY, category });
    approveCandidateSet(log, { agency: AGENCY, category, approved: true });
    log.candidateSets[`${AGENCY}\u0000${category}`].discoveryRecordIds = [];
  }
  assert.equal(agencyResolution(log, AGENCY).boundRecords, 0);
  assert.throws(() => exhaustAgency(log, order), /nothing supports either resolution/);
  assert.equal((log.exhausted ?? []).length, 0, 'and nothing is written');
});

describe('the bounded procedure is what completes, not a full search', () => {
  // selection-v1.0.24. `searched-in-full` overclaimed in its turn: five candidates a category,
  // four methods, and a robots-disallowed URL deliberately never retrieved. What runs to
  // completion is a fixed procedure.
  test('the frozen reason says the procedure completed, not that everything was searched', () => {
    assert.match(BOUNDED_COMPLETE_REASON, /frozen bounded discovery procedure was completed/);
    assert.doesNotMatch(BOUNDED_COMPLETE_REASON, /were searched/);
    assert.doesNotMatch(ATTRITION_REASON, /were searched/);
    assert.equal(AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE, 'bounded-discovery-complete');
  });

  const exhaustedUnderOldWording = () => {
    const log = emptyLog();
    log.exhausted = [{
      agency: 'Legacy', exhaustedAt: '2026-09-25T04:00:00Z',
      reason: SUPERSEDED_COMPLETE_REASONS[0],
      categorySetVersions: { 'account-registration': 1 },
    }];
    // One bound readable record, so the derivation is not vacuous.
    appendAttempt(log, {
      examinedAt: '2026-09-25T03:00:00Z', agency: 'Legacy', website: 'https://l.govt.nz/',
      url: 'https://l.govt.nz/', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'account-registration', candidateSetVersion: 1,
      navigatedAt: '2026-09-25T03:00:00Z', approval: 'approved',
    });
    recordCandidates(log, { agency: 'Legacy', category: 'account-registration', urls: [], declaration: 'none' });
    lockCandidateSet(log, { agency: 'Legacy', category: 'account-registration' });
    return log;
  };

  test('an exhaustion under withdrawn wording is reported, not silently carried forward', () => {
    const log = exhaustedUnderOldWording();
    const { disagreements } = agencyResolutions(log);
    assert.equal(disagreements.length, 1);
    assert.match(disagreements[0], /wording frozen under an earlier protocol/);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'resolution-disagreements'),
      'and it withholds the draft, so the old wording cannot be published');
  });

  test('re-resolving replaces the wording, preserves the record, and keeps the search date', () => {
    const log = exhaustedUnderOldWording();
    const { record, previous } = reResolveExhaustion(log, { agency: 'Legacy', reason: 'protocol wording withdrawn' });
    assert.equal(record.resolution, AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE);
    assert.equal(record.reason, BOUNDED_COMPLETE_REASON);
    assert.equal(record.exhaustedAt, '2026-09-25T04:00:00Z', 'when it was searched is unchanged');
    assert.ok(record.reResolvedAt, 'when the wording was corrected is separate');
    assert.equal(previous.reason, SUPERSEDED_COMPLETE_REASONS[0]);
    // The old record is archived, not edited away.
    assert.equal(log.supersededExhaustions.length, 1);
    assert.equal(log.supersededExhaustions[0].reason, SUPERSEDED_COMPLETE_REASONS[0]);
    assert.match(log.supersededExhaustions[0].supersededReason, /wording withdrawn/);
    assert.deepEqual(agencyResolutions(log).disagreements, []);
  });

  test('re-resolving requires a reason and refuses a no-op', () => {
    const log = exhaustedUnderOldWording();
    assert.throws(() => reResolveExhaustion(log, { agency: 'Legacy', reason: '  ' }), /requires a reason/);
    assert.throws(() => reResolveExhaustion(log, { agency: 'Nobody', reason: 'x' }), /is not recorded as exhausted/);
    reResolveExhaustion(log, { agency: 'Legacy', reason: 'protocol wording withdrawn' });
    assert.throws(() => reResolveExhaustion(log, { agency: 'Legacy', reason: 'again' }),
      /nothing to re-resolve/);
  });
});

describe('the rendered DOM is the authoritative discovery evidence', () => {
  // The rejected alternative was "render only when the raw page is script-driven and has no form".
  // A page can carry a search box, a cookie form or a login form while script inserts the
  // personal-name form later - and that page escapes the trigger entirely.
  let seq = 0;
  /** A rendered record must carry the evidence, so the helper supplies it. */
  const renderedFields = () => ({
    evidence: 'rendered-dom',
    renderFile: `t-${++seq}.html`,
    renderedSha256: sha256(`t-${seq}`),
    renderedBytes: 512,
  });
  const recordFor = (over = {}) => {
    const base = {
      examinedAt: '2026-09-26T19:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:00:00Z', approval: 'approved', ...over,
    };
    return base.evidence === 'rendered-dom' ? { ...renderedFields(), ...base } : base;
  };
  const withPolicy = (log, { origin = 'https://a.govt.nz', body = '' } = {}) => {
    recordRobotsCheck(log, {
      origin, url: `${origin}/robots.txt`,
      fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256(body), bytes: body.length, body,
    });
    return log;
  };

  test('a plain-retrieval navigation record is in the backlog', () => {
    const log = withPolicy(emptyLog());
    appendAttempt(log, recordFor());
    bindAll(log);
    assert.equal(renderBacklog(log).length, 1);
    assert.equal(renderPrerequisite(log, renderBacklog(log)[0]), null, 'and is renderable now');
  });

  test('a rendered record is not in the backlog, but NAMING one does not clear it', () => {
    // selection-v1.0.25 corrected this test as well as the code. It used to assert that a rendered
    // record naming an earlier one cleared both - which is exactly the defect that let `d-0301`
    // leave the backlog while still reading `retrieval-inconclusive` with no judgement ever made
    // about it. A render is evidence; only a judgement for the record's own category answers it.
    const log = withPolicy(emptyLog());
    appendAttempt(log, recordFor());
    const original = log.attempts.at(-1).id;
    appendAttempt(log, recordFor({
      url: 'https://a.govt.nz/apply', category: 'account-registration',
      navigatedAt: '2026-09-26T19:01:00Z', examinedAt: '2026-09-26T19:01:00Z',
      evidence: 'rendered-dom', rendersDiscoveryId: original,
    }));
    bindAll(log);
    assert.deepEqual(renderBacklog(log).map((a) => a.id), [original],
      'the named record is still unanswered: nothing has judged its category');
  });

  test('a render may cross categories, because the page is the same page', () => {
    // The first real use: a service-application render of a page first inspected under
    // account-registration. `supersedesDiscoveryId` requires one category and would refuse it.
    const log = withPolicy(emptyLog());
    appendAttempt(log, recordFor({ category: 'account-registration', outcome: 'retrieval-inconclusive' }));
    const original = log.attempts.at(-1).id;
    assert.doesNotThrow(() => appendAttempt(log, recordFor({
      category: 'service-application', navigatedAt: '2026-09-26T19:02:00Z',
      examinedAt: '2026-09-26T19:02:00Z', evidence: 'rendered-dom', rendersDiscoveryId: original,
    })));
  });

  test('a render of a different page is refused', () => {
    const log = withPolicy(emptyLog());
    appendAttempt(log, recordFor());
    const original = log.attempts.at(-1).id;
    assert.throws(() => appendAttempt(log, recordFor({
      url: 'https://a.govt.nz/elsewhere', navigatedAt: '2026-09-26T19:03:00Z',
      examinedAt: '2026-09-26T19:03:00Z', evidence: 'rendered-dom', rendersDiscoveryId: original,
    })), /a render must be of the same page/);
  });

  test('a plain-retrieval record may not claim to answer another', () => {
    const log = withPolicy(emptyLog());
    appendAttempt(log, recordFor());
    const original = log.attempts.at(-1).id;
    assert.throws(() => appendAttempt(log, recordFor({
      category: 'enquiry-or-contact', navigatedAt: '2026-09-26T19:04:00Z',
      examinedAt: '2026-09-26T19:04:00Z', rendersDiscoveryId: original,
    })), /only a rendered-dom record may name/);
  });

  test('status codes, robots decisions and non-HTML files stay plain-retrieval evidence', () => {
    // There is no DOM behind a 404, and a `Disallow` means there must not be one.
    const log = withPolicy(emptyLog(), { body: 'User-agent: *\nDisallow: /forbidden\n' });
    let t = 0;
    for (const over of [
      { outcome: 'unavailable', url: 'https://a.govt.nz/gone' },
      { outcome: 'disallowed', url: 'https://a.govt.nz/forbidden', navigationPerformed: false, checkedAt: '2026-09-26T19:05:00Z', navigatedAt: undefined },
      { outcome: 'no-candidates', url: 'https://a.govt.nz/form.pdf' },
      { outcome: 'no-candidates', url: 'https://a.govt.nz/sitemap.xml', discoveryKind: 'sitemap' },
      { outcome: 'no-candidates', url: 'https://a.govt.nz/robots.txt', discoveryKind: 'robots' },
    ]) {
      t += 1;
      const at = `2026-09-26T19:1${t}:00Z`;
      appendAttempt(log, recordFor({ examinedAt: at, navigatedAt: at, ...over }));
    }
    assert.deepEqual(renderBacklog(log).map((a) => a.url), []);
  });

  test('a robots-forbidden page is NOT in the backlog: the obligation cannot require a breach', () => {
    const log = withPolicy(emptyLog(), { body: 'User-agent: *\nDisallow: /apply\n' });
    appendAttempt(log, recordFor());
    assert.deepEqual(renderBacklog(log), [],
      'a gate that demanded this render could only be satisfied by ignoring robots');
  });

  test('an origin with no recorded policy stays in the backlog, needing a check first', () => {
    // It must not be dropped: the early rounds predate the recorded-policy model, so excluding
    // them shrank the real obligation from 99 records to 32.
    const log = emptyLog();
    appendAttempt(log, recordFor());
    bindAll(log);
    assert.equal(renderBacklog(log).length, 1);
    assert.match(renderPrerequisite(log, renderBacklog(log)[0]), /no recorded robots policy/);
  });

  test('a stale policy is a prerequisite, not an exemption', () => {
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: '2026-09-01T00:00:00Z', httpStatus: 200, disposition: 'rules',
      sha256: sha256(''), bytes: 0, body: '',
    });
    appendAttempt(log, recordFor());
    bindAll(log);
    assert.equal(renderBacklog(log).length, 1);
    assert.match(renderPrerequisite(log, renderBacklog(log)[0]), /more than 24 hours old/);
  });

  test('the backlog groups by URL, so one render answers every record naming that page', () => {
    const log = withPolicy(emptyLog());
    appendAttempt(log, recordFor({ category: 'account-registration' }));
    appendAttempt(log, recordFor({ category: 'service-application', examinedAt: '2026-09-26T19:20:00Z', navigatedAt: '2026-09-26T19:20:00Z' }));
    bindAll(log);
    const groups = renderBacklogByUrl(log);
    assert.equal(renderBacklog(log).length, 2);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].records.length, 2);
  });

  test('the backlog withholds the corpus draft', () => {
    const log = withPolicy(emptyLog());
    appendAttempt(log, recordFor());
    bindAll(log);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'render-backlog'));
  });
});

describe('a form without a <form> element is still a form', () => {
  // selection-v1.0.25. The extractor counted controls only inside `<form>`, and the NZSIS
  // reporting portal has none - it is a JavaScript application with bare inputs and a submit
  // button. So a page carrying First, Middle and Last name fields was summarised as having no
  // form, and the summary was written down instead of the DOM. Assuming classic markup is the same
  // mistake as assuming server-rendered markup, one level further in.
  const FORMLESS = `<!doctype html><html><head><title>Reporting a concern</title></head><body>
    <div class="question-label">First name</div><input id="q7" type="text" maxlength="100">
    <div class="question-label">Middle name</div><input id="q8" type="text" maxlength="100">
    <div class="question-label">Last name</div><input id="q9" type="text" maxlength="100">
    <textarea id="q1" maxlength="2001"></textarea>
    <input type="hidden" name="csrf" value="x">
    <button class="button">ENCRYPT AND SUBMIT</button>
    </body></html>`;

  let server;
  let origin;
  before(async () => {
    server = createServer((req, res) => {
      if (req.url === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('User-agent: *\nDisallow: /nothing\n');
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FORMLESS);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server?.closeAllConnections?.(); server?.close(); });

  test('the render counts controls across the document, not only inside <form>', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-render-'));
    const rendered = await renderDiscoveryPage({
      browserFactory: () => chromium.launch({ headless: true }),
      url: `${origin}/report`, outDir: dir, recordId: 'formless', settleMs: 50,
    });
    assert.equal(rendered.forms.length, 0, 'there genuinely is no <form> element');
    // The count that matters, and the one the first version got wrong.
    assert.equal(rendered.controls.length, 4, '3 text inputs and 1 textarea, hidden input excluded');
    assert.ok(rendered.buttons >= 1);
    assert.deepEqual(
      rendered.controls.map((c) => c.id).sort(),
      ['q1', 'q7', 'q8', 'q9']
    );
    assert.equal(rendered.controls.find((c) => c.id === 'q7').maxlength, '100');
    assert.equal(rendered.evidence, 'rendered-dom');
    assert.match(rendered.renderedSha256, /^[0-9a-f]{64}$/);
    assert.ok(existsSync(join(dir, 'formless.html')), 'the bytes are retained privately');
  });
});

describe('observation and judgement are separate records', () => {
  // selection-v1.0.25. `render-discovery` required `--outcome` before the page had been rendered,
  // and that is literally how d-0306 came to say `no-candidates` about a page carrying First,
  // Middle and Last name inputs: the judgement was typed first and the evidence read afterwards.
  const cli = new URL('../cli-capture.mjs', import.meta.url).pathname;
  const runCli = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  test('render-discovery REFUSES an outcome', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-ro-'));
    mkdirSync(join(dir, 'captures'), { recursive: true });
    writeFileSync(join(dir, 'capture-log.json'), JSON.stringify(emptyLog()));
    const r = runCli(['render-discovery', '--out', dir, '--agency', 'A', '--website', 'https://a.govt.nz/',
      '--url', 'https://a.govt.nz/x', '--category', 'service-application', '--set-version', '1',
      '--permit-id', 'p-0001', '--outcome', 'no-candidates']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--outcome cannot be given to render-discovery/);
    assert.match(r.stderr, /is what produced d-0306/);
  });

  const base = (over = {}) => ({
    examinedAt: '2026-09-26T19:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
    url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
    category: 'service-application', candidateSetVersion: 1, approval: 'approved', ...over,
  });

  test('an observation may conclude nothing', () => {
    const log = emptyLog();
    assert.throws(() => appendAttempt(log, base({
      recordType: 'observation', renderId: 'g-0001', permitId: 'p-0001',
      outcome: 'candidates-found', navigatedAt: '2026-09-26T19:00:00Z',
    })), /an observation records "candidates-found"/);
  });

  test('only an observation may record `rendered`', () => {
    const log = emptyLog();
    assert.throws(() => appendAttempt(log, base({
      outcome: 'rendered', navigatedAt: '2026-09-26T19:00:00Z',
    })), /only an observation may record the outcome `rendered`/);
  });

  test('a judgement must not claim a permit, and must say it navigated nothing', () => {
    const log = emptyLog();
    assert.throws(() => appendAttempt(log, base({
      recordType: 'judgement-only', renderId: 'g-0001', evidenceFromDiscoveryId: 'd-0001',
      outcome: 'no-candidates', permitId: 'p-0001', navigationPerformed: false,
      checkedAt: '2026-09-26T19:00:00Z',
    })), /must not name a permit/);
    assert.throws(() => appendAttempt(log, base({
      recordType: 'judgement-only', renderId: 'g-0001', evidenceFromDiscoveryId: 'd-0001',
      outcome: 'no-candidates', navigatedAt: '2026-09-26T19:00:00Z',
    })), /navigationPerformed: false/);
  });

  test('a judgement needs the evidence it rests on, by both names', () => {
    const log = emptyLog();
    for (const [missing, pattern] of [['renderId', /needs renderId/], ['evidenceFromDiscoveryId', /needs evidenceFromDiscoveryId/]]) {
      const rec = base({
        recordType: 'judgement-only', renderId: 'g-0001', evidenceFromDiscoveryId: 'd-0001',
        outcome: 'no-candidates', navigationPerformed: false, checkedAt: '2026-09-26T19:00:00Z',
      });
      delete rec[missing];
      assert.throws(() => appendAttempt(emptyLog(), rec), pattern, missing);
    }
  });

  test('a judgement may not record an attrition outcome', () => {
    assert.throws(() => appendAttempt(emptyLog(), base({
      recordType: 'judgement-only', renderId: 'g-0001', evidenceFromDiscoveryId: 'd-0001',
      outcome: 'retrieval-blocked', navigationPerformed: false, checkedAt: '2026-09-26T19:00:00Z',
    })), /a judgement records candidates-found or no-candidates/);
  });

  test('THE BYPASS: a modern permitless navigation record is flagged by the ledger', () => {
    // Permitless records were read as pre-permit legacy, so any new record could claim a
    // navigation with no authorisation simply by omitting permitId.
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    issueDiscoveryPermit(log, {
      agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/other', robotsCheckId: 'r-0001',
    });
    appendAttempt(log, base({ outcome: 'no-candidates', navigatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }));
    const problems = checkPermitLedger(log);
    assert.ok(problems.some((p) => /records a navigation at .* with no permit/.test(p)), problems.join('; '));
    assert.ok(problems.some((p) => /does not predate it/.test(p)));
  });
});

describe('one render answers several categories, and answering is not naming', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-multi-'));
    const renderedDir = join(dir, 'rendered');
    mkdirSync(renderedDir, { recursive: true });
    const html = '<html><body><input id="q7" type="text"></body></html>';
    writeFileSync(join(renderedDir, 'g1.html'), html);
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin: 'https://a.govt.nz', url: 'https://a.govt.nz/robots.txt',
      fetchedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256(''), bytes: 0, body: '',
    });
    const render = recordRender(log, {
      url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T19:00:00Z', permitId: 'p-0001',
      renderFile: 'g1.html', renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html),
      accessBarriers: [],
    });
    // selection-v1.0.26: a render needs the record that observed it, or `adoptedFrom`. A registry
    // entry nobody recorded is evidence from nowhere.
    appendAttempt(log, {
      recordType: 'observation', renderId: render.id, permitId: 'p-0001',
      examinedAt: '2026-09-26T18:59:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'rendered', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T18:59:00Z', approval: 'approved',
    });
    const observation = log.attempts.at(-1);
    return { dir, log, render, html, observation };
  };

  const plain = (log, category, at) => {
    appendAttempt(log, {
      examinedAt: at, agency: 'A', website: 'https://a.govt.nz/', url: 'https://a.govt.nz/apply',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'no-candidates',
      category, candidateSetVersion: 1, navigatedAt: at, approval: 'approved',
    });
    return log.attempts.at(-1);
  };
  const judge = (log, { render, category, outcome, answers, at }) => {
    appendAttempt(log, {
      recordType: 'judgement-only', renderId: render.id,
      evidenceFromDiscoveryId: log.attempts.find((a) => a.recordType === 'observation').id,
      ...(answers ? { rendersDiscoveryId: answers } : {}),
      examinedAt: at, agency: 'A', website: 'https://a.govt.nz/', url: render.url,
      status: 'discovery', discoveryKind: 'navigation', outcome, category, candidateSetVersion: 1,
      navigationPerformed: false, checkedAt: at, evidence: 'rendered-dom',
      renderFile: render.renderFile, renderedSha256: render.renderedSha256,
      renderedBytes: render.renderedBytes, approval: 'approved',
      // selection-v1.0.26: the EXACT record answered, by id.
      ...(answers ? { answersDiscoveryId: answers } : {}),
      supersedesDiscoveryId: answers,
    });
    return log.attempts.at(-1);
  };

  test('THE GAP: naming a record does not clear it; only a judgement for its category does', () => {
    // d-0301 left the backlog because the render NAMED it, while its own outcome stayed
    // `retrieval-inconclusive` and no account-registration judgement was ever made.
    const { dir, log } = setup();
    const ar = plain(log, 'account-registration', '2026-09-26T19:00:00Z');
    bindAll(log);
    assert.equal(renderBacklog(log).length, 1);

    // A record that merely mentions it, in another category, clears nothing.
    const { render } = { render: log.renders[0] };
    judge(log, { render, category: 'service-application', outcome: 'candidates-found', at: '2026-09-26T19:01:00Z' });
    assert.deepEqual(renderBacklog(log).map((a) => a.id), [ar.id],
      'the account-registration record is still unanswered');
    assert.equal(checkRenderLedger(log, join(dir, 'rendered')).length, 0);
  });

  test('one render supports a judgement per category, and each clears its own', () => {
    const { dir, log } = setup();
    const render = log.renders[0];
    const ar = plain(log, 'account-registration', '2026-09-26T19:00:00Z');
    const sa = plain(log, 'service-application', '2026-09-26T19:01:00Z');
    bindAll(log);
    assert.equal(renderBacklog(log).length, 2);
    assert.equal(renderBacklogByUrl(log).length, 1, 'one page, so one render answers both');

    judge(log, { render, category: 'account-registration', outcome: 'no-candidates', answers: ar.id, at: '2026-09-26T19:02:00Z' });
    assert.deepEqual(renderBacklog(log).map((a) => a.id), [sa.id]);

    judge(log, { render, category: 'service-application', outcome: 'candidates-found', answers: sa.id, at: '2026-09-26T19:03:00Z' });
    assert.deepEqual(renderBacklog(log), [], 'one render, two categories, both cleared');
    assert.equal(checkRenderLedger(log, join(dir, 'rendered')).length, 0);
  });

  test('the same page can be no-candidates for one category and candidates-found for another', () => {
    const { log } = setup();
    const render = log.renders[0];
    const a = judge(log, { render, category: 'account-registration', outcome: 'no-candidates', at: '2026-09-26T19:00:00Z' });
    const b = judge(log, { render, category: 'service-application', outcome: 'candidates-found', at: '2026-09-26T19:01:00Z' });
    assert.equal(a.outcome, 'no-candidates');
    assert.equal(b.outcome, 'candidates-found');
    assert.equal(a.renderId, b.renderId, 'both rest on the same observation');
  });
});

describe('rendered evidence is re-verified, not trusted', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-ev-'));
    const renderedDir = join(dir, 'rendered');
    mkdirSync(renderedDir, { recursive: true });
    mkdirSync(join(dir, 'captures'), { recursive: true });
    const html = '<html><body><input id="q7"></body></html>';
    writeFileSync(join(renderedDir, 'g1.html'), html);
    const log = emptyLog();
    const render = recordRender(log, {
      url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T19:00:00Z', permitId: 'p-0001',
      renderFile: 'g1.html', renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html),
      accessBarriers: [], adoptedFrom: 'd-0001',
    });
    return { dir, renderedDir, log, render, html };
  };

  test('an untouched render verifies', () => {
    const { dir, log, render } = setup();
    assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
    assert.deepEqual(assertRenderEvidenceUsable(log, { renderId: render.id, capturesRoot: dir }), []);
  });

  test('a tampered render file is caught, and blocks the gate and publication', () => {
    const { dir, renderedDir, log, render, html } = setup();
    writeFileSync(join(renderedDir, 'g1.html'), `${html}<!-- edited -->`);
    const problems = checkRenderLedger(log, renderedDir);
    assert.ok(problems.some((p) => /is not the evidence that was observed/.test(p)), problems.join('; '));
    assert.ok(problems.some((p) => /bytes, the log records/.test(p)), problems.join('; '));
    assert.ok(assertRenderEvidenceUsable(log, { renderId: render.id, capturesRoot: dir }).length > 0);
    assert.ok(corpusBlockers(log, { capturesRoot: dir }).some((b) => b.kind === 'render-evidence'));
    assert.throws(() => publishProvenance(log, { to: join(dir, 'out'), capturesRoot: dir }),
      /rendered evidence does not match the log and must not be published/);
  });

  test('a missing render file is caught', () => {
    const { dir, renderedDir, log } = setup();
    rmSync(join(renderedDir, 'g1.html'));
    assert.ok(checkRenderLedger(log, renderedDir).some((p) => /could not be read/.test(p)));
  });

  test('a record carrying a digest but no registry entry is checked too', () => {
    // d-0306 and d-0307 predate the registry and carry the file and digest on the record itself.
    const { dir, renderedDir, log, html } = setup();
    log.renders = [];
    appendAttempt(log, {
      examinedAt: '2026-09-26T19:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:00:00Z', approval: 'approved',
      evidence: 'rendered-dom', renderFile: 'g1.html', renderedSha256: sha256(html),
      renderedBytes: Buffer.byteLength(html),
    });
    assert.deepEqual(checkRenderLedger(log, renderedDir), []);
    writeFileSync(join(renderedDir, 'g1.html'), 'changed');
    assert.ok(checkRenderLedger(log, renderedDir).some((p) => /hashes to/.test(p)));
  });

  test('a judgement may not rest on a challenge document', () => {
    const { dir, log } = setup();
    log.renders[0].accessBarriers = ['cloudflare interstitial'];
    assert.ok(assertRenderEvidenceUsable(log, { renderId: 'g-0001', capturesRoot: dir })
      .some((p) => /cannot rest on a challenge document/.test(p)));
  });

  test('FAIL-CLOSED: renders present and no capture root is a blocker, not a pass', () => {
    const { log } = setup();
    const blocker = corpusBlockers(log).find((b) => b.kind === 'render-evidence');
    assert.ok(blocker, '"could not check" must not read as "checked and fine"');
    assert.match(blocker.summary, /could not be verified/);
  });

  test('a citation to a render of a different page is refused', () => {
    const { dir, log, render } = setup();
    appendAttempt(log, {
      recordType: 'judgement-only', renderId: render.id, evidenceFromDiscoveryId: 'd-0001',
      examinedAt: '2026-09-26T19:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/elsewhere', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigationPerformed: false, checkedAt: '2026-09-26T19:00:00Z', approval: 'approved',
    });
    assert.ok(checkRenderLedger(log, join(dir, 'rendered'))
      .some((p) => /must rest on evidence of the page it judges/.test(p)));
  });

  test('adopting a render verifies the bytes first', () => {
    const { dir, renderedDir, log, html } = setup();
    log.renders = [];
    appendAttempt(log, {
      examinedAt: '2026-09-26T19:00:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'no-candidates', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:00:00Z', approval: 'approved',
      evidence: 'rendered-dom', renderFile: 'g1.html', renderedSha256: sha256(html),
      renderedBytes: Buffer.byteLength(html),
    });
    const id = log.attempts.at(-1).id;
    // A shorter file trips the length check; a same-length edit trips the digest. Both must refuse.
    writeFileSync(join(renderedDir, 'g1.html'), 'tampered');
    assert.throws(() => adoptRender(log, { fromAttemptId: id, capturesRoot: dir }), /is 8 bytes, but/);
    writeFileSync(join(renderedDir, 'g1.html'), html.replace('q7', 'q8'));
    assert.throws(() => adoptRender(log, { fromAttemptId: id, capturesRoot: dir }), /hashes to/);
    writeFileSync(join(renderedDir, 'g1.html'), html);
    const adopted = adoptRender(log, { fromAttemptId: id, capturesRoot: dir });
    assert.equal(adopted.adoptedFrom, id);
    assert.throws(() => adoptRender(log, { fromAttemptId: id, capturesRoot: dir }), /already registered/);
  });
});

describe('the backlog counts only what a current set stands on', () => {
  // selection-v1.0.26. Thirty-four of ninety-eight backlog records belonged to SUPERSEDED candidate
  // sets - rounds rejected and redone, whose evidence the corpus no longer rests on. The obligation
  // was overstated by a third, and would have sent the scan back to re-render withdrawn findings.
  const build = () => {
    const log = withPolicyFor(emptyLog(), 'https://a.govt.nz');
    let n = 0;
    const record = (category) => {
      const at = `2026-09-26T19:${String(n++).padStart(2, '0')}:00Z`;
      appendAttempt(log, {
        examinedAt: at, agency: 'A', website: 'https://a.govt.nz/',
        url: `https://a.govt.nz/${category}-${n}`, status: 'discovery', discoveryKind: 'navigation',
        outcome: 'no-candidates', category, candidateSetVersion: 1, navigatedAt: at,
        approval: 'approved',
      });
      return log.attempts.at(-1);
    };
    return { log, record };
  };

  test('a record bound only to a superseded set is not in the backlog', () => {
    const { log, record } = build();
    const kept = record('account-registration');
    const withdrawn = record('service-application');
    log.candidateSets[`A\u0000account-registration`] = {
      agency: 'A', category: 'account-registration', version: 1, discovered: [], locked: [],
      lockedAt: '2026-09-26T20:00:00Z', approval: 'approved', candidateDeclaration: 'none',
      discoveryRecordIds: [kept.id],
    };
    log.supersededCandidateSets = [{
      agency: 'A', category: 'service-application', version: 1,
      discoveryRecordIds: [withdrawn.id], supersededAt: '2026-09-26T20:00:00Z',
      supersededReason: 'incomplete provenance',
    }];
    assert.deepEqual(renderBacklog(log).map((a) => a.id), [kept.id]);
  });

  test('a record bound to no set at all is not in the backlog either', () => {
    // It supports nothing, so re-rendering it would buy nothing.
    const { log, record } = build();
    record('account-registration');
    assert.deepEqual(renderBacklog(log), []);
  });
});

describe('an approved set may not rest on withdrawn evidence', () => {
  // selection-v1.0.26. The approved NZSIS account-registration set still bound d-0301 after d-0308
  // superseded it, and the gate said nothing: `supportingRecords` checks that bound ids EXIST, and a
  // superseded record still exists.
  const build = () => {
    const log = withPolicyFor(emptyLog(), 'https://a.govt.nz');
    const at = '2026-09-26T19:00:00Z';
    appendAttempt(log, {
      examinedAt: at, agency: 'A', website: 'https://a.govt.nz/', url: 'https://a.govt.nz/apply',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'candidates-found',
      category: 'service-application', candidateSetVersion: 1, navigatedAt: at, approval: 'approved',
    });
    const original = log.attempts.at(-1);
    recordCandidates(log, { agency: 'A', category: 'service-application', urls: ['https://a.govt.nz/f'] });
    lockCandidateSet(log, { agency: 'A', category: 'service-application' });
    approveSet(log, { agency: 'A', category: 'service-application', approved: true });
    return { log, original };
  };

  const supersedeWith = (log, original, outcome = 'candidates-found') => {
    appendAttempt(log, {
      supersedesDiscoveryId: original.id,
      examinedAt: '2026-09-26T19:05:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome, category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:05:00Z', approval: 'approved',
    });
    return log.attempts.at(-1);
  };

  test('THE GAP: a stale binding is reported, and withholds the draft', () => {
    const { log, original } = build();
    assert.deepEqual(staleSetBindings(log), []);
    const replacement = supersedeWith(log, original);
    const stale = staleSetBindings(log);
    assert.equal(stale.length, 1);
    assert.deepEqual(stale[0].stale, [{ id: original.id, replacedBy: replacement.id }]);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'stale-set-bindings'));
  });

  test('re-binding substitutes the replacement, archives the old binding, and un-approves', () => {
    const { log, original } = build();
    const replacement = supersedeWith(log, original);
    const { set, substitutions } = reResolveCandidateSet(log, {
      agency: 'A', category: 'service-application', reason: 'the bound record was superseded',
    });
    assert.deepEqual(substitutions, [{ from: original.id, to: replacement.id }]);
    assert.deepEqual(set.discoveryRecordIds, [replacement.id]);
    assert.equal(set.approval, 'pending', 'an approval is a judgement about particular records');
    assert.equal(set.approvedAt, null);
    assert.equal(set.bindingHistory.length, 1);
    assert.deepEqual(set.bindingHistory[0].discoveryRecordIds, [original.id]);
    assert.equal(set.bindingHistory[0].approval, 'approved', 'the withdrawn approval is on the record');
    assert.match(set.bindingHistory[0].reason, /superseded/);
    assert.ok(set.bindingHistory[0].reboundAt);
    assert.deepEqual(staleSetBindings(log), []);
  });

  test('it follows a chain of corrections to the end', () => {
    const { log, original } = build();
    const first = supersedeWith(log, original);
    appendAttempt(log, {
      supersedesDiscoveryId: first.id,
      examinedAt: '2026-09-26T19:10:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'candidates-found', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:10:00Z', approval: 'approved',
    });
    const last = log.attempts.at(-1);
    const { set } = reResolveCandidateSet(log, { agency: 'A', category: 'service-application', reason: 'chain' });
    assert.deepEqual(set.discoveryRecordIds, [last.id], 'the end of the chain, not the first link');
  });

  test('re-binding refuses a set with nothing stale, and requires a reason', () => {
    const { log } = build();
    assert.throws(() => reResolveCandidateSet(log, { agency: 'A', category: 'service-application', reason: 'x' }),
      /binds no superseded record/);
    assert.throws(() => reResolveCandidateSet(log, { agency: 'A', category: 'service-application', reason: ' ' }),
      /requires a reason/);
  });

  test('a re-binding that would still hold a superseded record is refused', () => {
    // The replacement itself withdrawn, with nothing after it: there is no clean binding to make.
    const { log, original } = build();
    const replacement = supersedeWith(log, original);
    const set = log.candidateSets['A\u0000service-application'];
    set.discoveryRecordIds = [original.id, replacement.id];
    appendAttempt(log, {
      supersedesDiscoveryId: replacement.id,
      examinedAt: '2026-09-26T19:20:00Z', agency: 'A', website: 'https://a.govt.nz/',
      url: 'https://a.govt.nz/apply', status: 'discovery', discoveryKind: 'navigation',
      outcome: 'candidates-found', category: 'service-application', candidateSetVersion: 1,
      navigatedAt: '2026-09-26T19:20:00Z', approval: 'approved',
    });
    const { set: rebound } = reResolveCandidateSet(log, { agency: 'A', category: 'service-application', reason: 'x' });
    assert.equal(rebound.discoveryRecordIds.length, 1, 'both links resolve to one end record');
    assert.deepEqual(staleSetBindings(log), []);
  });
});

describe('rendered evidence must stay inside rendered/', () => {
  // selection-v1.0.26. Both implementations joined the file name straight onto the directory, so a
  // name of `../captures/health-govt-nz-feedback.html` read a corpus capture and verified happily
  // against its own digest. Confinement broken by a string.
  const setup = (renderFile) => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-esc-'));
    const renderedDir = join(dir, 'rendered');
    mkdirSync(renderedDir, { recursive: true });
    mkdirSync(join(dir, 'captures'), { recursive: true });
    const html = '<html><body><input id="q7"></body></html>';
    writeFileSync(join(renderedDir, 'g1.html'), html);
    writeFileSync(join(dir, 'captures', 'stolen.html'), html);
    const log = emptyLog();
    recordRender(log, {
      url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T19:00:00Z', permitId: 'p-0001',
      renderFile, renderedSha256: sha256(html), renderedBytes: Buffer.byteLength(html),
      accessBarriers: [], adoptedFrom: 'd-0001',
    });
    return { dir, renderedDir, log };
  };

  for (const escape of ['../captures/stolen.html', '../../etc/hosts', '/etc/hosts', 'sub/g1.html']) {
    test(`refuses ${escape}`, () => {
      const { renderedDir, log } = setup(escape);
      const problems = checkRenderLedger(log, renderedDir);
      assert.ok(
        problems.some((p) => /resolves outside rendered\/|is not a plain file name/.test(p)),
        `${escape} was not refused: ${problems.join('; ')}`
      );
    });
  }

  test('the escape would otherwise have verified against its own digest', () => {
    // Which is why a digest check alone does not confine anything: the stolen file hashes correctly.
    const { dir, renderedDir, log } = setup('../captures/stolen.html');
    const problems = checkRenderLedger(log, renderedDir);
    assert.equal(problems.filter((p) => /does not match|hashes to/.test(p)).length, 0,
      'the bytes matched; only confinement catches this');
    assert.ok(problems.length > 0);
  });

  test('a plain name inside rendered/ is accepted', () => {
    const { renderedDir, log } = setup('g1.html');
    assert.deepEqual(checkRenderLedger(log, renderedDir), []);
  });
});

describe('the permit is checked against the page it authorises', () => {
  const build = ({ body = '', origin = 'https://a.govt.nz', minutesAgo = 1 } = {}) => {
    const log = emptyLog();
    recordRobotsCheck(log, {
      origin, url: `${origin}/robots.txt`,
      fetchedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      httpStatus: 200, disposition: 'rules', sha256: sha256(body), bytes: body.length, body,
    });
    const permit = issueDiscoveryPermit(log, {
      agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: `${origin}/apply`, robotsCheckId: 'r-0001',
    });
    return { log, permit, origin };
  };
  const usable = (log, permit, over = {}) => assertPermitUsable(log, {
    agency: 'A', category: 'service-application', candidateSetVersion: 1,
    url: 'https://a.govt.nz/apply', permitId: permit.id, ...over,
  });

  test('a usable permit passes', () => {
    const { log, permit } = build();
    assert.doesNotThrow(() => usable(log, permit));
  });

  test('a policy that now disallows the exact path is refused', () => {
    // The check verified only that a policy existed and was fresh. A path disallowed by a policy
    // re-read since would still have been fetched.
    const { log, permit } = build({ body: 'User-agent: *\nDisallow: /apply\n' });
    assert.throws(() => usable(log, permit), /does not permit \/apply/);
  });

  test('a policy for another origin is refused', () => {
    const { log, permit } = build();
    log.robotsChecks[0].origin = 'https://elsewhere.govt.nz';
    assert.throws(() => usable(log, permit), /rests on the robots policy for https:\/\/elsewhere\.govt\.nz/);
  });

  test('a permit stamped in the future is refused', () => {
    const { log, permit } = build();
    permit.issuedAt = new Date(Date.now() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.throws(() => usable(log, permit), /which is in the future/);
  });

  test('a robots check stamped in the future is refused', () => {
    const { log, permit } = build();
    log.robotsChecks[0].fetchedAt = new Date(Date.now() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.throws(() => usable(log, permit), /which is in the future/);
  });

  test('a stale policy and an expired permit are both refused', () => {
    const { log, permit } = build({ minutesAgo: 60 * 30 });
    assert.throws(() => usable(log, permit), /more than 24 hours ago/);
    const fresh = build();
    fresh.permit.issuedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.throws(() => usable(fresh.log, fresh.permit), /has expired/);
  });
});
