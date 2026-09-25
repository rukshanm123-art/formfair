/**
 * `next` must survive every state nextWork can return.
 *
 * It crashed on the first real invocation of the pilot: a locked set awaiting approval
 * returns no `pending` list, and the command read `work.pending.length` unconditionally.
 * It failed loudly rather than proceeding, which is the right direction for a gate - but a
 * command used to decide what to do next must not crash while deciding.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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
import { dispositionForStatus, evaluatePolicy } from '../robots-policy.mjs';

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

/**
 * An exclusion says which criterion it turns on.
 *
 * The first real document candidates - nine PDF and DOCX application forms across the first
 * two agencies - are all excluded for the same reason, that they are not HTML. Recording that
 * only as a sentence would make "how many candidates failed criterion five" a question the log
 * could not answer, although it is exactly the question this study's document-versus-web-form
 * finding rests on. `doCapture` already records `publiclyReachableWithoutSigningIn: false`
 * structurally; an exclusion had no equivalent.
 */
describe('exclude records the criterion that failed', () => {
  const CAT = 'service-application';
  const URL_ = 'https://w.govt.nz/form.pdf';

  const withSet = (log) => prepareSet(log, agency, CAT, [URL_]);

  test('--fails records that criterion as false and leaves the rest unknown', async () => {
    await withLog(withSet, async (dir) => {
      const r = await run([
        'exclude', '--out', dir, '--agency', agency, '--website', 'https://w.govt.nz/',
        '--url', URL_, '--category', CAT,
        '--reason', 'PDF, not HTML', '--fails', 'normalHtmlOrBrowserRenderedNotPdfOrNative',
      ]);
      assert.equal(r.status, 0, r.stderr);
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      const a = log.attempts.find((x) => x.url === URL_ && x.status === 'excluded');
      assert.equal(a.eligibility.normalHtmlOrBrowserRenderedNotPdfOrNative, false);
      // The others stay null: this exclusion establishes one thing, not five.
      assert.equal(a.eligibility.asksForTheNameOfANaturalPerson, null);
      assert.equal(a.eligibility.publiclyReachableWithoutSigningIn, null);
    });
  });

  test('an unknown criterion is refused, and the valid ones are listed', async () => {
    await withLog(withSet, async (dir) => {
      const r = await run([
        'exclude', '--out', dir, '--agency', agency, '--website', 'https://w.govt.nz/',
        '--url', URL_, '--category', CAT, '--reason', 'PDF', '--fails', 'notAcriterion',
      ]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /--fails must be one of/);
      assert.match(r.stderr, /normalHtmlOrBrowserRenderedNotPdfOrNative/);
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      assert.equal(log.attempts.filter((x) => x.status === 'excluded').length, 0);
    });
  });

  test('omitting --fails still records an exclusion, with every criterion unknown', async () => {
    // A robots exclusion turns on no eligibility criterion at all, so --fails is optional.
    await withLog(withSet, async (dir) => {
      const r = await run([
        'exclude', '--out', dir, '--agency', agency, '--website', 'https://w.govt.nz/',
        '--url', URL_, '--category', CAT, '--reason', 'robots.txt disallows this path',
      ]);
      assert.equal(r.status, 0, r.stderr);
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      const a = log.attempts.find((x) => x.url === URL_ && x.status === 'excluded');
      assert.ok(Object.values(a.eligibility).every((v) => v === null));
    });
  });
});

/**
 * `status` must not report nothing outstanding while something is.
 *
 * capture-v1.0.4. It counted pending ATTEMPTS only, so it printed `pending approval 0` at the
 * exact moment a locked candidate set was waiting for approval - the same attempts-versus-sets
 * confusion that let the corpus draft build while two corrections were mid-flight. An operator
 * reading that line would conclude the scan was clear.
 */
describe('status separates attempt approvals from candidate-set approvals', () => {
  const CAT = 'account-registration';

  test('a pending set is reported, and not folded into the attempt count', async () => {
    await withLog(
      (log) => { prepareSet(log, agency, CAT, ['https://w.govt.nz/a'], { approve: false }); },
      async (dir) => {
        const r = await run(['status', '--out', dir]);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /pending candidate-set approvals 1/);
        assert.match(r.stdout, /pending attempt approvals\s+0/);
        assert.match(r.stdout, new RegExp(`${CAT} v1`));
        assert.match(r.stdout, /1 item\(s\) outstanding; the corpus draft is withheld/);
        // The old single line must not be what reports this state.
        assert.doesNotMatch(r.stdout, /^pending approval 0$/m);
      }
    );
  });

  test('a rejected set awaiting supersession is reported', async () => {
    await withLog(
      (log) => {
        prepareSet(log, agency, CAT, ['https://w.govt.nz/a'], { approve: false });
        log.candidateSets[`${agency}\u0000${CAT}`].approval = APPROVAL.REJECTED;
      },
      async (dir) => {
        const r = await run(['status', '--out', dir]);
        assert.match(r.stdout, /rejected candidate sets awaiting supersession 1/);
        assert.match(r.stdout, /outstanding; the corpus draft is withheld/);
      }
    );
  });

  test('an all-clear log says nothing is outstanding', async () => {
    await withLog(
      (log) => { prepareSet(log, agency, CAT, ['https://w.govt.nz/a']); },
      async (dir) => {
        // The one locked candidate still needs an outcome, but no APPROVAL is outstanding -
        // which is what this line is about.
        const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
        for (const a of log.attempts) a.approval = APPROVAL.APPROVED;
        writeFileSync(join(dir, 'capture-log.json'), `${JSON.stringify(log, null, 2)}\n`, 'utf8');
        const r = await run(['status', '--out', dir]);
        assert.match(r.stdout, /nothing outstanding; the corpus draft is not withheld/);
      }
    );
  });
});


/**
 * The robots check happens before the request, not when the record is written.
 *
 * selection-v1.0.11, from three defects in v1.0.10.
 *
 * The check ran at record time, after the browsing had happened. It could refuse the record but
 * not the request, so it documented a breach rather than preventing one. A permit is now issued
 * before navigation and consumed by the record.
 *
 * The "NOT NAVIGATED" records still carried `navigatedAt` and were counted in the five-second
 * pacing, so the raw data asserted a navigation the note denied.
 *
 * And every response that was not 2xx was treated as permission. RFC 9309 distinguishes them: a
 * 4xx means unavailable and access is permitted (2.3.1.3), a 5xx or network failure means
 * unreachable and complete disallow is assumed (2.3.1.4). The previous test asserted that a
 * refused connection permits, which is exactly backwards.
 */
describe('discovery requires a permit issued before navigation', () => {
  const CAT = 'account-registration';
  let server;
  let origin;
  let hits;

  before(async () => {
    server = createServer((req, res) => {
      hits.push(req.url);
      if (req.url === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /search?\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>ok</body></html>');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server?.closeAllConnections?.(); server?.close(); });

  const preflight = (dir, url, method = 'internal-search') =>
    run(['preflight-discovery', '--out', dir, '--agency', agency, '--website', `${origin}/`,
      '--url', url, '--category', CAT, '--set-version', '1', '--method', method]);

  // Navigation times must fall after the permit and at least five seconds apart.
  let navTick = 0;
  const nextNav = () => new Date(Date.now() + (++navTick) * 6000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const record = (dir, url, outcome, method = 'internal-search', at = null) =>
    run(['discovery', '--out', dir, '--agency', agency, '--website', `${origin}/`, '--url', url,
      '--method', method, '--outcome', outcome, '--category', CAT,
      '--set-version', '1', '--navigated-at', at ?? nextNav()]);

  test('THE FIX: a disallowed target receives zero requests', async () => {
    await withLog(() => {}, async (dir) => {
      hits = [];
      const r = await preflight(dir, `${origin}/search?query=register`);
      assert.equal(r.status, 0, r.stderr);
      // robots.txt only. The target path was never requested.
      assert.deepEqual(hits, ['/robots.txt'], `unexpected requests: ${JSON.stringify(hits)}`);

      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      const a = log.attempts[0];
      assert.equal(a.outcome, 'disallowed');
      assert.equal(a.navigationPerformed, false);
      assert.ok(a.checkedAt);
      assert.equal(a.navigatedAt, undefined, 'a record that navigated nothing must carry no navigatedAt');
      assert.equal((log.discoveryPermits ?? []).length, 0, 'a forbidden URL gets no permit');
    });
  });

  test('a record with no permit is refused', async () => {
    await withLog(() => {}, async (dir) => {
      const r = await record(dir, `${origin}/contact`, 'no-candidates', 'navigation');
      assert.equal(r.status, 1);
      assert.match(r.stderr, /no open navigation permit/);
      assert.match(r.stderr, /before navigating/);
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      assert.equal(log.attempts.length, 0);
    });
  });

  test('a permit is single-use', async () => {
    await withLog(() => {}, async (dir) => {
      assert.equal((await preflight(dir, `${origin}/contact`, 'navigation')).status, 0);
      assert.equal((await record(dir, `${origin}/contact`, 'no-candidates', 'navigation')).status, 0);
      // A second record for the same URL must not ride the spent permit.
      const again = await run(['discovery', '--out', dir, '--agency', agency, '--website', `${origin}/`,
        '--url', `${origin}/contact`, '--method', 'navigation', '--outcome', 'no-candidates',
        '--category', CAT, '--set-version', '1', '--navigated-at', nextNav()]);
      assert.equal(again.status, 1);
      assert.match(again.stderr, /no open navigation permit/);
    });
  });

  test('a permit is specific to its URL and its round', async () => {
    await withLog(() => {}, async (dir) => {
      assert.equal((await preflight(dir, `${origin}/contact`, 'navigation')).status, 0);

      // Different URL, same round.
      const otherUrl = await record(dir, `${origin}/other`, 'no-candidates', 'navigation');
      assert.equal(otherUrl.status, 1, 'a permit for one page must not authorise another');

      // Same URL, different round.
      const otherRound = await run(['discovery', '--out', dir, '--agency', agency, '--website', `${origin}/`,
        '--url', `${origin}/contact`, '--method', 'navigation', '--outcome', 'no-candidates',
        '--category', CAT, '--set-version', '2', '--navigated-at', nextNav()]);
      assert.equal(otherRound.status, 1, 'a permit for one round must not authorise another');
    });
  });

  test('the robots policy is fetched once and reused across CLI calls', async () => {
    await withLog(() => {}, async (dir) => {
      hits = [];
      await preflight(dir, `${origin}/a`, 'navigation');
      await preflight(dir, `${origin}/b`, 'navigation');
      await preflight(dir, `${origin}/c`, 'navigation');
      const robotsRequests = hits.filter((u) => u === '/robots.txt').length;
      // Three one-shot invocations, one robots request: the per-process cache died with each
      // process and produced traffic no record described.
      assert.equal(robotsRequests, 1, `robots.txt requested ${robotsRequests} times`);
      const log = JSON.parse(readFileSync(join(dir, 'capture-log.json'), 'utf8'));
      assert.equal(log.robotsChecks.length, 1);
      assert.equal(log.robotsChecks[0].disposition, 'rules');
    });
  });

  test('a not-navigated record does not contribute to navigation pacing', async () => {
    await withLog(() => {}, async (dir) => {
      // The disallowed record carries no navigation time, so a navigation recorded immediately
      // afterwards is not measured against it.
      assert.equal((await preflight(dir, `${origin}/search?query=x`)).status, 0);
      assert.equal((await preflight(dir, `${origin}/contact`, 'navigation')).status, 0);
      const r = await record(dir, `${origin}/contact`, 'no-candidates', 'navigation');
      assert.equal(r.status, 0, r.stderr);
    });
  });
});

/**
 * RFC 9309 distinguishes an unavailable robots.txt from an unreachable one.
 */
describe('robots policy follows RFC 9309 status semantics', () => {
  test('4xx is unavailable: access is permitted', () => {
    for (const status of [401, 403, 404, 410]) {
      assert.equal(dispositionForStatus(status), 'allow-all', `HTTP ${status}`);
      const v = evaluatePolicy({ disposition: 'allow-all', httpStatus: status }, '/anything');
      assert.equal(v.allowed, true);
    }
  });

  test('5xx is unreachable: complete disallow is assumed', () => {
    for (const status of [500, 502, 503]) {
      assert.equal(dispositionForStatus(status), 'disallow-all', `HTTP ${status}`);
      const v = evaluatePolicy({ disposition: 'disallow-all', httpStatus: status }, '/anything');
      assert.equal(v.allowed, false);
      assert.match(v.reason, /2\.3\.1\.4/);
    }
  });

  test('a network failure is unreachable, not permissive', () => {
    // The previous test asserted the opposite, and was wrong.
    assert.equal(dispositionForStatus(null), 'disallow-all');
    const v = evaluatePolicy({ disposition: 'disallow-all', httpStatus: null }, '/anything');
    assert.equal(v.allowed, false);
    assert.match(v.reason, /could not be reached/);
  });

  test('robots.txt itself stays retrievable even under complete disallow', () => {
    // Otherwise an origin whose server failed once could never be re-checked.
    const v = evaluatePolicy({ disposition: 'disallow-all', httpStatus: 503 }, '/robots.txt');
    assert.equal(v.allowed, true);
  });

  test('2xx means the file governs, and its rules are applied', () => {
    assert.equal(dispositionForStatus(200), 'rules');
    const policy = { disposition: 'rules', httpStatus: 200, body: 'User-agent: *\nDisallow: /search?\n' };
    assert.equal(evaluatePolicy(policy, '/search?q=1').allowed, false);
    assert.equal(evaluatePolicy(policy, '/contact').allowed, true);
  });

  test('Tatai\'s 403 permits, which is why it is recorded as unavailable rather than forbidden', () => {
    assert.equal(dispositionForStatus(403), 'allow-all');
  });
});

/**
 * RFC 9309 section 2.2.2: "The /robots.txt URI is implicitly allowed."
 *
 * Found by running a real round: minhealthnz.shinyapps.io publishes `Disallow: /`, and the robots
 * inspection recorded ITSELF as disallowed and not navigated, while carrying a note describing
 * the file's contents that only reading it could supply. The rule never reached that URI; the
 * code was applying it where the RFC does not.
 */
describe('robots.txt is implicitly allowed', () => {
  test('a Disallow: / policy still permits its own path', () => {
    const policy = { disposition: 'rules', httpStatus: 200, body: 'User-agent: *\nDisallow: /\n' };
    assert.equal(evaluatePolicy(policy, '/robots.txt').allowed, true);
    assert.equal(evaluatePolicy(policy, '/anything').allowed, false);
  });

  test('the exemption holds under every disposition', () => {
    for (const disposition of ['rules', 'allow-all', 'disallow-all']) {
      const policy = { disposition, httpStatus: disposition === 'rules' ? 200 : 503, body: 'User-agent: *\nDisallow: /\n' };
      assert.equal(evaluatePolicy(policy, '/robots.txt').allowed, true, disposition);
    }
  });
});
