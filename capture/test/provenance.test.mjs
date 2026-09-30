/**
 * Discovery provenance: rounds, methods, outcomes, and the binding between a candidate set
 * and the inspections that produced it.
 *
 * Every test here comes from a defect found after the previous tag, which is the reason it
 * exists: fixes were shipped ahead of the tests that would have held them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyLog, appendAttempt, recordCandidates, lockCandidateSet, approveCandidateSet,
  supersedeCandidateSet, publishProvenance, ELIGIBILITY_CRITERIA, APPROVAL,
} from '../run.mjs';
import { DISCOVERY_METHODS, DISCOVERY_OUTCOMES } from '../selection.mjs';
import { prepareSet } from './helpers.mjs';

const AGENCY = 'Te Puni Kōkiri';
const CAT = 'account-registration';

const discovery = (url, { method = 'navigation', outcome = 'no-candidates', version = 1, at, note } = {}) => ({
  examinedAt: at, agency: AGENCY, website: 'https://w.govt.nz/', url,
  status: 'discovery', discoveryKind: method, outcome, category: CAT,
  candidateSetVersion: version, navigatedAt: at, ...(note ? { note } : {}),
});

/** Timestamps spaced beyond the politeness minimum. */
const clock = (() => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 8, 24, 0, n++ * 2)).toISOString().replace(/\.\d{3}Z$/, 'Z');
})();

describe('a discovery record identifies its round', () => {
  test('category, set version, method and outcome are all required', () => {
    const log = emptyLog();
    const base = discovery('https://w.govt.nz/a', { at: clock() });
    for (const missing of ['category', 'candidateSetVersion', 'outcome', 'discoveryKind']) {
      const bad = { ...base };
      delete bad[missing];
      assert.throws(() => appendAttempt(emptyLog(), bad), new RegExp(missing === 'discoveryKind' ? 'method' : missing));
    }
    assert.doesNotThrow(() => appendAttempt(log, base));
  });

  test('robots is its own method, not a sitemap', () => {
    // Earlier rounds filed a robots.txt fetch under `sitemap`, which made the published
    // method counts describe inspections that never happened.
    assert.ok(DISCOVERY_METHODS.includes('robots'));
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/robots.txt', { method: 'robots', outcome: 'disallowed', at: clock() }));
    assert.equal(log.attempts[0].discoveryKind, 'robots');
  });

  test('an outcome distinguishes a method that was unavailable from one that found nothing', () => {
    // selection-v1.0.21 added the last three. `no-candidates` says a page was read and held
    // nothing; saying that of a page nobody could read would turn a failure of the method into a
    // fact about the agency, and the denominator would count it as searched.
    assert.deepEqual([...DISCOVERY_OUTCOMES], [
      'candidates-found', 'no-candidates', 'unavailable', 'disallowed',
      'robots-unestablished', 'retrieval-blocked', 'retrieval-inconclusive',
      // selection-v1.0.25: an observation, not a judgement. It exists because requiring an outcome
      // before the page was rendered is how a page with three name fields got `no-candidates`.
      'rendered',
    ]);
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/s1', { outcome: 'unavailable', at: clock(), note: 'no search form' }));
    appendAttempt(log, discovery('https://w.govt.nz/s2', { outcome: 'no-candidates', at: clock() }));
    assert.equal(log.attempts[0].outcome, 'unavailable');
    assert.equal(log.attempts[0].note, 'no search form');
    assert.equal(log.attempts[1].outcome, 'no-candidates');
  });

  test('every attempt gets a stable id', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', { at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/b', { at: clock() }));
    assert.match(log.attempts[0].id, /^d-\d{4}$/);
    assert.notEqual(log.attempts[0].id, log.attempts[1].id);
  });

  test('a later round may re-inspect the same page', () => {
    // Refusing this is what made an independently identifiable second round impossible:
    // the new round could only ever be additions to the first.
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', { version: 1, at: clock() }));
    assert.throws(() => appendAttempt(log, discovery('https://w.govt.nz/a', { version: 1, at: clock() })), /already recorded/);
    assert.doesNotThrow(() => appendAttempt(log, discovery('https://w.govt.nz/a', { version: 2, at: clock() })));
  });
});

describe('a locked set is bound to the round that produced it', () => {
  test('a set cannot be locked without supporting discovery records', () => {
    const log = emptyLog();
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    assert.throws(() => lockCandidateSet(log, { agency: AGENCY, category: CAT }), /no discovery records/);
  });

  test('locking records exactly which inspections support it', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/nav', { method: 'navigation', outcome: 'candidates-found', at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/robots.txt', { method: 'robots', outcome: 'no-candidates', at: clock() }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    const set = lockCandidateSet(log, { agency: AGENCY, category: CAT });
    assert.deepEqual(set.discoveryRecordIds, ['d-0001', 'd-0002']);
    assert.deepEqual(set.discoveryMethods, ['navigation', 'robots']);
  });

  test('a set is bound only to its own round, not to an earlier one', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/round1', { version: 1, at: clock(), outcome: 'candidates-found' }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    approveCandidateSet(log, { agency: AGENCY, category: CAT, approved: false });
    supersedeCandidateSet(log, { agency: AGENCY, category: CAT, reason: 'incomplete provenance' });

    appendAttempt(log, discovery('https://w.govt.nz/round2', { version: 2, at: clock(), outcome: 'candidates-found' }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/y'] });
    const v2 = lockCandidateSet(log, { agency: AGENCY, category: CAT });
    assert.equal(v2.version, 2);
    assert.deepEqual(v2.discoveryRecordIds, ['d-0002'], 'only the second round supports the second set');
  });
});

describe('legacy records migrate rather than crash', () => {
  test('a set with no version archives with one derived from history', () => {
    // A set created before versioning existed archived as "version undefined".
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', { at: clock(), outcome: 'candidates-found' }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    approveCandidateSet(log, { agency: AGENCY, category: CAT, approved: false });
    delete log.candidateSets[`${AGENCY}\u0000${CAT}`].version;
    const archived = supersedeCandidateSet(log, { agency: AGENCY, category: CAT, reason: 'legacy' });
    assert.equal(archived.version, 1, 'a missing version is derived, never left undefined');
  });
});

describe('the published counts describe what happened', () => {
  test('methods, outcomes, rounds and pending sets are all counted', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/robots.txt', { method: 'robots', outcome: 'disallowed', at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/sitemap.xml', { method: 'sitemap', outcome: 'unavailable', at: clock() }));
    appendAttempt(log, discovery('https://w.govt.nz/nav', { method: 'navigation', outcome: 'candidates-found', at: clock() }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });

    const dir = mkdtempSync(join(tmpdir(), 'formfair-prov-'));
    try {
      const { provenancePath } = publishProvenance(log, { to: dir });
      const p = JSON.parse(readFileSync(provenancePath, 'utf8'));
      assert.deepEqual(p.discoveryByMethod, { robots: 1, sitemap: 1, navigation: 1 });
      assert.deepEqual(p.discoveryByOutcome, { disallowed: 1, unavailable: 1, 'candidates-found': 1 });
      assert.equal(p.discoveryByRound[`${AGENCY} / ${CAT} v1`], 3);
      // A pending candidate SET is what blocks the work, and it was not counted at all.
      assert.equal(p.counts.pendingApprovalCandidateSets, 1);
      assert.deepEqual(p.candidateSets[0].supportedByDiscoveryRecords, ['d-0001', 'd-0002', 'd-0003']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Amendment 38: what the tracked audit must expose, and what it must never carry.
 *
 * The omission became visible only after the third corpus page was approved. `c-0441`'s
 * inclusion evidence flagged a category question for review; the approval note that resolved it
 * lived in the ignored log, so the published ledger carried the doubt and not its answer. The
 * robots observation that authorised the request was reachable only as prose inside that same
 * evidence text.
 */
describe('the publication carries the approval reasoning and the permissions it rests on', () => {
  const capture = (at, { approvalNote = null, approvedAt = null, approval = APPROVAL.APPROVED } = {}) => ({
    examinedAt: at, agency: AGENCY, website: 'https://w.govt.nz/', url: 'https://w.govt.nz/form',
    finalUrl: 'https://w.govt.nz/form', status: 'captured', category: CAT,
    pageId: 'w-govt-nz-form', htmlSha256: 'a'.repeat(64), file: 'w-govt-nz-form.html',
    inclusionEvidence: 'a name field is visible without submitting',
    eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, true])),
    approval, ...(approvedAt ? { approvedAt } : {}), ...(approvalNote ? { approvalNote } : {}),
  });

  /** A capture may only be recorded against an approved, locked set holding its URL. */
  const withSet = () => {
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, ['https://w.govt.nz/form']);
    return log;
  };

  const publish = (log) => {
    const dir = mkdtempSync(join(tmpdir(), 'formfair-a38-'));
    try {
      const { provenancePath, ledgerPath } = publishProvenance(log, { to: dir });
      return {
        p: JSON.parse(readFileSync(provenancePath, 'utf8')),
        csv: readFileSync(ledgerPath, 'utf8'),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('an approved capture publishes its approval time and its full resolution', () => {
    // The `c-0441` case: the note is the only place the category question is answered.
    const note =
      'Approved in the frozen service-application category. Amendment 29, frozen as ' +
      'solo-protocol-v1.0.6 before capture, explicitly classified this page as a ' +
      'service-application candidate.';
    const log = withSet();
    appendAttempt(log, capture(clock(), { approvalNote: note, approvedAt: '2026-09-29T04:15:34Z' }));
    const { csv } = publish(log);

    // Positions, not tail offsets: Amendment 42 appended the evidence-provenance columns after
    // these, and a test that assumes it is last breaks every time the schema grows.
    const header = csv.split('\n')[0].split(',');
    for (const column of ['approval', 'approvedAt', 'approvalNote']) {
      assert.ok(header.includes(column), `${column} is not a ledger column`);
    }
    assert.equal(header.indexOf('approvedAt'), header.indexOf('approval') + 1);
    assert.equal(header.indexOf('approvalNote'), header.indexOf('approvedAt') + 1);
    assert.ok(csv.includes('2026-09-29T04:15:34Z'), 'the approval time is not published');
    // The WHOLE note, not a truncation: a resolution cut off mid-sentence is not a resolution.
    assert.ok(csv.includes(note), 'the approval note is not published in full');
  });

  test('a row with no approval note still has both columns, so the shape never shifts', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/a', { at: clock() }));
    const { csv } = publish(log);
    const [header, row] = csv.trim().split('\n');
    assert.equal(row.split(',').length, header.split(',').length);
    // The approval columns are empty for a discovery record; located by name, since later
    // amendments append further columns after them.
    const cols = header.split(',');
    const fields = row.split(',');
    for (const column of ['approvedAt', 'approvalNote']) {
      assert.equal(fields[cols.indexOf(column)], '', `${column} is not an empty field here`);
    }
  });

  test('a robots check is published as a referenceable observation', () => {
    // The `r-0029` case: a 404 that permits access under RFC 9309 section 2.3.1.3.
    const log = emptyLog();
    log.robotsChecks = [{
      id: 'r-0029', origin: 'https://providinginformation.nzsis.govt.nz',
      url: 'https://providinginformation.nzsis.govt.nz/robots.txt',
      fetchedAt: '2026-09-29T04:00:04Z', httpStatus: 404, disposition: 'allow-all',
      contentType: null, bytes: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      body: '', representation: null,
    }];
    const { p } = publish(log);
    const check = p.robotsChecks.find((c) => c.id === 'r-0029');
    assert.ok(check, 'r-0029 is not published');
    assert.equal(check.httpStatus, 404);
    assert.equal(check.disposition, 'allow-all');
    assert.equal(check.bytes, 0);
    assert.equal(check.fetchedAt, '2026-09-29T04:00:04Z');
    assert.equal(check.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.ok(!('body' in check), 'the response body must not be published');
  });

  test('a robots body is never published, including the copy inside a valid representation', () => {
    // `classifyRepresentation` returns the decoded body as `text` for a valid robots file, so a
    // spread of the representation would publish the document a second time under another name.
    const log = emptyLog();
    log.robotsChecks = [
      {
        id: 'r-0001', origin: 'https://w.govt.nz', url: 'https://w.govt.nz/robots.txt',
        fetchedAt: '2026-09-29T04:00:04Z', httpStatus: 200, disposition: 'rules',
        contentType: 'text/plain', bytes: 42, sha256: 'b'.repeat(64),
        body: 'User-agent: *\nDisallow: /secret-programme\n',
        representation: {
          valid: true, reason: 'a UTF-8 text/plain robots file', mediaType: 'text/plain',
          charset: null, challenge: null,
          text: 'User-agent: *\nDisallow: /secret-programme\n',
        },
      },
      {
        id: 'r-0002', origin: 'https://x.govt.nz', url: 'https://x.govt.nz/robots.txt',
        fetchedAt: '2026-09-29T04:02:04Z', httpStatus: 200, disposition: 'unestablished',
        contentType: 'text/html', bytes: 28754, sha256: 'c'.repeat(64),
        body: '<html><title>Just a moment...</title></html>',
        representation: {
          valid: false, reason: 'the media type was text/html, not text/plain',
          mediaType: 'text/html', charset: null, challenge: 'Imperva/Incapsula', text: null,
        },
      },
    ];
    const { p, csv } = publish(log);
    const serialised = JSON.stringify(p);

    // Sentinels chosen to appear ONLY in the bodies above. The phrase "Just a moment" occurs
    // legitimately elsewhere in the real publication - two permit-closure reasons describe a page
    // whose only render was a Cloudflare interstitial - so this is a claim about what a robots
    // check publishes, not a ban on the words appearing in prose anywhere.
    assert.ok(!serialised.includes('secret-programme'), 'the robots body leaked into provenance');
    assert.ok(!serialised.includes('Just a moment'), 'a challenge document leaked into provenance');
    assert.ok(!serialised.includes('<html'), 'markup leaked into provenance');
    for (const check of p.robotsChecks) {
      assert.ok(!('body' in check), `${check.id} published a body`);
      if (check.representation) {
        assert.ok(!('text' in check.representation), `${check.id} published representation text`);
      }
    }
    // The classification itself is still there - the point is to publish the verdict, not the bytes.
    assert.equal(p.robotsChecks[1].representation.challenge, 'Imperva/Incapsula');
    assert.equal(p.robotsChecks[0].representation.valid, true);
    assert.ok(!csv.includes('secret-programme'), 'the robots body leaked into the ledger');
  });

  test('a note containing commas, quotes and newlines survives as one field', () => {
    // The approval note is free prose and now sits in the CSV, so quoting is load-bearing.
    const note = 'Approved: "service-application", per Amendment 29.\nNot enquiry-or-contact.';
    const log = withSet();
    appendAttempt(log, capture(clock(), { approvalNote: note, approvedAt: '2026-09-29T04:15:34Z' }));
    const { csv } = publish(log);

    assert.ok(csv.includes('"Approved: ""service-application"", per Amendment 29.'));
    // One record per attempt, however many newlines the note contains: the row count must not
    // follow the prose. The note's second line must stay inside its quoted field rather than
    // starting a record of its own.
    const body = csv.slice(csv.indexOf('\n') + 1);
    const recordStarts = body.split('\n').filter((l) => /^2026-\d\d-\d\dT/.test(l));
    assert.equal(recordStarts.length, log.attempts.length);
    // The continuation line closes the quoted field and then carries the remaining columns, so it
    // STARTS with the closing quote rather than ending the row there.
    assert.ok(
      body.split('\n').some((l) => l.startsWith('Not enquiry-or-contact."')),
      'the embedded newline did not stay inside the quoted field'
    );
  });

  test('an active candidate set publishes its approval note, as a superseded one always did', () => {
    const log = emptyLog();
    appendAttempt(log, discovery('https://w.govt.nz/nav', { outcome: 'candidates-found', at: clock() }));
    recordCandidates(log, { agency: AGENCY, category: CAT, urls: ['https://w.govt.nz/x'] });
    lockCandidateSet(log, { agency: AGENCY, category: CAT });
    approveCandidateSet(log, {
      agency: AGENCY, category: CAT, approved: true,
      note: 'One candidate; approving means this URL is what should be assessed, not that it is eligible.',
    });
    const { p } = publish(log);
    assert.match(p.candidateSets[0].approvalNote, /not that it is eligible/);
  });

  test('captured markup is still absent from both published files', () => {
    // Document markup, not tag NAMES. Evidence notes legitimately discuss markup in prose - both
    // `d-0307` and `c-0441` explain that the extractor miscounted because the controls "are not
    // inside any <form> element" - and the real published ledger contains exactly that. A test
    // forbidding the substring `<form` would fail on correct data, which is a false guarantee:
    // what must never appear is a third-party document, so this looks for what prose cannot
    // produce - a doctype, a root element, a closing structural tag, or a tag with attributes.
    const log = withSet();
    appendAttempt(log, capture(clock(), {
      approvalNote: 'approved; the controls are not inside any <form> element',
      approvedAt: '2026-09-29T04:15:34Z',
    }));
    const { p, csv } = publish(log);
    const documentMarkup = [
      /<!doctype/i, /<html[\s>]/i, /<\/(html|body|form|head)>/i,
      /<(div|input|form|span|a|script|textarea|select)\s+[a-z-]+\s*=/i,
    ];
    for (const [label, text] of [['provenance', JSON.stringify(p)], ['ledger', csv]]) {
      for (const pattern of documentMarkup) {
        assert.ok(!pattern.test(text), `${label} contains document markup matching ${pattern}`);
      }
    }
    // The prose mention survives, so the guard is not simply stripping angle brackets.
    assert.ok(csv.includes('<form> element'));
  });
});
