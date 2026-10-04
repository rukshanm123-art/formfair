/**
 * Amendment 62: both implementations judge an authorised re-retrieval the same way.
 *
 * A second request for a page already retrieved exists for one reason: to obtain evidence the
 * first retrieval does not carry. `c-1017` retrieved the SIA contact page truthfully before the
 * report boundary and carries no structural report, and Amendment 59 proved an offline replay
 * cannot establish the live visibility criterion four needs.
 *
 * The capture package refuses a bad re-retrieval before the request. This drives that rule and the
 * sealer's independent mirror over one table and requires them to agree, because the last time a
 * repair reached only one of the two - Finding 4 of Amendment 61 - the attack the gate refused
 * returned zero problems from the seal.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extendsTargetProblem } from '../../../capture/run.mjs';
import { reRetrievalProblems } from '../descriptive.mjs';

const URL_ = 'https://www.sia.govt.nz/about/contact-us';
/** `c-1017` as it actually stands: truthful, pre-boundary, carrying no structural report. */
const prior = {
  id: 'c-1017', status: 'retrieved', approval: 'not-applicable', agency: 'Social Investment Agency',
  url: URL_, pageId: 'sia-about-contact-us', htmlSha256: 'a'.repeat(64),
  capturedAt: '2026-10-04T01:16:04Z', examinedAt: '2026-10-04T01:16:04Z',
};
const live = {
  structuralReportVersion: 1, structuralReportSource: 'live',
  registrationAffordances: [], nameFields: [{ name: 'n', label: 'Your name*', role: 'collection', basis: [] }],
  collectedNameFields: 1, searchKeyNameFields: 0,
};
const reRetrieval = (over = {}) => ({
  id: 'c-1022', status: 'retrieved', approval: 'not-applicable', agency: prior.agency,
  url: URL_, pageId: 'sia-about-contact-us-live', htmlSha256: 'b'.repeat(64),
  examinedAt: '2026-10-04T08:30:00Z', extendsAttemptId: 'c-1017', ...live, ...over,
});

/** Both rules over one record, required to agree on whether it is acceptable. */
const both = (record, priorRecord = prior) => {
  const log = { attempts: [priorRecord, record], renders: [] };
  const capture = extendsTargetProblem(log, record);
  const sealer = reRetrievalProblems(log);
  assert.equal(capture !== null, sealer.length > 0,
    `disagreement:\n  capture: ${JSON.stringify(capture)}\n  sealer: ${JSON.stringify(sealer)}`);
  return { capture, sealer, clean: capture === null };
};

describe('Amendment 62: the re-retrieval rule, in both implementations', () => {
  test('the authorised case is clean in both', () => {
    assert.ok(both(reRetrieval()).clean);
  });

  test('a re-retrieval of a page whose retrieval already has a live report is refused', () => {
    // Nothing a second request would establish, so the request should never be made.
    const v = both(reRetrieval(), { ...prior, ...live });
    assert.equal(v.clean, false);
    assert.match(v.capture, /nothing a second request would establish/);
  });

  test('a decision may not extend; the decision is recorded from the retrieval afterwards', () => {
    assert.equal(both(reRetrieval({ status: 'captured', approval: 'pending' })).clean, false);
  });

  test('extending something that is not an evidence-only retrieval is refused', () => {
    assert.equal(both(reRetrieval(), { ...prior, status: 'excluded', approval: 'approved' }).clean, false);
  });

  test('extending a superseded retrieval is refused', () => {
    const record = reRetrieval();
    const log = { attempts: [prior, { id: 'c-1018', supersedesAttemptId: 'c-1017' }, record], renders: [] };
    assert.ok(extendsTargetProblem(log, record) !== null);
    assert.ok(reRetrievalProblems(log).length > 0, 'the mirror must refuse it too');
  });

  test('extending a different page or agency is refused', () => {
    assert.equal(both(reRetrieval({ url: 'https://www.sia.govt.nz/about/contact-us/other' })).clean, false);
    assert.equal(both(reRetrieval({ agency: 'Other Agency' })).clean, false);
  });

  test('reusing the earlier pageId is refused, because its bytes stand', () => {
    const v = both(reRetrieval({ pageId: prior.pageId }));
    assert.equal(v.clean, false);
    assert.match(v.capture, /its own pageId/);
  });

  test('extending an id that is not recorded is refused', () => {
    const record = reRetrieval({ extendsAttemptId: 'c-9999' });
    const log = { attempts: [prior, record], renders: [] };
    assert.ok(extendsTargetProblem(log, record) !== null);
    assert.ok(reRetrievalProblems(log).length > 0);
  });

  test('a re-retrieval must not supersede the retrieval it extends', () => {
    // The earlier record is incomplete, not false: withdrawing it would erase a true retrieval.
    const record = reRetrieval({ supersedesAttemptId: 'c-1017' });
    assert.ok(reRetrievalProblems({ attempts: [prior, record], renders: [] }).length > 0);
  });

  test('a record with no extendsAttemptId is not touched by either rule', () => {
    const plain = { id: 'c-1030', status: 'retrieved', agency: prior.agency, url: URL_, pageId: 'x' };
    assert.equal(extendsTargetProblem({ attempts: [plain] }, plain), null);
    assert.deepEqual(reRetrievalProblems({ attempts: [plain], renders: [] }), []);
  });
});
