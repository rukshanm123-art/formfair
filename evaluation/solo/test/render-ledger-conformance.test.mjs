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
import { dirname, join } from 'node:path';
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
        writeFileSync(join(renderedDir, 'g1.html'), HTML);
        const ledger = clean();
        testCase.mutate(ledger);

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

  test('the table is not vacuous', () => {
    assert.ok(CASES.filter((c) => c.acceptable).length >= 3, 'some ledgers must be acceptable');
    assert.ok(CASES.filter((c) => !c.acceptable).length >= 35, 'and most must be refused');
  });
});
