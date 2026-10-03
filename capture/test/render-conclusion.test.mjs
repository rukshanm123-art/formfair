/**
 * Amendment 54: the HTTP status the RENDER recorded decides which conclusion it may carry.
 *
 * `https://www.sia.govt.nz/search/SearchForm?Search=register` returned HTTP 500. The response was
 * the agency's own themed error page - site navigation and all - byte-identical for both search
 * terms, while the home page returned 200. So the render happened and the SEARCH did not.
 *
 * A judgement may only record `candidates-found` or `no-candidates`, and Amendment 39 requires
 * every rendered observation to carry a conclusion. `no-candidates` would have asserted that the
 * internal search found no registration form, which is the overclaim this study already recorded
 * as deviation `v-0002` and had to narrow the ECART note for.
 *
 * The rule runs in BOTH directions, and that symmetry is the substance of it. A page the server
 * served must be judged on its content, so an inconvenient page cannot be waved away as a
 * technical failure. A page the server did not serve must be recorded inconclusive, so a themed
 * error page's own menu cannot become evidence about forms.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, appendAttempt, renderConclusionProblems, renderConclusionAudit, corpusBlockers,
  unjudgedRenderedObservations, barrierAccounting, readContentUrls, APPROVAL,
} from '../run.mjs';
import { RECORD_TYPES, isServedStatus } from '../selection.mjs';
import { renderConclusionProblems as sealerProblems } from '../../evaluation/solo/descriptive.mjs';

const AGENCY = 'Social Investment Agency';
const CAT = 'account-registration';
const URL_ = 'https://www.sia.govt.nz/search/SearchForm?Search=register';

const render = (over = {}) => ({
  id: 'g-0300', url: URL_, finalUrl: URL_, httpStatus: 500, permitId: 'p-0458',
  consumedAt: '2026-10-02T20:49:00Z', navigatedAt: '2026-10-02T20:49:00Z',
  renderFile: 'g1790975399053.html', renderedSha256: 'c'.repeat(64), renderedBytes: 29784,
  title: 'Server error | Social Investment Agency', accessBarriers: [], ...over,
});

const observation = (over = {}) => ({
  id: 'd-0959', status: 'discovery', recordType: RECORD_TYPES.OBSERVATION, outcome: 'rendered',
  agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_,
  discoveryKind: 'internal-search', renderId: 'g-0300', permitId: 'p-0458',
  navigatedAt: '2026-10-02T20:49:00Z', ...over,
});

const conclusion = (over = {}) => ({
  id: 'd-0961', status: 'discovery', recordType: RECORD_TYPES.TECHNICAL_CONCLUSION,
  outcome: 'retrieval-inconclusive', agency: AGENCY, category: CAT, candidateSetVersion: 1,
  url: URL_, discoveryKind: 'internal-search', renderId: 'g-0300',
  evidenceFromDiscoveryId: 'd-0959', navigationPerformed: false,
  website: 'https://www.sia.govt.nz/', examinedAt: '2026-10-02T20:50:00Z',
  checkedAt: '2026-10-02T20:50:00Z', approval: APPROVAL.APPROVED,
  evidence: 'rendered-dom', renderFile: 'g1790975399053.html',
  renderedSha256: 'c'.repeat(64), renderedBytes: 29784,
  note: 'HTTP 500: the agency served its own error page, so the search never ran.', ...over,
});

const judgement = (over = {}) => ({
  id: 'd-0962', status: 'discovery', recordType: RECORD_TYPES.JUDGEMENT_ONLY,
  outcome: 'no-candidates', agency: AGENCY, category: CAT, candidateSetVersion: 1,
  url: URL_, renderId: 'g-0300', evidenceFromDiscoveryId: 'd-0959',
  navigationPerformed: false,
  website: 'https://www.sia.govt.nz/', examinedAt: '2026-10-02T20:50:00Z',
  checkedAt: '2026-10-02T20:50:00Z', approval: APPROVAL.APPROVED,
  evidence: 'rendered-dom', renderFile: 'g1790975399053.html',
  renderedSha256: 'c'.repeat(64), renderedBytes: 29784,
  note: 'a judgement about the page content', ...over,
});

const logWith = ({ renders = [render()], attempts = [observation()] } = {}) => ({
  ...emptyLog(), attempts, renders,
});

/** Both implementations, over one fixture. */
const verdicts = (attempt, opts = {}) => {
  const log = logWith(opts);
  const capture = renderConclusionProblems(log, attempt);
  const sealer = sealerProblems({ ...log, attempts: [...log.attempts, attempt] });
  assert.equal(
    capture.length > 0, sealer.length > 0,
    `the two implementations disagree:\n  capture: ${JSON.stringify(capture)}\n  sealer:  ${JSON.stringify(sealer)}`
  );
  return { capture, sealer, permitted: capture.length === 0 };
};

describe('the status decides, in both directions', () => {
  test('a page the server did not serve may be recorded inconclusive', () => {
    assert.ok(verdicts(conclusion()).permitted);
  });

  test('a page the server did not serve may NOT be judged no-candidates', () => {
    // The overclaim this amendment exists to prevent: the search never ran.
    const v = verdicts(judgement({ outcome: 'no-candidates' }));
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /did NOT serve|not serve/i);
  });

  test('a page the server did not serve may NOT be judged candidates-found either', () => {
    // The mirror image, and the more dangerous one: a themed 500 carries the whole site menu, so
    // reading it for candidates would let an error page nominate pages it merely links to.
    const v = verdicts(judgement({ outcome: 'candidates-found' }));
    assert.equal(v.permitted, false);
  });

  test('a page the server DID serve may not be dismissed as inconclusive', () => {
    // Without this direction the rule would be an escape hatch: any page could be declared a
    // technical failure rather than read.
    const v = verdicts(conclusion(), { renders: [render({ httpStatus: 200 })] });
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /was served/);
  });

  test('a page the server DID serve is judged on its content as before', () => {
    assert.ok(verdicts(judgement(), { renders: [render({ httpStatus: 200 })] }).permitted);
  });

  for (const status of [301, 403, 404, 429, 500, 502, 503]) {
    test(`HTTP ${status} is not served, so only a technical conclusion is permitted`, () => {
      assert.equal(isServedStatus(status), false);
      assert.ok(verdicts(conclusion(), { renders: [render({ httpStatus: status })] }).permitted);
      assert.equal(verdicts(judgement(), { renders: [render({ httpStatus: status })] }).permitted, false);
    });
  }

  for (const status of [200, 201, 204, 299]) {
    test(`HTTP ${status} is served, so only a content judgement is permitted`, () => {
      assert.ok(isServedStatus(status));
      assert.ok(verdicts(judgement(), { renders: [render({ httpStatus: status })] }).permitted);
      assert.equal(verdicts(conclusion(), { renders: [render({ httpStatus: status })] }).permitted, false);
    });
  }
});

describe('a status that cannot be read refuses every conclusion', () => {
  for (const [label, httpStatus] of [
    ['missing', undefined], ['null', null], ['a string', '500'],
    ['a float', 500.5], ['NaN', Number.NaN], ['zero', 0],
  ]) {
    test(`${label} status permits neither conclusion`, () => {
      // Fail closed. A missing or hand-edited status is the one input that would otherwise pick
      // whichever rule suited it, so it must satisfy neither.
      const renders = [render({ httpStatus })];
      assert.equal(verdicts(conclusion(), { renders }).permitted, false);
      assert.equal(verdicts(judgement(), { renders }).permitted, false);
    });
  }

  test('zero is refused rather than read as a non-2xx failure', () => {
    // 0 is what a crashed fetch leaves behind, not a status the server sent.
    const v = verdicts(conclusion(), { renders: [render({ httpStatus: 0 })] });
    assert.match(v.capture.join(' '), /not a usable status/);
  });
});

describe('the conclusion must cite the exact observation and render', () => {
  test('a render that is not in the registry is refused', () => {
    assert.equal(verdicts(conclusion({ renderId: 'g-9999' }), { renders: [] }).permitted, false);
  });

  test('citing an observation that does not exist is refused', () => {
    assert.equal(verdicts(conclusion({ evidenceFromDiscoveryId: 'd-9999' })).permitted, false);
  });

  test('citing an observation that registered a DIFFERENT render is refused', () => {
    const v = verdicts(conclusion({ renderId: 'g-0301' }), {
      renders: [render(), render({ id: 'g-0301' })],
    });
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /registered g-0300/);
  });

  test('citing a superseded observation is refused', () => {
    const v = verdicts(conclusion(), {
      attempts: [observation(), { ...observation({ id: 'd-0960' }), supersedesDiscoveryId: 'd-0959' }],
    });
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /superseded/);
  });

  test('citing a record that is not a render is refused', () => {
    const v = verdicts(conclusion(), {
      attempts: [observation({ outcome: 'no-candidates', renderId: undefined })],
    });
    assert.equal(v.permitted, false);
  });

  test('a different agency, category, round or page is refused', () => {
    for (const over of [
      { agency: 'New Zealand Defence Force' }, { category: 'enquiry-or-contact' },
      { candidateSetVersion: 2 }, { url: 'https://www.sia.govt.nz/' },
    ]) {
      assert.equal(verdicts(conclusion(over)).permitted, false, JSON.stringify(over));
    }
  });
});

describe('one active conclusion per render, per category and round', () => {
  test('a second conclusion in the same scope is refused', () => {
    const v = verdicts(conclusion({ id: 'd-0963' }), {
      attempts: [observation(), conclusion()],
    });
    assert.equal(v.permitted, false);
    assert.match(v.capture.join(' '), /already the active conclusion/);
  });

  test('a conclusion in another category is permitted, because one render answers several', () => {
    // Eight renders in the live log carry a judgement in each of two or three categories, every
    // one a distinct scope. Scoping this per render alone would refuse legitimate history.
    const v = verdicts(conclusion({ id: 'd-0963', category: 'enquiry-or-contact' }), {
      attempts: [observation(), observation({ id: 'd-0964', category: 'enquiry-or-contact' }), conclusion()],
    });
    assert.equal(v.capture.some((p) => /already the active conclusion/.test(p)), false);
  });
});

describe('what a technical conclusion is, and is not', () => {
  test('it carries no permit and no navigation timestamp', () => {
    const log = logWith();
    assert.throws(() => appendAttempt(log, conclusion({ id: undefined, permitId: 'p-0458' })), /must not name a permit/);
    assert.throws(
      () => appendAttempt(log, conclusion({ id: undefined, navigatedAt: '2026-10-02T20:49:00Z' })),
      /must not carry a navigation timestamp/
    );
  });

  test('it does not supersede the observation: the render happened', () => {
    const log = logWith();
    assert.throws(
      () => appendAttempt(log, conclusion({ id: undefined, supersedesDiscoveryId: 'd-0959' })),
      /does not supersede the observation/
    );
  });

  test('the observation stays active after it is recorded', () => {
    const log = logWith();
    appendAttempt(log, conclusion({ id: undefined }));
    const obs = log.attempts.find((a) => a.id === 'd-0959');
    assert.equal(log.attempts.some((a) => a.supersedesDiscoveryId === obs.id), false);
    assert.equal(obs.outcome, 'rendered');
  });

  test('it discharges the unjudged-render obligation', () => {
    const before = logWith();
    assert.equal(unjudgedRenderedObservations(before).length, 1);
    const after = logWith();
    appendAttempt(after, conclusion({ id: undefined }));
    assert.deepEqual(unjudgedRenderedObservations(after), []);
  });

  test('it is unresolved technical attrition, and no recovered barrier', () => {
    const log = logWith();
    appendAttempt(log, conclusion({ id: undefined }));
    const b = barrierAccounting(log, { agency: AGENCY, category: CAT, candidateSetVersion: 1 });
    assert.equal(b.retrievalInconclusive, 1);
    assert.equal(b.recovered, 0);
    assert.equal(b.barrierAttempts, 0);
    assert.equal(b.unreadUrls, 1);
  });

  test('it contributes no read-content finding', () => {
    // The error page's own navigation must not count as a page that was read for candidates.
    const log = logWith();
    appendAttempt(log, conclusion({ id: undefined }));
    const read = readContentUrls(log, { agency: AGENCY, category: CAT, candidateSetVersion: 1 });
    assert.equal(read.records, 0);
    assert.equal(read.urls, 0);
  });

  test('the error page cannot become candidate evidence', () => {
    // The whole point, stated as a gate: a round whose only conclusion is technical has no
    // candidates-found record, so nothing in that error page can support a candidate.
    const log = logWith();
    appendAttempt(log, conclusion({ id: undefined }));
    const found = log.attempts.filter((a) => a.outcome === 'candidates-found');
    assert.deepEqual(found, []);
    const read = readContentUrls(log, { agency: AGENCY, category: CAT, candidateSetVersion: 1 });
    assert.equal(read.records, 0, 'an unserved page must not count as content that was read');
  });
});

describe('the corpus gate re-checks what write time allowed', () => {
  test('a clean log raises nothing', () => {
    const log = logWith();
    appendAttempt(log, conclusion({ id: undefined }));
    assert.deepEqual(renderConclusionAudit(log), []);
  });

  test('a render re-registered with a served status afterwards is caught', () => {
    // Why this is a gate and not only a write-time check: the status lives in the registry, and
    // the registry can change after the conclusion was written.
    const log = logWith();
    appendAttempt(log, conclusion({ id: undefined }));
    log.renders[0].httpStatus = 200;
    const audit = renderConclusionAudit(log);
    assert.equal(audit.length > 0, true);
    assert.ok(corpusBlockers(log).some((b) => b.kind === 'render-conclusion'));
  });
});

describe('the record-type lists cannot drift from the record types', () => {
  test('every record type may rest on a render, in both implementations', async () => {
    // How this was found: Amendment 54 added `technical-conclusion` and the render ledger's
    // allowlist of three types was not extended, so the ledger refused every technical conclusion
    // and the provenance publish failed on the first real use. That is the FIFTH hand-maintained
    // list in this project to drift from what it enumerates, after the status totals, the
    // `retrieved` state, `eligible-not-selected` and the CI test-file lists. The capture side is
    // now derived from RECORD_TYPES; the sealer names its own list once, and this asserts the two
    // agree, because the sealer may not import the capture package.
    const sealer = (await import('../../evaluation/solo/descriptive.mjs')).RENDER_BEARING_RECORD_TYPES;
    const capture = (await import('../selection.mjs')).RENDER_BEARING_RECORD_TYPES;
    assert.deepEqual(
      [...sealer].sort(), [...capture].sort(),
      'the sealer and the capture package disagree about which records may rest on a render'
    );
    // And it is a SUBSET of the record types, not all of them. Amendment 55 derived it from
    // RECORD_TYPES, which was right for four types and wrong as a rule: Amendment 57's
    // `policy-reuse` rests on a recorded robots check and on no render. This guard caught that
    // on the first run after the type was added, which is what it is for.
    for (const t of capture) assert.ok(Object.values(RECORD_TYPES).includes(t), t);
    assert.ok(capture.length < Object.values(RECORD_TYPES).length,
      'at least one record type rests on something other than a render');
    assert.equal(capture.includes(RECORD_TYPES.POLICY_REUSE), false);
  });

  test('a technical conclusion passes the render ledger', async () => {
    // The exact failure, as a test: the ledger must accept the type the amendment introduced.
    const { checkRenderLedger } = await import('../run.mjs');
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createHash } = await import('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'formfair-ledger-'));
    try {
      const html = '<!doctype html><html><body>Server error</body></html>';
      mkdirSync(join(dir, 'rendered'), { recursive: true });
      writeFileSync(join(dir, 'rendered', 'g1.html'), html, 'utf8');
      const digest = createHash('sha256').update(html).digest('hex');
      const log = {
        ...emptyLog(),
        discoveryPermits: [{
          id: 'p-0458', url: URL_, agency: AGENCY, category: CAT, candidateSetVersion: 1,
          issuedAt: '2026-10-02T20:48:30Z', consumedAt: '2026-10-02T20:49:00Z',
          robotsCheckId: 'r-0083',
        }],
        robotsChecks: [{
          id: 'r-0083', origin: 'https://www.sia.govt.nz', url: 'https://www.sia.govt.nz/robots.txt',
          fetchedAt: '2026-10-02T20:48:00Z', httpStatus: 200, disposition: 'rules',
          sha256: 'd'.repeat(64), bytes: 59, body: 'User-agent: *\n',
        }],
        renders: [{
          ...render({ renderFile: 'g1.html', renderedSha256: digest, renderedBytes: html.length }),
        }],
        attempts: [
          observation(),
          conclusion({ renderFile: 'g1.html', renderedSha256: digest, renderedBytes: html.length }),
        ],
      };
      assert.deepEqual(checkRenderLedger(log, join(dir, 'rendered')), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
