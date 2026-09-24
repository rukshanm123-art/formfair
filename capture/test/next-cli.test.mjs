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
