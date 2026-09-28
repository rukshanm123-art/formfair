/**
 * One render-ledger rule set, two implementations, checked against each other.
 *
 * solo-protocol-v1.0.7. `evaluation/` must not import `capture/`, so the render-ledger rules exist
 * twice. The protocol claimed a shared validator while the sealer in fact carried a weaker second
 * implementation: it verified bytes and URLs and none of the semantics, so a judgement resting on a
 * challenge document, or naming the wrong evidence source, or answering another agency's record,
 * sealed cleanly. Duplication is only safe if it is checked, so every case below is driven through
 * BOTH and required to agree on whether the ledger is acceptable.
 *
 * The verdicts are compared, not the wording. Two packages phrasing one problem differently is fine;
 * two packages disagreeing about whether it IS a problem is the defect this exists to catch.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderLedgerProblems } from '../descriptive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const capture = await import(pathToFileURL(join(repo, 'capture', 'run.mjs')).href);

const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const HTML = '<html><body><input id="q7" type="text"></body></html>';

/** A ledger that both implementations must accept. */
function clean() {
  return {
    discoveryPermits: [{
      id: 'p-0001', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
      issuedAt: '2026-09-26T18:58:00Z', consumedAt: '2026-09-26T19:00:00Z',
    }],
    renders: [{
      id: 'g-0001', url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T19:00:00Z',
      permitId: 'p-0001', renderFile: 'g1.html',
      renderedSha256: sha256(HTML), renderedBytes: Buffer.byteLength(HTML),
      accessBarriers: [],
    }],
    attempts: [
      {
        id: 'd-0001', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'rendered', recordType: 'observation',
        renderId: 'g-0001', permitId: 'p-0001', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T19:00:00Z', approval: 'approved',
      },
      {
        id: 'd-0002', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'candidates-found', recordType: 'judgement-only',
        renderId: 'g-0001', evidenceFromDiscoveryId: 'd-0001', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigationPerformed: false,
        checkedAt: '2026-09-26T19:01:00Z', approval: 'approved',
      },
    ],
  };
}

/**
 * A clean headless-barred / headed-successful fallback pair, appended to the clean ledger.
 *
 * selection-v1.0.33 / solo-protocol-v1.0.14. Three attacks against a SUCCESSFUL headed render left
 * both validators silent: deleting `followsDiscoveryId`, pointing it at a record for another page,
 * and deleting `attemptedModes`. The relationship was checked where it was written and once more when
 * `renderBarred` made it terminal - never when a successful headed render was relied on.
 */
const BARRED = '<html><head><title>Just a moment...</title></head><body>challenge</body></html>';
const PAGE = '<html><head><title>Feedback</title></head><body><input id="n" type="text"></body></html>';

function withFallback(l) {
  l.discoveryPermits.push(
    {
      id: 'p-0010', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/barred', robotsCheckId: 'r-0001',
      issuedAt: '2026-09-28T04:00:00Z', consumedAt: '2026-09-28T04:00:20Z',
    },
    {
      id: 'p-0011', agency: 'A', category: 'service-application', candidateSetVersion: 1,
      url: 'https://a.govt.nz/barred', robotsCheckId: 'r-0001',
      issuedAt: '2026-09-28T04:00:30Z', consumedAt: '2026-09-28T04:00:50Z',
    }
  );
  l.renders.push(
    {
      id: 'g-0010', url: 'https://a.govt.nz/barred', navigatedAt: '2026-09-28T04:00:10Z',
      permitId: 'p-0010', renderFile: 'barred.html', renderedSha256: sha256(BARRED),
      renderedBytes: Buffer.byteLength(BARRED), httpStatus: 403, browserMode: 'headless',
      accessBarriers: ['http 403', 'cloudflare interstitial'],
    },
    {
      id: 'g-0011', url: 'https://a.govt.nz/barred', navigatedAt: '2026-09-28T04:00:40Z',
      permitId: 'p-0011', renderFile: 'page.html', renderedSha256: sha256(PAGE),
      renderedBytes: Buffer.byteLength(PAGE), httpStatus: 200, browserMode: 'headed',
      accessBarriers: [],
    }
  );
  l.attempts.push(
    {
      id: 'd-0100', agency: 'A', category: 'service-application', status: 'discovery',
      discoveryKind: 'navigation', outcome: 'retrieval-blocked', recordType: 'observation',
      renderId: 'g-0010', permitId: 'p-0010', candidateSetVersion: 1,
      url: 'https://a.govt.nz/barred', navigatedAt: '2026-09-28T04:00:10Z', approval: 'approved',
      accessBarriers: ['http 403', 'cloudflare interstitial'],
      attemptedModes: [{ browserMode: 'headless', httpStatus: 403, accessBarriers: ['http 403', 'cloudflare interstitial'] }],
    },
    {
      id: 'd-0101', agency: 'A', category: 'service-application', status: 'discovery',
      discoveryKind: 'navigation', outcome: 'rendered', recordType: 'observation',
      renderId: 'g-0011', permitId: 'p-0011', candidateSetVersion: 1,
      url: 'https://a.govt.nz/barred', navigatedAt: '2026-09-28T04:00:40Z', approval: 'approved',
      followsDiscoveryId: 'd-0100', accessBarriers: [],
      attemptedModes: [
        { browserMode: 'headless', httpStatus: 403, accessBarriers: ['http 403', 'cloudflare interstitial'] },
        { browserMode: 'headed', httpStatus: 200, accessBarriers: [] },
      ],
    }
  );
  return l;
}

/** Each case mutates the clean ledger; `acceptable` says what both must conclude. */
const CASES = [
  { name: 'the clean ledger', acceptable: true, mutate: () => {} },

  // Path confinement. Both implementations joined the file name straight onto the directory.
  {
    name: 'ESCAPE: a render file reaching out of rendered/',
    acceptable: false,
    mutate: (l) => { l.renders[0].renderFile = '../captures/health-govt-nz-feedback.html'; },
  },
  {
    name: 'ESCAPE: a deeper traversal',
    acceptable: false,
    mutate: (l) => { l.renders[0].renderFile = '../../../../etc/hosts'; },
  },
  {
    name: 'ESCAPE: an absolute path',
    acceptable: false,
    mutate: (l) => { l.renders[0].renderFile = '/etc/hosts'; },
  },
  {
    name: 'ESCAPE: a nested path inside rendered/',
    acceptable: false,
    mutate: (l) => { l.renders[0].renderFile = 'sub/g1.html'; },
  },
  {
    name: 'ESCAPE: a traversal on a pre-registry record',
    acceptable: false,
    mutate: (l) => {
      l.renders = [];
      l.attempts[0].renderId = undefined;
      l.attempts[0].renderFile = '../captures/x.html';
      l.attempts[0].renderedSha256 = sha256(HTML);
      l.attempts[0].renderedBytes = Buffer.byteLength(HTML);
      l.attempts[1].renderId = undefined;
    },
  },

  // Bytes.
  { name: 'a wrong digest', acceptable: false, mutate: (l) => { l.renders[0].renderedSha256 = sha256('other'); } },
  { name: 'a wrong byte count', acceptable: false, mutate: (l) => { l.renders[0].renderedBytes = 99; } },
  { name: 'a missing file', acceptable: false, mutate: (l) => { l.renders[0].renderFile = 'absent.html'; } },

  // Semantics the sealer used to ignore entirely.
  {
    name: 'SEMANTIC: a judgement resting on an access-barred render',
    acceptable: false,
    mutate: (l) => { l.renders[0].accessBarriers = ['cloudflare interstitial']; },
  },
  {
    name: 'SEMANTIC: a judgement naming an evidence source that did not introduce the render',
    acceptable: false,
    mutate: (l) => {
      l.attempts.push({
        id: 'd-0003', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T18:00:00Z', approval: 'approved',
      });
      l.attempts[1].evidenceFromDiscoveryId = 'd-0003';
    },
  },
  {
    name: 'SEMANTIC: a judgement with no evidence source at all',
    acceptable: false,
    mutate: (l) => { delete l.attempts[1].evidenceFromDiscoveryId; },
  },
  {
    name: 'SEMANTIC: a judgement citing a render of another page',
    acceptable: false,
    mutate: (l) => { l.attempts[1].url = 'https://a.govt.nz/elsewhere'; },
  },
  {
    name: 'SEMANTIC: a record citing a render without saying which kind it is',
    acceptable: false,
    mutate: (l) => { delete l.attempts[1].recordType; },
  },
  {
    name: 'SEMANTIC: two active observations of one render',
    acceptable: false,
    mutate: (l) => {
      l.attempts.push({ ...l.attempts[0], id: 'd-0004', navigatedAt: '2026-09-26T19:02:00Z' });
    },
  },
  {
    name: 'SEMANTIC: a render nothing observed and nothing adopted',
    acceptable: false,
    mutate: (l) => { l.attempts.shift(); l.attempts[0].evidenceFromDiscoveryId = 'd-0001'; },
  },
  {
    name: 'a render adopted from a record, with no observation, is fine',
    acceptable: true,
    mutate: (l) => {
      l.renders[0].adoptedFrom = 'd-0001';
      l.attempts[0].recordType = undefined;
      l.attempts[0].renderId = undefined;
      l.attempts[0].outcome = 'no-candidates';
      l.attempts[0].renderFile = 'g1.html';
      l.attempts[0].renderedSha256 = sha256(HTML);
      l.attempts[0].renderedBytes = Buffer.byteLength(HTML);
    },
  },
  {
    name: 'SEMANTIC: a citation to a render that does not exist',
    acceptable: false,
    mutate: (l) => { l.attempts[1].renderId = 'g-9999'; },
  },

  // Answering another agency's work: the shared third-party form case.
  {
    name: 'ANSWERS: another agency’s record for the same page',
    acceptable: false,
    mutate: (l) => {
      l.attempts.push({
        id: 'd-0005', agency: 'B', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T18:00:00Z', approval: 'approved',
      });
      l.attempts[1].answersDiscoveryId = 'd-0005';
    },
  },
  {
    name: 'ANSWERS: a record in another round',
    acceptable: false,
    mutate: (l) => {
      l.attempts.push({
        id: 'd-0006', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 2,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T18:00:00Z', approval: 'approved',
      });
      l.attempts[1].answersDiscoveryId = 'd-0006';
    },
  },
  {
    name: 'ANSWERS: a record for a different page',
    acceptable: false,
    mutate: (l) => {
      l.attempts.push({
        id: 'd-0007', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/other', navigatedAt: '2026-09-26T18:00:00Z', approval: 'approved',
      });
      l.attempts[1].answersDiscoveryId = 'd-0007';
    },
  },
  {
    name: 'ANSWERS: this agency’s own record, in its own round, for this page',
    acceptable: true,
    mutate: (l) => {
      l.attempts.push({
        id: 'd-0008', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T18:00:00Z', approval: 'approved',
      });
      l.attempts[1].answersDiscoveryId = 'd-0008';
    },
  },
  {
    name: 'ANSWERS: a record that does not exist',
    acceptable: false,
    mutate: (l) => { l.attempts[1].answersDiscoveryId = 'd-9999'; },
  },

  // selection-v1.0.27 / solo-protocol-v1.0.8. The rule both implementations agreed on was
  // incomplete: `recordType` was checked for a recognised word and not for what that type may
  // contain. A conformance test cannot find that by itself - two implementations agreeing on an
  // incomplete rule agree perfectly - so these cases pin the contents of each type.
  {
    name: 'TYPE: THE ATTACK - a judgement relabelled as an observation, evidence source removed',
    acceptable: false,
    mutate: (l) => {
      l.attempts[1].recordType = 'observation';
      delete l.attempts[1].evidenceFromDiscoveryId;
      l.attempts[1].answersDiscoveryId = 'd-0001';
    },
  },
  {
    name: 'TYPE: an observation concluding candidates-found',
    acceptable: false,
    mutate: (l) => { l.attempts[0].outcome = 'candidates-found'; },
  },
  {
    name: 'TYPE: an observation claiming no navigation occurred',
    acceptable: false,
    mutate: (l) => { l.attempts[0].navigationPerformed = false; delete l.attempts[0].navigatedAt; },
  },
  {
    name: 'TYPE: an observation with no navigation timestamp',
    acceptable: false,
    mutate: (l) => { delete l.attempts[0].navigatedAt; },
  },
  {
    name: 'TYPE: an observation with no permit',
    acceptable: false,
    mutate: (l) => { delete l.attempts[0].permitId; l.renders[0].permitId = undefined; },
  },
  {
    name: 'TYPE: an observation naming an unconsumed permit',
    acceptable: false,
    mutate: (l) => { l.discoveryPermits[0].consumedAt = null; },
  },
  {
    name: 'TYPE: an observation naming an evidence source',
    acceptable: false,
    mutate: (l) => { l.attempts[0].evidenceFromDiscoveryId = 'd-0002'; },
  },
  {
    name: 'TYPE: an observation answering a record',
    acceptable: false,
    mutate: (l) => { l.attempts[0].answersDiscoveryId = 'd-0002'; },
  },
  {
    name: 'TYPE: a judgement recording an attrition outcome',
    acceptable: false,
    mutate: (l) => { l.attempts[1].outcome = 'retrieval-blocked'; },
  },
  {
    name: 'TYPE: a judgement claiming a permit',
    acceptable: false,
    mutate: (l) => { l.attempts[1].permitId = 'p-0001'; },
  },
  {
    name: 'TYPE: a judgement that does not say it navigated nothing',
    acceptable: false,
    mutate: (l) => { l.attempts[1].navigationPerformed = true; },
  },
  {
    name: 'TYPE: a judgement resolving two different records at once',
    acceptable: false,
    mutate: (l) => {
      l.attempts.push({
        id: 'd-0020', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T18:00:00Z', approval: 'approved',
      });
      l.attempts.push({
        id: 'd-0021', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T18:01:00Z', approval: 'approved',
      });
      l.attempts[1].answersDiscoveryId = 'd-0020';
      l.attempts[1].supersedesDiscoveryId = 'd-0021';
    },
  },

  // The registry's permit.
  {
    name: 'PERMIT: a render naming a permit that authorised another page',
    acceptable: false,
    mutate: (l) => { l.discoveryPermits[0].url = 'https://a.govt.nz/elsewhere'; },
  },
  {
    name: 'PERMIT: a render naming a permit that does not exist',
    acceptable: false,
    mutate: (l) => { l.renders[0].permitId = 'p-9999'; },
  },
  {
    name: 'PERMIT: a render naming a permit other than the one its observation used',
    acceptable: false,
    mutate: (l) => {
      l.discoveryPermits.push({
        id: 'p-0002', agency: 'A', category: 'service-application', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', robotsCheckId: 'r-0001',
        issuedAt: '2026-09-26T18:58:00Z', consumedAt: '2026-09-26T19:00:00Z',
      });
      l.renders[0].permitId = 'p-0002';
    },
  },

  // One authority for the bytes.
  {
    name: 'AUTHORITY: a record carrying a digest that disagrees with the registry',
    acceptable: false,
    mutate: (l) => { l.attempts[1].renderedSha256 = '0'.repeat(64); },
  },
  {
    name: 'AUTHORITY: a record carrying a byte count that disagrees with the registry',
    acceptable: false,
    mutate: (l) => { l.attempts[1].renderedBytes = 1; },
  },
  {
    name: 'AUTHORITY: a record carrying a file name that disagrees with the registry',
    acceptable: false,
    mutate: (l) => { l.attempts[1].renderFile = 'other.html'; },
  },
  // selection-v1.0.29 / solo-protocol-v1.0.11. The flag that discharges a backlog obligation. Adding
  // `renderRefused: true` to an ordinary record removed it from the backlog with both ledgers silent.
  {
    name: 'REFUSAL: the bare boolean with no chain, permit or navigation',
    acceptable: false,
    mutate: (l) => { l.attempts[1].renderRefused = true; },
  },
  {
    name: 'REFUSAL: renderRefused: false is not a value',
    acceptable: false,
    mutate: (l) => { l.attempts[0].renderRefused = false; },
  },
  {
    name: 'REFUSAL: a chain that does not start at the record\u2019s own URL',
    acceptable: false,
    mutate: (l) => {
      l.attempts[0].renderRefused = true;
      l.attempts[0].redirectChain = [{ from: 'https://a.govt.nz/other', to: 'https://a.govt.nz/no', httpStatus: 302, allowed: false }];
    },
  },
  {
    name: 'REFUSAL: a chain that is not continuous',
    acceptable: false,
    mutate: (l) => {
      l.attempts[0].renderRefused = true;
      l.attempts[0].redirectChain = [
        { from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/one', httpStatus: 302, allowed: true },
        { from: 'https://a.govt.nz/elsewhere', to: 'https://a.govt.nz/no', httpStatus: 302, allowed: false },
      ];
    },
  },
  {
    name: 'REFUSAL: a chain whose last hop was allowed',
    acceptable: false,
    mutate: (l) => {
      l.attempts[0].renderRefused = true;
      l.attempts[0].redirectChain = [{ from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/fine', httpStatus: 302, allowed: true }];
    },
  },
  {
    name: 'REFUSAL: a permit for a different page',
    acceptable: false,
    mutate: (l) => {
      l.attempts[0].renderRefused = true;
      l.attempts[0].redirectChain = [{ from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/no', httpStatus: 302, allowed: false }];
      l.discoveryPermits[0].url = 'https://a.govt.nz/elsewhere';
    },
  },
  {
    name: 'REFUSAL: a well-formed one is accepted',
    acceptable: true,
    mutate: (l) => {
      l.attempts[0].renderRefused = true;
      l.attempts[0].redirectChain = [{ from: 'https://a.govt.nz/apply', to: 'https://a.govt.nz/no', httpStatus: 302, allowed: false, reason: 'Disallow: /no' }];
    },
  },
  // The headed fallback relationship, at trust time.
  {
    name: 'FALLBACK: a clean headless-barred / headed-successful pair is accepted',
    acceptable: true,
    mutate: (l) => { withFallback(l); },
  },
  {
    name: 'FALLBACK: THE ATTACK - followsDiscoveryId deleted from a successful headed render',
    acceptable: false,
    mutate: (l) => { withFallback(l); delete l.attempts[3].followsDiscoveryId; },
  },
  {
    name: 'FALLBACK: THE ATTACK - it follows a record for another page, category and round',
    acceptable: false,
    mutate: (l) => { withFallback(l); l.attempts[3].followsDiscoveryId = 'd-0001'; },
  },
  {
    name: 'FALLBACK: THE ATTACK - attemptedModes deleted',
    acceptable: false,
    mutate: (l) => { withFallback(l); delete l.attempts[3].attemptedModes; },
  },
  {
    name: 'FALLBACK: attemptedModes disagreeing with the renders it summarises',
    acceptable: false,
    mutate: (l) => { withFallback(l); l.attempts[3].attemptedModes[1].accessBarriers = ['http 403']; },
  },
  {
    name: 'FALLBACK: two active followers of one barred attempt',
    acceptable: false,
    mutate: (l) => {
      withFallback(l);
      l.attempts.push({ ...l.attempts[3], id: 'd-0102', renderId: 'g-0011' });
    },
  },
  {
    name: 'FALLBACK: a HEADLESS observation claiming to follow another',
    acceptable: false,
    mutate: (l) => { withFallback(l); l.renders[2].browserMode = 'headed'; l.renders[1].browserMode = 'headless'; l.attempts[2].followsDiscoveryId = 'd-0001'; },
  },
  {
    name: 'FALLBACK: the wrong browser mode on the predecessor',
    acceptable: false,
    mutate: (l) => { withFallback(l); l.renders[1].browserMode = 'headed'; },
  },
  {
    name: 'FALLBACK: following an attempt that was not barred',
    acceptable: false,
    mutate: (l) => { withFallback(l); l.attempts[2].outcome = 'rendered'; l.renders[1].accessBarriers = []; },
  },
  {
    name: 'FALLBACK: a sign-in wall does not warrant a headed retry',
    acceptable: false,
    mutate: (l) => {
      withFallback(l);
      l.renders[1].accessBarriers = ['sign-in wall'];
      l.attempts[2].accessBarriers = ['sign-in wall'];
      l.attempts[2].attemptedModes = [{ browserMode: 'headless', httpStatus: 403, accessBarriers: ['sign-in wall'] }];
      l.attempts[3].attemptedModes[0].accessBarriers = ['sign-in wall'];
    },
  },
  {
    name: 'FALLBACK: both attempts sharing one permit',
    acceptable: false,
    mutate: (l) => { withFallback(l); l.attempts[3].permitId = 'p-0010'; l.renders[2].permitId = 'p-0010'; },
  },
  {
    name: 'FALLBACK: the headed permit issued before the headless attempt was recorded',
    acceptable: false,
    mutate: (l) => { withFallback(l); l.discoveryPermits[2].issuedAt = '2026-09-28T04:00:05Z'; },
  },
  {
    name: 'FALLBACK: the headed attempt navigating before the one it follows',
    acceptable: false,
    mutate: (l) => {
      withFallback(l);
      l.attempts[3].navigatedAt = '2026-09-28T04:00:05Z';
      l.renders[2].navigatedAt = '2026-09-28T04:00:05Z';
    },
  },
  {
    name: 'AUTHORITY: a copy that MATCHES the registry is fine',
    acceptable: true,
    mutate: (l) => {
      l.attempts[1].renderFile = l.renders[0].renderFile;
      l.attempts[1].renderedSha256 = l.renders[0].renderedSha256;
      l.attempts[1].renderedBytes = l.renders[0].renderedBytes;
    },
  },

  // Withdrawn records. A superseded judgement's citation was withdrawn with it; holding it to the
  // rule would make every correction a permanent publication block.
  {
    name: 'WITHDRAWN: a superseded judgement with a wrong evidence source is history, not a defect',
    acceptable: true,
    mutate: (l) => {
      l.attempts.push({
        id: 'd-0009', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T18:00:00Z', approval: 'approved',
      });
      l.attempts[1].evidenceFromDiscoveryId = 'd-0009';
      // ... and corrected by a later record that cites the right source.
      l.attempts.push({
        id: 'd-0010', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', recordType: 'judgement-only',
        renderId: 'g-0001', evidenceFromDiscoveryId: 'd-0001', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigationPerformed: false,
        checkedAt: '2026-09-26T19:05:00Z', approval: 'approved', supersedesDiscoveryId: 'd-0002',
      });
    },
  },
  {
    name: 'WITHDRAWN: but its bytes are still checked',
    acceptable: false,
    mutate: (l) => {
      l.renders = [];
      l.attempts[0].renderId = undefined;
      l.attempts[0].renderFile = 'g1.html';
      l.attempts[0].renderedSha256 = createHash('sha256').update('not the file').digest('hex');
      l.attempts[0].renderedBytes = 12;
      l.attempts[1].renderId = undefined;
      l.attempts[1].evidenceFromDiscoveryId = undefined;
      l.attempts[1].recordType = undefined;
      l.attempts.push({
        id: 'd-0011', agency: 'A', category: 'service-application', status: 'discovery',
        discoveryKind: 'navigation', outcome: 'no-candidates', candidateSetVersion: 1,
        url: 'https://a.govt.nz/apply', navigatedAt: '2026-09-26T19:30:00Z', approval: 'approved',
        supersedesDiscoveryId: 'd-0001',
      });
    },
  },
];

describe('the two render-ledger implementations agree', () => {
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const dir = mkdtempSync(join(tmpdir(), 'ff-conf-'));
      try {
        const renderedDir = join(dir, 'rendered');
        mkdirSync(renderedDir, { recursive: true });
        const ledger = clean();
        testCase.mutate(ledger);

        // The directory follows the ledger, as a real one does: every plain file name the mutated
        // ledger claims is written, and nothing else - so a case that does not use the fallback pair
        // does not inherit its bytes as orphans.
        const CONTENT = { 'g1.html': HTML, 'barred.html': BARRED, 'page.html': PAGE };
        const claimed = new Set([
          ...ledger.renders.map((r) => r.renderFile),
          ...ledger.attempts.map((a) => a.renderFile),
        ].filter((f) => typeof f === 'string' && f === basename(f)));
        for (const file of claimed) {
          if (CONTENT[file] !== undefined) writeFileSync(join(renderedDir, file), CONTENT[file]);
        }
        // `g1.html` is the digest every non-fallback case is written against, so it always exists.
        writeFileSync(join(renderedDir, 'g1.html'), HTML);

        const fromCapture = capture.checkRenderLedger(ledger, renderedDir);
        const fromSealer = renderLedgerProblems(ledger, renderedDir);

        assert.equal(
          fromCapture.length === 0, testCase.acceptable,
          `capture: ${testCase.acceptable ? 'should accept' : 'should refuse'} — ${fromCapture.join('; ') || '(no problems)'}`
        );
        assert.equal(
          fromSealer.length === 0, testCase.acceptable,
          `sealer: ${testCase.acceptable ? 'should accept' : 'should refuse'} — ${fromSealer.join('; ') || '(no problems)'}`
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test('the table is not vacuous, and is exactly the size the protocol claims', () => {
    const accepted = CASES.filter((c) => c.acceptable).length;
    const refused = CASES.filter((c) => !c.acceptable).length;
    assert.ok(accepted >= 3, 'some ledgers must be acceptable');
    assert.ok(refused >= 35, 'and most must be refused');

    // The Count erratum of 27 September 2026. Four published figures for this table were wrong -
    // 24, 26, twenty-one and 47 - because the table was checked by machine and its SIZE was
    // asserted from memory. A count printed in prose and checked by nobody is decoration, which is
    // the same objection this protocol makes to an unread digest. Update these numbers deliberately
    // when adding a case, and update the protocol with them.
    assert.equal(CASES.length, 64, 'the protocol states 64 conformance cases');
    assert.equal(refused, 57, 'the protocol states 57 refusal cases');
    assert.equal(accepted + refused, CASES.length, 'every case must state a verdict');
  });
});
