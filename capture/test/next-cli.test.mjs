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
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyLog, writeLog, recordCandidates, lockCandidateSet, approveCandidateSet,
  appendAttempt, ELIGIBILITY_CRITERIA, APPROVAL,
} from '../run.mjs';
import { parseDrawOrder } from '../selection.mjs';
import { prepareSet, addDiscovery } from './helpers.mjs';

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

/**
 * Recording a round that found nothing.
 *
 * selection-v1.0.4. Most agencies publish no form at all in most categories, so "this
 * round found nothing" is the commonest finding the scan produces - and it was expressible
 * only as `--add ""`, which worked by accident: the empty string was filtered away and left
 * an empty set behind. That made a genuine finding indistinguishable in the log from a
 * mistyped URL that happened to vanish, and it left `lock` refusing the set outright with
 * "no candidates recorded", which reads like the discovery was never done.
 */
describe('a round that found nothing is recordable and lockable', () => {
  const CAT = 'account-registration';

  /** Discovery happened and found nothing: the state most agencies are in. */
  const discoveryOnly = (log) => {
    addDiscovery(log, { agency, category: CAT, outcome: 'no-candidates' });
  };

  test('--none records an empty set, which then locks', async () => {
    await withLog(discoveryOnly, async (dir) => {
      const r = await run(['candidates', '--out', dir, '--agency', agency, '--category', CAT, '--none']);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /nil result declared at/);

      const locked = await run(['lock', '--out', dir, '--agency', agency, '--category', CAT]);
      assert.equal(locked.status, 0, locked.stderr);
      assert.match(locked.stdout, /locked 0 of 0/);

      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      const set = log.candidateSets[`${agency}\u0000${CAT}`];
      assert.deepEqual(set.discovered, []);
      assert.deepEqual(set.locked, []);
      assert.ok(set.lockedAt);
      // selection-v1.0.4: the emptiness is declared, not inferred from an empty array.
      assert.equal(set.candidateDeclaration, 'none');
      assert.ok(set.declaredAt);
      // Still bound to the round that produced it: an empty set must be evidenced too.
      assert.equal(set.discoveryRecordIds.length, 1);
    });
  });

  test('--add with no usable url is refused, and points at --none', async () => {
    await withLog(discoveryOnly, async (dir) => {
      const r = await run(['candidates', '--out', dir, '--agency', agency, '--category', CAT, '--add', '']);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /use --none/);
      // Nothing was created: the empty-string path must not still work by side effect.
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      assert.equal(log.candidateSets[`${agency}\u0000${CAT}`], undefined);
    });
  });

  test('--none and --add together are refused', async () => {
    await withLog(discoveryOnly, async (dir) => {
      const r = await run([
        'candidates', '--out', dir, '--agency', agency, '--category', CAT,
        '--none', '--add', 'https://w.govt.nz/a',
      ]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /cannot be combined with --add/);
    });
  });

  test('neither --add nor --none is refused', async () => {
    await withLog(discoveryOnly, async (dir) => {
      const r = await run(['candidates', '--out', dir, '--agency', agency, '--category', CAT]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /--add is required, or --none/);
    });
  });

  test('--add still records a real url', async () => {
    await withLog(discoveryOnly, async (dir) => {
      const r = await run([
        'candidates', '--out', dir, '--agency', agency, '--category', CAT,
        '--add', 'https://w.govt.nz/register',
      ]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /1 candidate URL\(s\) recorded/);
    });
  });
});

/**
 * The consistency checks, through the CLI.
 *
 * selection-v1.0.4. The library refuses these; these tests confirm the operator sees the
 * refusal rather than a stack trace, and that nothing is written on the way out.
 */
describe('the CLI refuses a set that contradicts its round', () => {
  const CAT = 'account-registration';
  const setKeyFor = () => `${agency}\u0000${CAT}`;

  test('--none is refused at lock when discovery reported candidates-found', async () => {
    await withLog(
      (log) => { addDiscovery(log, { agency, category: CAT, outcome: 'candidates-found' }); },
      async (dir) => {
        const declared = await run(['candidates', '--out', dir, '--agency', agency, '--category', CAT, '--none']);
        assert.equal(declared.status, 0, declared.stderr);

        const locked = await run(['lock', '--out', dir, '--agency', agency, '--category', CAT]);
        assert.equal(locked.status, 1);
        assert.match(locked.stderr, /report candidates-found/);

        const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
        assert.equal(log.candidateSets[setKeyFor()].lockedAt, null);
      }
    );
  });

  test('a candidate is refused at lock when discovery reported only no-candidates', async () => {
    await withLog(
      (log) => { addDiscovery(log, { agency, category: CAT, outcome: 'no-candidates' }); },
      async (dir) => {
        const added = await run([
          'candidates', '--out', dir, '--agency', agency, '--category', CAT,
          '--add', 'https://w.govt.nz/register',
        ]);
        assert.equal(added.status, 0, added.stderr);

        const locked = await run(['lock', '--out', dir, '--agency', agency, '--category', CAT]);
        assert.equal(locked.status, 1);
        assert.match(locked.stderr, /no discovery record for this round reports candidates-found/);

        const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
        assert.equal(log.candidateSets[setKeyFor()].lockedAt, null);
      }
    );
  });

  test('an undeclared empty set is refused at lock', async () => {
    await withLog(
      (log) => { addDiscovery(log, { agency, category: CAT, outcome: 'no-candidates' }); },
      async (dir) => {
        // Reach the state without the CLI, since the CLI no longer offers a way to make it.
        const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
        log.candidateSets[setKeyFor()] = {
          agency, category: CAT, version: 1, discovered: [], locked: [], lockedAt: null,
          approval: 'pending',
        };
        writeFileSync(join(dir, 'capture-log.json'), `${JSON.stringify(log, null, 2)}\n`, 'utf8');

        const locked = await run(['lock', '--out', dir, '--agency', agency, '--category', CAT]);
        assert.equal(locked.status, 1);
        assert.match(locked.stderr, /no candidates and no nil declaration/);
      }
    );
  });
});
