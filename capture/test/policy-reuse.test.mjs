/**
 * Amendment 57: documenting that a round reused a policy must not require a new request.
 *
 * A robots discovery record could only be created by the discovery recorder, which requires a
 * permit, and a permit asserts a request. So to write down that a round reused a fresh policy, the
 * harness had to fetch `robots.txt` again. That is exactly what happened in the Social Investment
 * Agency service-application round, against an explicit instruction not to refetch: `p-0477`
 * authorised the request, `f-0005` retrieved it, `d-0987` recorded it, and the note then claimed the
 * procedure had reused the policies "rather than refetching". The response was byte-identical, so
 * nothing changed - but the request should never have been needed. Deviation `v-0005`.
 *
 * The reuse kind removes the need. Its whole safety rests on one thing: the policy it names must
 * really have governed the round. A stale or foreign policy documented as a round's authority would
 * be worse than the refetch it replaces, because it would look like provenance while being none -
 * so most of these tests are the ways it must be refused.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, appendAttempt, policyReuseProblems, policyReuseAudit, policyAgreementProblems,
  corpusBlockers, APPROVAL,
} from '../run.mjs';
import { RECORD_TYPES } from '../selection.mjs';
import {
  policyReuseProblems as sealerProblems,
  policyAgreementProblems as sealerAgreement,
} from '../../evaluation/solo/descriptive.mjs';

const AGENCY = 'Social Investment Agency';
const CAT = 'enquiry-or-contact';
const ORIGIN = 'https://www.sia.govt.nz';
const URL_ = `${ORIGIN}/robots.txt`;
const WRITTEN = '2026-10-03T08:40:00Z';

const check = (over = {}) => ({
  id: 'r-0083', origin: ORIGIN, url: URL_, fetchedAt: '2026-10-03T06:00:00Z',
  httpStatus: 200, disposition: 'rules', sha256: 'd'.repeat(64), bytes: 59,
  body: 'User-agent: *\nDisallow: /*/changes\n', ...over,
});

const reuse = (over = {}) => ({
  recordType: RECORD_TYPES.POLICY_REUSE, robotsCheckId: 'r-0083',
  examinedAt: WRITTEN, checkedAt: WRITTEN,
  agency: AGENCY, website: `${ORIGIN}/`, url: URL_,
  status: 'discovery', discoveryKind: 'robots', outcome: 'no-candidates',
  category: CAT, candidateSetVersion: 1, navigationPerformed: false,
  note: 'the policy that governed this round, reused without a request',
  approval: APPROVAL.APPROVED, ...over,
});

const logWith = (checks = [check()]) => ({ ...emptyLog(), robotsChecks: checks });

/** Both implementations, over one record. The sealer may not import the capture package. */
const verdicts = (attempt, checks) => {
  const log = logWith(checks);
  const capture = policyReuseProblems(log, attempt);
  const sealer = sealerProblems({ ...log, attempts: [{ id: 'd-0001', ...attempt }] });
  assert.equal(
    capture.length > 0, sealer.length > 0,
    `the two implementations disagree:\n  capture: ${JSON.stringify(capture)}\n  sealer:  ${JSON.stringify(sealer)}`
  );
  return { capture, sealer, permitted: capture.length === 0 };
};

describe('the record it exists to make', () => {
  test('a fresh policy for its own origin is reusable', () => {
    assert.ok(verdicts(reuse()).permitted);
  });

  test('it is written with no permit, no navigation time and no retained bytes', () => {
    const log = logWith();
    appendAttempt(log, reuse());
    const a = log.attempts.at(-1);
    assert.equal(a.permitId, undefined);
    assert.equal(a.navigatedAt, undefined);
    assert.equal(a.fetchId, undefined);
    assert.equal(a.navigationPerformed, false);
    assert.equal(a.robotsCheckId, 'r-0083');
  });

  test('and it raises nothing at the corpus gate', () => {
    const log = logWith();
    appendAttempt(log, reuse());
    assert.deepEqual(policyReuseAudit(log), []);
    assert.equal(corpusBlockers(log).some((b) => b.kind === 'policy-reuse'), false);
  });
});

describe('it must not claim a request', () => {
  for (const [label, over] of [
    ['a permit', { permitId: 'p-0477' }],
    ['a navigation timestamp', { navigatedAt: WRITTEN }],
    ['retained bytes', { fetchId: 'f-0005' }],
    ['navigationPerformed true', { navigationPerformed: true }],
  ]) {
    test(`${label} is refused at write time`, () => {
      const log = logWith();
      assert.throws(() => appendAttempt(log, reuse(over)), /invalid capture attempt/);
    });
  }

  test('naming a permit is refused in the words that say why', () => {
    // The refetch this kind exists to avoid is exactly what a permit would assert.
    const log = logWith();
    assert.throws(() => appendAttempt(log, reuse({ permitId: 'p-0477' })), /the very refetch this record exists to avoid/);
  });
});

describe('the policy it names must have governed the round', () => {
  test('a policy that is not recorded is refused', () => {
    const v = verdicts(reuse({ robotsCheckId: 'r-9999' }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /not recorded/);
  });

  test('a policy for another origin is refused', () => {
    // The attack this closes: a policy that exists and is fresh, but governs somewhere else.
    const v = verdicts(reuse(), [check({ origin: 'https://thehub.sia.govt.nz' })]);
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /policy for https:\/\/thehub/);
  });

  test('a policy that was already stale when the record was written is refused', () => {
    const v = verdicts(reuse(), [check({ fetchedAt: '2026-10-02T06:00:00Z' })]);
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /more than 24 hours/);
  });

  test('freshness is judged as of the record, not as of now', () => {
    // A record written while the policy was in force stays true afterwards. Judging against the
    // clock would make honest history rot into a gate failure.
    const longAgo = reuse({ examinedAt: '2026-01-02T00:00:00Z' });
    assert.ok(verdicts(longAgo, [check({ fetchedAt: '2026-01-01T23:00:00Z' })]).permitted);
  });

  test('a policy fetched after the record is refused', () => {
    // Amendment 58. This test asserted `permitted === true` under this very title, with a comment
    // rationalising the one-sided window as "the existing freshness rule". That is worse than no
    // test: it read as coverage in the suite listing while asserting the opposite of its name.
    // Negative age is not freshness - a record cannot rest on a policy that did not yet exist.
    const v = verdicts(reuse({ examinedAt: '2026-10-03T06:00:00Z' }), [check({ fetchedAt: '2026-10-03T08:00:00Z' })]);
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /AFTER this record/);
  });

  test('the window is two-sided, and closed at both ends', () => {
    const fetchedAt = '2026-10-03T06:00:00Z';
    const t = (iso) => verdicts(reuse({ examinedAt: iso }), [check({ fetchedAt })]).permitted;
    assert.equal(t('2026-10-03T05:59:59Z'), false, 'one second before the policy existed');
    assert.equal(t(fetchedAt), true, 'the instant it was fetched');
    assert.equal(t('2026-10-04T05:59:59Z'), true, 'one second inside 24 hours');
    assert.equal(t('2026-10-04T06:00:00Z'), false, 'exactly 24 hours is outside');
  });

  test('an unestablished policy is refused', () => {
    // Nothing was in force to reuse.
    const v = verdicts(reuse(), [check({ disposition: 'unestablished' })]);
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /unestablished/);
  });

  test('a record with no usable examinedAt cannot be dated', () => {
    assert.equal(verdicts(reuse({ examinedAt: 'not-a-time' })).permitted, false);
  });

  test('an allow-all policy from a 404 is reusable', () => {
    // A 404 establishes a permission under RFC 9309; it is a policy, not an absence of one.
    assert.ok(verdicts(reuse(), [check({ httpStatus: 404, disposition: 'allow-all' })]).permitted);
  });
});

describe('the gate re-checks what write time allowed', () => {
  test('a policy that goes stale relative to a later record is caught', () => {
    const log = logWith();
    appendAttempt(log, reuse());
    // A second reuse record written a week later, on the same now-stale check.
    log.attempts.push({ ...reuse({ examinedAt: '2026-10-10T08:40:00Z' }), id: 'd-0002' });
    const audit = policyReuseAudit(log);
    assert.equal(audit.length > 0, true);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'policy-reuse'));
  });

  test('a check removed from the log afterwards is caught', () => {
    const log = logWith();
    appendAttempt(log, reuse());
    log.robotsChecks = [];
    assert.equal(policyReuseAudit(log).length > 0, true);
  });
});

describe('Amendment 58: the record must be OF the policy file', () => {
  test('a record of a page rather than the policy is refused', () => {
    // The attack: a real, fresh policy for the right origin, cited by a record whose url is a
    // content page. Every Amendment 57 check passed.
    const v = verdicts(reuse({ url: `${ORIGIN}/contact` }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /the policy at/);
  });

  test('and it is refused at write time', () => {
    const log = logWith();
    assert.throws(() => appendAttempt(log, reuse({ url: `${ORIGIN}/contact` })), /the policy at/);
  });

  test('a website belonging to another origin is refused', () => {
    const v = verdicts(reuse({ website: 'https://thehub.sia.govt.nz/' }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /which is not https:\/\/www\.sia/);
  });

  test('a trailing-slash difference on the policy URL is still the same policy', () => {
    // Canonicalised, not string-compared: the rule is about identity, not spelling.
    assert.ok(verdicts(reuse({ url: `${ORIGIN}/robots.txt#x` })).permitted);
  });
});

describe('Amendment 58: the documented policy must be the one the round acted under', () => {
  const permit = (over = {}) => ({
    id: 'p-0500', url: `${ORIGIN}/`, agency: AGENCY, category: CAT, candidateSetVersion: 1,
    robotsCheckId: 'r-0083', issuedAt: '2026-10-03T08:00:00Z', consumedAt: '2026-10-03T08:00:30Z',
    ...over,
  });
  const scopeLog = ({ checks = [check()], permits = [permit()], records = [reuse()] } = {}) => ({
    ...emptyLog(), robotsChecks: checks, discoveryPermits: permits,
    attempts: records.map((r, i) => ({ id: `d-000${i + 1}`, ...r })),
  });
  const agree = (log) => {
    const capture = policyAgreementProblems(log);
    const sealer = sealerAgreement(log);
    assert.equal(
      capture.length > 0, sealer.length > 0,
      `disagreement:\n  capture: ${JSON.stringify(capture)}\n  sealer: ${JSON.stringify(sealer)}`
    );
    return { capture, clean: capture.length === 0 };
  };

  test('agreeing documentation is clean', () => {
    assert.ok(agree(scopeLog()).clean);
  });

  test('documenting one policy while acting under another is refused', () => {
    // The attack: both checks real, both fresh, both for this origin - and the published account
    // names the one nothing was decided under.
    const log = scopeLog({
      checks: [check(), check({ id: 'r-0084', fetchedAt: '2026-10-03T07:00:00Z' })],
      permits: [permit({ robotsCheckId: 'r-0084' })],
    });
    const v = agree(log);
    assert.equal(v.clean, false);
    assert.match(v.capture.join(' '), /acted under r-0084|documents r-0083/);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'policy-agreement'));
  });

  test('a refreshed policy mid-round needs BOTH intervals documented', () => {
    // Requirement 4, as a test. A long round whose policy is refreshed acts under two checks, so
    // one record claiming a single check governed everything is refused...
    const checks = [check(), check({ id: 'r-0084', fetchedAt: '2026-10-03T20:00:00Z' })];
    const permits = [permit(), permit({ id: 'p-0501', robotsCheckId: 'r-0084', issuedAt: '2026-10-03T21:00:00Z', consumedAt: '2026-10-03T21:00:30Z' })];
    assert.equal(agree(scopeLog({ checks, permits })).clean, false);
    // ...and two records, one per governing interval, are clean.
    const both = scopeLog({
      checks, permits,
      records: [reuse(), reuse({ robotsCheckId: 'r-0084', examinedAt: '2026-10-03T21:30:00Z', checkedAt: '2026-10-03T21:30:00Z' })],
    });
    assert.ok(agree(both).clean);
  });

  test('a robots-grounded discovery record counts as acting under its check', () => {
    const log = scopeLog({
      checks: [check(), check({ id: 'r-0084', fetchedAt: '2026-10-03T07:00:00Z' })],
      permits: [],
      records: [reuse(), {
        id: 'd-0009', status: 'discovery', discoveryKind: 'robots', outcome: 'disallowed',
        agency: AGENCY, category: CAT, candidateSetVersion: 1, url: `${ORIGIN}/admin/`,
        robotsCheckId: 'r-0084', website: `${ORIGIN}/`,
      }],
    });
    assert.equal(agree(log).clean, false);
  });

  test('another round under the same origin is a separate scope', () => {
    // A policy documented for one round says nothing about another, so the rounds are not mixed.
    const log = scopeLog({
      permits: [permit(), permit({ id: 'p-0502', category: 'service-application', robotsCheckId: 'r-0084' })],
      checks: [check(), check({ id: 'r-0084', fetchedAt: '2026-10-03T07:00:00Z' })],
    });
    assert.ok(agree(log).clean, 'the other category has no reuse record, so it is not in scope');
  });
});
