/**
 * `next` must survive every state nextWork can return.
 *
 * It crashed on the first real invocation of the pilot: a locked set awaiting approval
 * returns no `pending` list, and the command read `work.pending.length` unconditionally.
 * It failed loudly rather than proceeding, which is the right direction for a gate - but a
 * command used to decide what to do next must not crash while deciding.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyLog, writeLog, recordCandidates, lockCandidateSet, approveCandidateSet,
  appendAttempt, ELIGIBILITY_CRITERIA, APPROVAL,
} from '../run.mjs';
import { parseDrawOrder } from '../selection.mjs';
import { prepareSet } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'cli-capture.mjs');
const drawOrder = parseDrawOrder(
  readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
);
const agency = drawOrder[0].agency;

const run = (args) =>
  new Promise((resolve) => {
    const child = spawn('node', [cli, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });

const withLog = async (build, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-next-'));
  try {
    const log = emptyLog();
    build(log);
    mkdirSync(join(dir, 'captures'), { recursive: true });
    writeLog(join(dir, 'capture-log.json'), log);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('next reports every state without crashing', () => {
  test('an empty log asks for discovery', async () => {
    await withLog(() => {}, async (dir) => {
      const r = await run(['next', '--out', dir]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /record discovered candidates/);
      assert.match(r.stdout, new RegExp(agency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  });

  test('a locked but unapproved set asks for approval - the branch that crashed', async () => {
    await withLog(
      (log) => {
        prepareSet(log, agency, 'account-registration', ['https://w.govt.nz/a'], { approve: false });
      },
      async (dir) => {
        const r = await run(['next', '--out', dir]);
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stderr, /Cannot read properties of undefined/);
        assert.match(r.stdout, /approves the locked candidate set/);
        assert.match(r.stdout, /https:\/\/w\.govt\.nz\/a/);
      }
    );
  });

  test('an approved set with unassessed candidates lists them', async () => {
    await withLog(
      (log) => {
        prepareSet(log, agency, 'account-registration', ['https://w.govt.nz/a']);
      },
      async (dir) => {
        const r = await run(['next', '--out', dir]);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /locked candidate\(s\) still without an outcome/);
      }
    );
  });

  test('a pending outcome reports what is blocking', async () => {
    await withLog(
      (log) => {
        prepareSet(log, agency, 'account-registration', ['https://w.govt.nz/a']);
        appendAttempt(log, {
          examinedAt: '2026-09-24T00:00:00Z', agency, website: 'https://w.govt.nz/',
          url: 'https://w.govt.nz/a', status: 'excluded', category: 'account-registration',
          exclusionReason: 'no personal-name field',
          eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
        });
      },
      async (dir) => {
        const r = await run(['next', '--out', dir]);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /resolve 1 outcome/);
        assert.match(r.stdout, /pending/);
      }
    );
  });

  test('forty approved captures reports the scan complete', async () => {
    await withLog(
      (log) => {
        for (let i = 0; i < 40; i++) {
          log.attempts.push({
            agency: drawOrder[i].agency, status: 'captured', approval: APPROVAL.APPROVED,
            category: 'account-registration', url: `https://w.govt.nz/${i}`,
          });
        }
      },
      async (dir) => {
        const r = await run(['next', '--out', dir]);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /nothing further: 40 agencies have qualified/);
      }
    );
  });
});

/**
 * `approve` must name a decision, not a page.
 *
 * capture-v1.0.3. Once a URL can carry a rejected attempt and its replacement, `--url`
 * identifies two records. It used to resolve with `.find`, which returns the FIRST - the
 * rejected one - so approving the rerun would silently have re-approved the failure it was
 * meant to replace, and the corpus would have been built from a decision nobody made.
 */
describe('approve identifies the attempt', () => {
  const el = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));
  const URL_ = 'https://w.govt.nz/contact';

  const failed = (extra = {}) => ({
    examinedAt: '2026-09-24T00:00:00Z', agency, website: 'https://w.govt.nz/', url: URL_,
    status: 'failed', category: 'enquiry-or-contact',
    exclusionReason: 'capture failed: Timeout 45000ms exceeded', eligibility: el(), ...extra,
  });

  /** One rejected failure plus its replacement, which is the pilot's actual situation. */
  const twoAttempts = (log) => {
    prepareSet(log, agency, 'enquiry-or-contact', [URL_]);
    appendAttempt(log, failed());
    const first = log.attempts.at(-1);
    first.approval = APPROVAL.REJECTED;
    first.approvalNote = 'harness defect, not a property of the page';
    appendAttempt(log, failed({
      examinedAt: '2026-09-24T00:10:00Z', status: 'excluded',
      exclusionReason: 'no personal-name field', supersedesAttemptId: first.id,
    }));
    return { first, second: log.attempts.at(-1) };
  };

  test('approval by url is refused once a url has more than one attempt', async () => {
    let ids;
    await withLog((log) => { ids = twoAttempts(log); }, async (dir) => {
      const r = await run(['approve', '--out', dir, '--url', URL_]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /2 attempts recorded/);
      // It must say which ids, or the refusal just blocks the work.
      assert.match(r.stderr, new RegExp(`--id ${ids.first.id}`));
      assert.match(r.stderr, new RegExp(`--id ${ids.second.id}`));
      // And it must not have approved anything on the way out.
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      assert.equal(log.attempts.find((a) => a.id === ids.first.id).approval, APPROVAL.REJECTED);
      assert.equal(log.attempts.find((a) => a.id === ids.second.id).approval, APPROVAL.PENDING);
    });
  });

  test('approval by id approves that attempt and leaves the rejected one rejected', async () => {
    let ids;
    await withLog((log) => { ids = twoAttempts(log); }, async (dir) => {
      const r = await run(['approve', '--out', dir, '--id', ids.second.id]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`approved: ${ids.second.id}`));
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      assert.equal(log.attempts.find((a) => a.id === ids.second.id).approval, APPROVAL.APPROVED);
      assert.equal(log.attempts.find((a) => a.id === ids.first.id).approval, APPROVAL.REJECTED);
    });
  });

  test('approval by url still works while a url has exactly one attempt', async () => {
    let id;
    await withLog(
      (log) => {
        prepareSet(log, agency, 'enquiry-or-contact', [URL_]);
        appendAttempt(log, failed());
        id = log.attempts.at(-1).id;
      },
      async (dir) => {
        const r = await run(['approve', '--out', dir, '--url', URL_, '--reject', '--reason', 'harness defect']);
        assert.equal(r.status, 0, r.stderr);
        const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
        assert.equal(log.attempts.find((a) => a.id === id).approval, APPROVAL.REJECTED);
        assert.equal(log.attempts.find((a) => a.id === id).approvalNote, 'harness defect');
      }
    );
  });

  test('an id that names no attempt is refused', async () => {
    await withLog((log) => { twoAttempts(log); }, async (dir) => {
      const r = await run(['approve', '--out', dir, '--id', 'c-9999']);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /no recorded attempt with id c-9999/);
    });
  });
});
