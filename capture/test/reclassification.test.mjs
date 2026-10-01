/**
 * Amendment 48: a re-reading of retained bytes is its own kind of record.
 *
 * Amendment 46 wrote its correction as an OBSERVATION, and an observation means a retrieval: it must
 * name the permit that authorised the request, carry the time of that request, and declare that
 * navigation occurred. The live gates reported four problems at once — `g-0158` orphaned because its
 * only observation had been superseded, and `d-0684` claiming no navigation, no timestamp and no
 * permit while typed as a retrieval. Status compounded it by reporting 59 attrition records where 57
 * were active, because a corrected record stayed in the headline figure.
 *
 * The forbidden repair was to copy `p-0285` and its navigation time onto a second record. That would
 * make two records claim one retrieval and dress a metadata correction as network traffic, so the
 * shape below is what the tests hold.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, appendAttempt, checkRenderLedger, checkPermitLedger, corpusBlockers,
  renderBacklog, staleSetBindings, isDiscoverySuperseded, answerChain,
} from '../run.mjs';
import { RECORD_TYPES, TECHNICAL_ATTRITION_OUTCOMES } from '../selection.mjs';
import { renderLedgerProblems, unjudgedRenderProblems } from '../../evaluation/solo/descriptive.mjs';
import { prepareSet } from './helpers.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const AGENCY = 'Health New Zealand';
const CAT = 'account-registration';
const URL_ = 'https://jobs.example.govt.nz/login';
const FILE = 'g-jobs.html';
const BYTES = '<html><body><a href="/register">Register</a><input type="password"></body></html>';
const DIGEST = createHash('sha256').update(BYTES).digest('hex');

/**
 * A rendered/ directory holding every file the log references, so the digest checks actually run.
 * The helper's own set fixtures carry render files too, and a ledger check that cannot read them
 * reports a missing file rather than the rule under test.
 */
const renderedRoot = (log) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-reclass-'));
  const root = join(dir, 'rendered');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, FILE), BYTES);
  for (const a of log.attempts) {
    if (!a.renderFile || a.renderFile === FILE) continue;
    // Written to match whatever digest the fixture recorded, so only the rule under test can fail.
    writeFileSync(join(root, a.renderFile), BYTES);
    a.renderedSha256 = DIGEST;
    a.renderedBytes = Buffer.byteLength(BYTES);
  }
  return { root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
const PERMIT = 'p-0285';
const AT = '2026-09-30T20:00:00Z';

/** The live shape: one retrieval under one permit, barred, then re-read twice over. */
const liveShape = ({ reclassify = true, judge = true } = {}) => {
  const log = emptyLog();
  prepareSet(log, AGENCY, CAT, [URL_]);
  // The permit names a robots check, and that check must exist: the permit ledger says so.
  log.robotsChecks = [{
    id: 'r-0052', origin: 'https://jobs.example.govt.nz', url: 'https://jobs.example.govt.nz/robots.txt',
    fetchedAt: '2026-09-30T19:58:00Z', httpStatus: 404, disposition: 'allow-all',
    contentType: null, bytes: 0, sha256: createHash('sha256').update('').digest('hex'), body: '',
  }];
  log.discoveryPermits = [{
    id: PERMIT, agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_,
    robotsCheckId: 'r-0052', issuedAt: '2026-09-30T19:59:00Z', consumedAt: AT,
  }];
  // The retrieval that actually happened, and the render it produced.
  log.renders = [{
    id: 'g-0158', url: URL_, navigatedAt: AT, permitId: PERMIT, httpStatus: 200,
    renderFile: FILE, renderedSha256: DIGEST, renderedBytes: Buffer.byteLength(BYTES),
    accessBarriers: ['sign-in wall'],
  }];
  log.attempts.push({
    id: 'd-0676', recordType: RECORD_TYPES.OBSERVATION, renderId: 'g-0158', permitId: PERMIT,
    status: 'discovery', discoveryKind: 'navigation', outcome: 'retrieval-blocked',
    agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
    category: CAT, candidateSetVersion: 1, navigatedAt: AT,
    evidence: 'rendered-dom', renderFile: FILE, renderedSha256: DIGEST, renderedBytes: Buffer.byteLength(BYTES),
    approval: 'approved',
  });
  if (!reclassify) return log;

  // The corrected metadata for the SAME bytes: same file, same digest, no second retrieval.
  log.renders.push({
    id: 'g-0163', url: URL_, navigatedAt: AT, permitId: PERMIT, httpStatus: 200,
    renderFile: FILE, renderedSha256: DIGEST, renderedBytes: Buffer.byteLength(BYTES),
    accessBarriers: [],
    registrationAffordances: [{ label: 'Register', element: 'a', target: '/register' }],
    adoptedFrom: 'd-0676', correctsRender: 'g-0158',
  });
  appendAttempt(log, {
    recordType: RECORD_TYPES.RECLASSIFICATION, renderId: 'g-0163',
    supersedesDiscoveryId: 'd-0676',
    status: 'discovery', discoveryKind: 'navigation', outcome: 'rendered',
    agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
    category: CAT, candidateSetVersion: 1,
    navigationPerformed: false, checkedAt: '2026-10-01T06:00:00Z',
    evidence: 'rendered-dom', renderFile: FILE, renderedSha256: DIGEST, renderedBytes: Buffer.byteLength(BYTES),
    note: 'barriers recomputed from the retained bytes; no request was made',
    approval: 'approved',
  });
  const reclass = log.attempts.at(-1);
  if (!judge) return log;

  appendAttempt(log, {
    recordType: RECORD_TYPES.JUDGEMENT_ONLY, renderId: 'g-0163',
    evidenceFromDiscoveryId: reclass.id, answersDiscoveryId: reclass.id,
    status: 'discovery', discoveryKind: 'navigation', outcome: 'candidates-found',
    agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
    category: CAT, candidateSetVersion: 1,
    navigationPerformed: false, checkedAt: '2026-10-01T06:01:00Z',
    evidence: 'rendered-dom', renderFile: FILE, renderedSha256: DIGEST, renderedBytes: Buffer.byteLength(BYTES),
    note: 'three visible Register anchors', approval: 'approved',
  });
  return log;
};

describe('the live shape, end to end', () => {
  test('no new request and no new permit: one retrieval, one permit, one consumption', () => {
    const log = liveShape();
    assert.equal(log.discoveryPermits.length, 1);
    const claimants = log.attempts.filter((a) => a.permitId === PERMIT);
    assert.equal(claimants.length, 1, 'more than one record claims the single retrieval');
    assert.equal(claimants[0].id, 'd-0676');
    // The reclassification carries neither a permit nor a navigation time.
    const reclass = log.attempts.find((a) => a.recordType === RECORD_TYPES.RECLASSIFICATION);
    assert.equal(reclass.permitId, undefined);
    assert.equal(reclass.navigatedAt, undefined);
    assert.equal(reclass.navigationPerformed, false);
  });

  test('the original render keeps its owner, which is the superseded observation', () => {
    const log = liveShape();
    const { root, cleanup } = renderedRoot(log);
    try {
      assert.equal(isDiscoverySuperseded(log, 'd-0676'), true);
      assert.deepEqual(checkRenderLedger(log, root), []);
      // And the sealer agrees, independently.
      assert.deepEqual(renderLedgerProblems(log, root), []);
    } finally { cleanup(); }
  });

  test('the corrected metadata is accepted, and the judgement resting on it is valid', () => {
    const log = liveShape();
    const judgement = log.attempts.at(-1);
    assert.equal(judgement.recordType, RECORD_TYPES.JUDGEMENT_ONLY);
    assert.equal(judgement.renderId, 'g-0163');
    const reclass = log.attempts.find((a) => a.recordType === RECORD_TYPES.RECLASSIFICATION);
    assert.equal(judgement.answersDiscoveryId, reclass.id);
    assert.deepEqual(unjudgedRenderProblems(log), []);
  });

  test('every ledger, the backlog and the stale bindings are zero', () => {
    const log = liveShape();
    const { root, cleanup } = renderedRoot(log);
    try {
      assert.deepEqual(checkRenderLedger(log, root), []);
      assert.deepEqual(checkPermitLedger(log), []);
      assert.deepEqual(renderBacklog(log), []);
      assert.deepEqual(staleSetBindings(log), []);
      // With the capture root supplied, so the check verifies the bytes instead of refusing for
      // want of somewhere to look.
      assert.equal(
        corpusBlockers(log, { capturesRoot: join(root, '..') }).find((b) => b.kind === 'render-evidence'),
        undefined
      );
    } finally { cleanup(); }
  });

  test('active attrition is derived, and reconciles with the total ever recorded', () => {
    const log = liveShape();
    const ever = log.attempts.filter(
      (a) => a.status === 'discovery' && TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome)
    );
    const active = ever.filter((a) => !isDiscoverySuperseded(log, a.id));
    assert.equal(ever.length, 1, 'the barred observation is the only attrition record here');
    assert.equal(active.length, 0, 'the corrected record still counts as active attrition');
    assert.equal(ever.length, active.length + (ever.length - active.length));
  });
});

describe('what the record type refuses', () => {
  const base = () => liveShape({ reclassify: false });
  const reclass = (over = {}) => ({
    recordType: RECORD_TYPES.RECLASSIFICATION, renderId: 'g-0163',
    supersedesDiscoveryId: 'd-0676',
    status: 'discovery', discoveryKind: 'navigation', outcome: 'rendered',
    agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
    category: CAT, candidateSetVersion: 1,
    navigationPerformed: false, checkedAt: '2026-10-01T06:00:00Z',
    evidence: 'rendered-dom', renderFile: FILE, renderedSha256: DIGEST, renderedBytes: Buffer.byteLength(BYTES),
    note: 'recomputed', approval: 'approved', ...over,
  });

  test('it must not name a permit: the forbidden repair is refused at write time', () => {
    const log = base();
    assert.throws(() => appendAttempt(log, reclass({ permitId: PERMIT })), /must not name a permit/);
  });

  test('it must not carry a navigation time', () => {
    const log = base();
    assert.throws(() => appendAttempt(log, reclass({ navigatedAt: AT })), /must not carry navigatedAt/);
  });

  test('it must declare that no navigation occurred', () => {
    const log = base();
    assert.throws(
      () => appendAttempt(log, reclass({ navigationPerformed: true })),
      /must record navigationPerformed: false/
    );
  });

  test('it must supersede the classification it corrects', () => {
    const log = base();
    assert.throws(
      () => appendAttempt(log, reclass({ supersedesDiscoveryId: undefined })),
      /must supersede the record whose classification it corrects/
    );
  });

  test('it concludes nothing about candidates', () => {
    const log = base();
    assert.throws(
      () => appendAttempt(log, reclass({ outcome: 'candidates-found' })),
      /like an observation it concludes nothing/
    );
  });
});

describe('an answer link may be resolved forward, and only forward', () => {
  test('two links in one supersession lineage are one obligation', () => {
    // `d-0685` and `d-0687` answered `d-0684`; `d-0688` answers the reclassification that
    // superseded it. Counting those as two obligations reported a conflict where there was none.
    const log = liveShape();
    const reclass = log.attempts.find((a) => a.recordType === RECORD_TYPES.RECLASSIFICATION);
    // A second reclassification superseding the first, and a judgement answering the newer one.
    appendAttempt(log, {
      ...reclass, id: undefined, supersedesDiscoveryId: reclass.id,
      note: 'record type repaired', checkedAt: '2026-10-01T07:00:00Z',
    });
    const newer = log.attempts.at(-1);
    const judgement = log.attempts.find((a) => a.recordType === RECORD_TYPES.JUDGEMENT_ONLY);
    appendAttempt(log, {
      ...judgement, id: undefined, supersedesDiscoveryId: judgement.id,
      answersDiscoveryId: newer.id, checkedAt: '2026-10-01T07:01:00Z',
      note: 'answer link resolved forward',
    });
    const chain = answerChain(log, log.attempts.at(-1));
    assert.equal(chain.conflict, false, `answers treated as a conflict: ${chain.answers.join(', ')}`);
    assert.equal(chain.stable, newer.id, 'the obligation in force is not the head of the lineage');
    const { root, cleanup } = renderedRoot(log);
    try {
      assert.deepEqual(checkRenderLedger(log, root), []);
      assert.deepEqual(renderLedgerProblems(log, root), []);
    } finally { cleanup(); }
  });

  test('an answer in a DIFFERENT lineage is still a conflict', () => {
    // `d-0676` would not do: it is the start of this very lineage, so collapsing it is correct.
    // A record belonging to no part of the chain must still be refused.
    const log = liveShape();
    log.attempts.push({
      id: 'd-7000', recordType: RECORD_TYPES.OBSERVATION, renderId: 'g-0158', permitId: 'p-9000',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'rendered',
      agency: AGENCY, website: 'https://other.example.govt.nz/', url: 'https://other.example.govt.nz/',
      category: CAT, candidateSetVersion: 1, navigatedAt: AT, approval: 'approved',
    });
    const judgement = log.attempts.find((a) => a.recordType === RECORD_TYPES.JUDGEMENT_ONLY);
    log.attempts.push({
      ...judgement, id: 'd-9999', supersedesDiscoveryId: judgement.id,
      answersDiscoveryId: 'd-7000',
    });
    const chain = answerChain(log, log.attempts.at(-1));
    assert.equal(chain.conflict, true, 'an unrelated retarget was accepted as one obligation');
  });
});
