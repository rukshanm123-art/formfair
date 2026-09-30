/**
 * Amendment 42: free text may not restate what the structured fields carry.
 *
 * `c-0576` was ready to approve with a fabricated digest. Its reason read "sha256 0e7b3cb3ee1b"
 * while the file hashed to `fa4c2f68…` at 106,370 bytes. The record's own `htmlSha256` was correct
 * and the Amendment 41 citation check had verified it against the retrieval `c-0575` - the invented
 * string lived in the free-text reason, where nothing checks anything.
 *
 * Every gate in this package compares fields to fields, so none could have caught it. It was found
 * by reading the prose against the file. The fix removes prose as a second source of truth rather
 * than adding a sixth gate that compares prose to fields.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  restatedEvidenceProblems, emptyLog, appendAttempt, deriveLedger, ELIGIBILITY_CRITERIA, APPROVAL,
} from '../run.mjs';
import { prepareSet } from './helpers.mjs';

const AGENCY = 'New Zealand Defence Force';
const CAT = 'service-application';
const URL_ = 'https://w.govt.nz/apply';
const DIGEST = 'fa4c2f68287726c6b3669a6d0e7b3cb3ee1bfa4c2f68287726c6b3669a6d0e7b';

describe('a digest is never restated in free text', () => {
  test('the exact c-0576 shape is refused', () => {
    const problems = restatedEvidenceProblems({
      exclusionReason: 'Excluded from c-0575: 106370 bytes, sha256 0e7b3cb3ee1b, title "Apply".',
      htmlBytes: 106370,
    });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /digest-shaped token "0e7b3cb3ee1b"/);
    assert.match(problems[0], /cite the evidence record by id/);
    assert.match(problems[1], /states 106370 bytes while this record carries htmlBytes=106370/);
  });

  test('a CORRECT digest is refused too, because the point is one source of truth', () => {
    // The fabricated one and the accurate one are equally unwanted: prose that happens to agree
    // today is prose that can disagree tomorrow.
    const problems = restatedEvidenceProblems({ exclusionReason: `sha256 ${DIGEST.slice(0, 16)}` });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Do not restate a digest/);
  });

  test('every free-text field is covered, not just the exclusion reason', () => {
    for (const field of ['exclusionReason', 'inclusionEvidence', 'note', 'approvalNote']) {
      const problems = restatedEvidenceProblems({ [field]: `digest ${DIGEST.slice(0, 12)}` });
      assert.equal(problems.length, 1, `${field} was not checked`);
      assert.match(problems[0], new RegExp(`^${field} `));
    }
  });

  test('a note that cites the record instead is accepted', () => {
    assert.deepEqual(restatedEvidenceProblems({
      exclusionReason: 'Excluded from the retrieval c-0575: its only form is the site search.',
      htmlBytes: 106370,
    }), []);
  });

  test('a byte count describing another artefact is still allowed', () => {
    // The Imperva challenge served in place of a robots file is not this record's evidence, and
    // saying how big it was remains legitimate prose.
    assert.deepEqual(restatedEvidenceProblems({
      note: 'robots.txt returned a 212-byte text/html Imperva challenge document',
    }), []);
  });

  test('a byte count is only refused when the record carries the length itself', () => {
    assert.deepEqual(restatedEvidenceProblems({ note: 'a 69389 byte response' }), []);
    assert.equal(restatedEvidenceProblems({ note: 'a 69389 byte response', htmlBytes: 69389 }).length, 1);
  });

  test('short hex that is not digest-shaped is left alone', () => {
    // Ids, dates and small hex runs must not trip it.
    for (const text of ['c-0575', 'd-0492', 'g-0116', '2026-09-30', 'HTTP 403', 'abc123']) {
      assert.deepEqual(restatedEvidenceProblems({ note: text }), [], `${text} was refused`);
    }
  });
});

describe('the guard runs at write time', () => {
  const withSet = () => {
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, [URL_]);
    return log;
  };
  const exclusion = (reason) => ({
    agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url: URL_,
    status: 'excluded', exclusionReason: reason, approval: APPROVAL.PENDING,
    eligibility: { ...Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
      asksForTheNameOfANaturalPerson: false },
  });

  test('appendAttempt refuses a record whose prose restates a digest', () => {
    assert.throws(
      () => appendAttempt(withSet(), exclusion(`no name field; sha256 ${DIGEST.slice(0, 14)}`)),
      /Do not restate a digest in free text/
    );
  });

  test('and accepts the same record once it cites the evidence instead', () => {
    const log = withSet();
    appendAttempt(log, exclusion('no name field; judged from the retrieval cited on this record'));
    assert.equal(log.attempts.at(-1).status, 'excluded');
  });
});

describe('the ledger renders the provenance the prose no longer carries', () => {
  test('digest, length and every evidence link are columns', () => {
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, [URL_]);
    appendAttempt(log, {
      agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url: URL_,
      status: 'retrieved', approval: APPROVAL.NOT_APPLICABLE,
      pageId: 'w-govt-nz-apply', file: 'w-govt-nz-apply.html',
      htmlSha256: DIGEST, htmlBytes: 106370,
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    });
    const retrieval = log.attempts.at(-1).id;
    appendAttempt(log, {
      agency: AGENCY, category: CAT, website: 'https://w.govt.nz/', url: URL_,
      status: 'excluded', exclusionReason: 'its only form is the site search',
      evidenceFromAttemptId: retrieval, htmlSha256: DIGEST, htmlBytes: 106370,
      approval: APPROVAL.PENDING,
      eligibility: { ...Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
        asksForTheNameOfANaturalPerson: false },
    });

    const csv = deriveLedger(log);
    const header = csv.split('\n')[0].split(',');
    for (const column of ['htmlSha256', 'htmlBytes', 'evidenceFromAttemptId', 'promotedFrom', 'supersedesAttemptId']) {
      assert.ok(header.includes(column), `${column} is not a ledger column`);
    }
    const row = csv.split('\n').find((l) => l.includes('excluded'));
    assert.ok(row.includes(DIGEST), 'the digest is not rendered from the field');
    assert.ok(row.includes('106370'), 'the length is not rendered from the field');
    assert.ok(row.includes(retrieval), 'the evidence link is not rendered');
    // Every row keeps the same shape, so the columns cannot shift under a reader.
    const widths = new Set(csv.trim().split('\n').map((l) => (l.match(/,/g) ?? []).length));
    assert.equal(widths.size, 1, 'rows disagree on column count');
  });
});
