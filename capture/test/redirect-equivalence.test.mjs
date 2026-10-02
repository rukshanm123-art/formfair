/**
 * Amendment 53: one retrieval may settle two locked candidates, when a recorded redirect proves
 * they are one page.
 *
 * `https://teara.govt.nz/contact-us` and `https://teara.govt.nz/en/contact-us` were both locked in
 * the Ministry for Culture and Heritage enquiry-or-contact round. They had to be: the bound is
 * applied to URLs nobody has requested yet, and the frozen canonicaliser keeps them distinct. An
 * earlier attempt to deduplicate them was refused precisely because their identity had not been
 * established - the judgements said so in terms.
 *
 * Requesting the first then established it: HTTP 301 to the second, serving a page whose own
 * `<link rel="canonical">` names the second. One page, two locked URLs. But the evidence guard
 * required a citation's URL to equal the retrieval's requested URL, so the second candidate could
 * be settled only by requesting a page already held - a request that would buy nothing.
 *
 * The exception is therefore narrow by construction, and these tests are mostly the ways it must
 * refuse. Everything it reads is a field the retrieval RECORDED: the chain Chromium followed, each
 * hop's robots verdict at the time, and the URL finally reached. Nothing is inferred from how the
 * URLs look, because that inference is the one this project already rejected.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, redirectEquivalenceProblems, redirectEquivalenceAudit, corpusBlockers,
  ELIGIBILITY_CRITERIA, APPROVAL, appendAttempt,
} from '../run.mjs';
import { redirectEquivalenceProblems as sealerProblems } from '../../evaluation/solo/descriptive.mjs';

const AGENCY = 'Ministry for Culture and Heritage';
const CAT = 'enquiry-or-contact';
const FROM = 'https://teara.govt.nz/contact-us';
const TO = 'https://teara.govt.nz/en/contact-us';
const OTHER = 'https://vietnamwar.govt.nz/contact';

const retrieval = (over = {}) => ({
  id: 'c-0950', status: 'retrieved', agency: AGENCY, category: CAT, candidateSetVersion: 1,
  website: 'https://teara.govt.nz/', url: FROM, finalUrl: TO, httpStatus: 200,
  pageId: 'teara-contact-us-bare', file: 'teara-contact-us-bare.html',
  htmlSha256: 'b'.repeat(64), htmlBytes: 577500,
  redirectChain: [{ from: FROM, to: TO, httpStatus: 301, allowed: true, robotsCheckId: 'r-0081' }],
  ...over,
});

/** A log whose set has locked both URLs, as the real round did. */
const logWith = (source, locked = [FROM, TO, OTHER]) => {
  const log = { ...emptyLog(), attempts: [source] };
  log.candidateSets[`${AGENCY}\u0000${CAT}`] = {
    agency: AGENCY, category: CAT, version: 1, discovered: [...locked], locked: [...locked],
    lockedAt: '2026-10-02T20:11:19Z', approval: APPROVAL.APPROVED,
    discoveryRecordIds: ['d-0875'],
  };
  return log;
};

/**
 * Both implementations, over one fixture. The sealer may not import the capture package, so this
 * agreement is the only thing holding the two derivations together.
 */
const verdicts = (source, { decisionUrl = TO, locked, scope = {} } = {}) => {
  const log = logWith(source, locked);
  const args = {
    decisionUrl, agency: AGENCY, category: CAT, candidateSetVersion: 1, ...scope,
  };
  const capture = redirectEquivalenceProblems(log, { source, ...args });
  const sealer = sealerProblems({ log, source, ...args });
  assert.equal(
    capture.length > 0, sealer.length > 0,
    `the two implementations disagree:\n  capture: ${JSON.stringify(capture)}\n  sealer:  ${JSON.stringify(sealer)}`
  );
  return { capture, sealer, permitted: capture.length === 0 };
};

describe('the case it was written for', () => {
  test('a recorded 301 to the other locked candidate establishes one page', () => {
    assert.ok(verdicts(retrieval()).permitted);
  });

  test('the retrieval still settles its own URL with no equivalence needed', () => {
    // Candidate three is settled the ordinary way; only candidate four needs the rule.
    assert.ok(verdicts(retrieval(), { decisionUrl: FROM }).permitted);
  });

  test('a multi-hop chain is accepted while it stays continuous', () => {
    const mid = 'https://teara.govt.nz/contact';
    assert.ok(verdicts(retrieval({
      redirectChain: [
        { from: FROM, to: mid, httpStatus: 301, allowed: true },
        { from: mid, to: TO, httpStatus: 301, allowed: true },
      ],
    })).permitted);
  });
});

describe('an invented equivalence is refused', () => {
  test('a finalUrl that does not match the decision URL', () => {
    // The central forgery: claim the retrieval ended somewhere it did not.
    const v = verdicts(retrieval({ finalUrl: 'https://teara.govt.nz/somewhere-else' }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /finally reached/);
  });

  test('no finalUrl at all', () => {
    const v = verdicts(retrieval({ finalUrl: undefined }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /no finalUrl/);
  });

  test('no redirect chain, however plausible the URLs look', () => {
    // This is the refused inference, restated as a test: /contact-us and /en/contact-us may well
    // be one page, and without a recorded chain nothing here establishes it.
    const v = verdicts(retrieval({ redirectChain: undefined }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /no redirect chain/);
  });

  test('an empty redirect chain', () => {
    assert.equal(verdicts(retrieval({ redirectChain: [] })).permitted, false);
  });
});

describe('a chain that does not join the two URLs is refused', () => {
  test('one that starts somewhere else', () => {
    const v = verdicts(retrieval({
      redirectChain: [{ from: 'https://teara.govt.nz/elsewhere', to: TO, httpStatus: 301, allowed: true }],
    }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /start/);
  });

  test('one that ends somewhere else', () => {
    const v = verdicts(retrieval({
      redirectChain: [{ from: FROM, to: 'https://teara.govt.nz/other', httpStatus: 301, allowed: true }],
      finalUrl: 'https://teara.govt.nz/other',
    }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /end/);
  });

  test('a broken chain, where one hop does not continue the last', () => {
    const v = verdicts(retrieval({
      redirectChain: [
        { from: FROM, to: 'https://teara.govt.nz/a', httpStatus: 301, allowed: true },
        { from: 'https://teara.govt.nz/b', to: TO, httpStatus: 301, allowed: true },
      ],
    }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /breaks at hop 2/);
  });

  test('a hop that robots refused', () => {
    // A redirect followed into a disallowed path cannot be the basis of anything.
    const v = verdicts(retrieval({
      redirectChain: [{ from: FROM, to: TO, httpStatus: 301, allowed: false }],
    }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /not recorded as allowed/);
  });

  test('a hop whose verdict was never recorded', () => {
    // `allowed` absent is not `allowed` true. Unrecorded must not read as permitted.
    const v = verdicts(retrieval({
      redirectChain: [{ from: FROM, to: TO, httpStatus: 301 }],
    }));
    assert.equal(v.permitted, false);
  });
});

describe('the permission is bounded to this round and its own locked candidates', () => {
  test('evidence from another round is refused', () => {
    assert.equal(verdicts(retrieval({ candidateSetVersion: 2 })).permitted, false);
  });

  test('evidence from another category is refused', () => {
    assert.equal(verdicts(retrieval({ category: 'service-application' })).permitted, false);
  });

  test('evidence from another agency is refused', () => {
    assert.equal(verdicts(retrieval({ agency: 'New Zealand Defence Force' })).permitted, false);
  });

  test('a decision URL the set never locked is refused', () => {
    // The rule settles a duplicate the bound admitted; it can never reach a page the set did not
    // undertake to assess, even if a redirect happens to land there.
    const v = verdicts(retrieval(), { locked: [FROM, OTHER] });
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /not a locked candidate/);
  });

  test('a source URL the set never locked is refused', () => {
    const v = verdicts(retrieval(), { locked: [TO, OTHER] });
    assert.equal(v.permitted, false);
  });

  test('an unrelated target is refused even with a valid-looking chain', () => {
    const v = verdicts(retrieval(), { decisionUrl: OTHER });
    assert.equal(v.permitted, false);
  });

  test('a source that is not an assessment-only retrieval is refused', () => {
    assert.equal(verdicts(retrieval({ status: 'captured' })).permitted, false);
  });
});

describe('the write-time guard enforces it', () => {
  /** The exclusion a decision on the other locked candidate would write. */
  const exclusion = (over = {}) => ({
    agency: AGENCY, category: CAT, website: 'https://teara.govt.nz/', url: TO,
    status: 'excluded', candidateSetVersion: 1, approval: APPROVAL.PENDING,
    evidenceFromAttemptId: 'c-0950',
    htmlSha256: 'b'.repeat(64), htmlBytes: 577500,
    exclusionReason: 'the page carries no personal-name field; only the site search',
    eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    ...over,
  });

  test('it accepts the citation when the redirect supports it', () => {
    const log = logWith(retrieval());
    appendAttempt(log, exclusion());
    assert.equal(log.attempts.at(-1).url, TO);
    assert.equal(log.attempts.at(-1).evidenceFromAttemptId, 'c-0950');
  });

  test('it refuses the citation when nothing records the redirect', () => {
    const log = logWith(retrieval({ redirectChain: undefined }));
    assert.throws(() => appendAttempt(log, exclusion()), /no recorded redirect makes them one page/);
  });

  test('it refuses an invented finalUrl', () => {
    const log = logWith(retrieval({ finalUrl: 'https://teara.govt.nz/invented' }));
    assert.throws(() => appendAttempt(log, exclusion()), /finally reached/);
  });

  test('no permit or navigation timestamp is copied onto the decision', () => {
    // Two decisions may rest on one retrieval of one page. Two records claiming one REQUEST must
    // stay impossible, so the decision carries neither the permit nor the navigation time.
    const log = logWith(retrieval({ permitId: 'p-0999', navigatedAt: '2026-10-02T20:20:00Z' }));
    appendAttempt(log, exclusion());
    const written = log.attempts.at(-1);
    assert.equal(written.permitId, undefined);
    assert.equal(written.navigatedAt, undefined);
  });
});

describe('the corpus gate re-verifies what the write-time check allowed', () => {
  test('a clean log raises nothing', () => {
    const log = logWith(retrieval());
    appendAttempt(log, {
      agency: AGENCY, category: CAT, website: 'https://teara.govt.nz/', url: TO,
      status: 'excluded', candidateSetVersion: 1, approval: APPROVAL.APPROVED,
      evidenceFromAttemptId: 'c-0950', htmlSha256: 'b'.repeat(64), htmlBytes: 577500,
      exclusionReason: 'no personal-name field on the page as rendered',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    });
    assert.deepEqual(redirectEquivalenceAudit(log), []);
  });

  test('a set relocked without the URL afterwards is caught', () => {
    // The reason this is a gate and not only a write-time check: the equivalence rested on both
    // URLs being locked, and a set can be reopened and relocked after the decision was written.
    const log = logWith(retrieval());
    appendAttempt(log, {
      agency: AGENCY, category: CAT, website: 'https://teara.govt.nz/', url: TO,
      status: 'excluded', candidateSetVersion: 1, approval: APPROVAL.APPROVED,
      evidenceFromAttemptId: 'c-0950', htmlSha256: 'b'.repeat(64), htmlBytes: 577500,
      exclusionReason: 'no personal-name field on the page as rendered',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    });
    log.candidateSets[`${AGENCY}\u0000${CAT}`].locked = [FROM, OTHER];
    const audit = redirectEquivalenceAudit(log);
    assert.equal(audit.length > 0, true);
    assert.match(audit.join(' '), /not a locked candidate/);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'redirect-equivalence'));
  });
});
