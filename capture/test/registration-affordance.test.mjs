/**
 * Amendment 46: a visible way to register means the page is not a sign-in wall.
 *
 * `jobs.tewhatuora.govt.nz` returned HTTP 200 and 213 nodes carrying a login form, a job search and
 * three visible "Register" anchors, and was classified `retrieval-blocked` on a sign-in wall — a
 * record asserting that nothing was read about a page that was read in full. The logic was working
 * as written: the job-search inputs were excluded as search fields, so `readableOutsideCredentials`
 * computed 0, and the discriminator asked only whether the PASSWORD-bearing form carried a
 * personal-name field. A registration route beside the login form was invisible to it.
 *
 * That contradicts the frozen interpretation, which excludes a page only when the intended form
 * cannot be VIEWED without authenticating.
 *
 * These cases drive the real `detectBlocking` over a page built from markup, so they test the
 * function that classifies every capture rather than a copy of its reasoning.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { detectBlocking, VIEWPORT, LOCALE } from '../capture.mjs';
import {
  emptyLog, appendAttempt, isDiscoverySuperseded, unjudgedRenderedObservations,
  assertRenderEvidenceUsable,
} from '../run.mjs';
import { TECHNICAL_ATTRITION_OUTCOMES } from '../selection.mjs';
import { unjudgedRenderProblems } from '../../evaluation/solo/descriptive.mjs';
import { prepareSet } from './helpers.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Classify markup with no network of any kind. */
const classify = async (html, status = 200) => {
  const page = await browser.newPage({ viewport: VIEWPORT, locale: LOCALE });
  try {
    await page.route('**/*', (route) => route.abort());
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await detectBlocking(page, status);
  } finally {
    await page.close();
  }
};

const LOGIN_FORM = `
  <form><label for="u">Email Address:</label><input id="u" type="email" name="in_username">
  <label for="p">Password:</label><input id="p" type="password" name="in_pwd">
  <input type="submit" value="Sign In"></form>`;

describe('the jobs.tewhatuora layout: a login form beside a visible register link', () => {
  test('a separate login form plus a visible Register link is NOT a sign-in wall', async () => {
    // The exact shape: sign-in language, a password form, a job search whose inputs are all
    // excluded as search fields, no name field in the login form, and a Register anchor.
    const html = `<body>
      <a href="/jobtools/jncustomlogin.JobSeekerToolBoxAction?in_create_account_button=Register">Register</a>
      <span>Sign In</span>
      ${LOGIN_FORM}
      <form action="/jobtools/search"><input type="text" name="in_skills"><input type="text" name="location">
      <input type="submit" value="Search Jobs"></form>
    </body>`;
    const r = await classify(html);
    assert.ok(!r.accessBarriers.includes('sign-in wall'), JSON.stringify(r.accessBarriers));
    assert.equal(r.registrationAffordances.length, 1);
    assert.equal(r.registrationAffordances[0].label, 'Register');
    assert.equal(r.registrationAffordances[0].element, 'a');
    assert.match(r.registrationAffordances[0].target, /in_create_account_button=Register/);
    // The password field is still recorded, because it is a fact about the page.
    assert.equal(r.authenticationSignals.length, 1);
  });

  test('a genuine login-only wall is still blocked', async () => {
    const html = `<body><h1>Sign In</h1>${LOGIN_FORM}<a href="/forgot">Forgot password?</a></body>`;
    const r = await classify(html);
    assert.ok(r.accessBarriers.includes('sign-in wall'), JSON.stringify(r));
    assert.deepEqual(r.registrationAffordances, []);
  });

  test('the affordance is found on a button and on a role=button, not only an anchor', async () => {
    for (const control of [
      '<button type="button">Create an account</button>',
      '<div role="button" tabindex="0">Sign up</div>',
      '<input type="submit" value="Register">',
    ]) {
      const r = await classify(`<body><span>Sign In</span>${LOGIN_FORM}${control}</body>`);
      assert.ok(!r.accessBarriers.includes('sign-in wall'), `${control} did not clear the barrier`);
      assert.equal(r.registrationAffordances.length, 1, control);
    }
  });
});

describe('what must NOT clear the barrier', () => {
  test('a HIDDEN registration control leaves the page blocked', async () => {
    for (const hidden of [
      '<a href="/register" style="display:none">Register</a>',
      '<div style="display:none"><a href="/register">Register</a></div>',
      '<button type="button" hidden>Sign up</button>',
    ]) {
      const r = await classify(`<body><span>Sign In</span>${LOGIN_FORM}${hidden}</body>`);
      assert.ok(
        r.accessBarriers.includes('sign-in wall'),
        `a hidden affordance cleared the barrier: ${hidden}`
      );
      assert.deepEqual(r.registrationAffordances, []);
    }
  });

  test('"Register" in a script or a comment does not count', async () => {
    const html = `<body><span>Sign In</span>${LOGIN_FORM}
      <script>var label = "Register"; function createAccount(){}</script>
      <!-- Register link removed; see ticket 412 -->
    </body>`;
    const r = await classify(html);
    assert.ok(r.accessBarriers.includes('sign-in wall'), JSON.stringify(r.accessBarriers));
    assert.deepEqual(r.registrationAffordances, []);
  });

  test('incidental prose about registering does not count', async () => {
    // Body text is not an affordance: only a control the reader can act on is.
    const html = `<body><span>Sign In</span>${LOGIN_FORM}
      <p>You must register with the Ministry before applying. Registration closed in 2019.</p>
    </body>`;
    const r = await classify(html);
    assert.ok(r.accessBarriers.includes('sign-in wall'));
    assert.deepEqual(r.registrationAffordances, []);
  });

  test('removing the barrier asserts nothing about eligibility', async () => {
    // A cleared barrier permits researcher judgement; it does not supply one. The page here has
    // no name field at all, and nothing in the result claims it is eligible.
    const html = `<body><a href="/register">Register</a><span>Sign In</span>${LOGIN_FORM}</body>`;
    const r = await classify(html);
    assert.ok(!r.accessBarriers.includes('sign-in wall'));
    assert.deepEqual(Object.keys(r).sort(),
      ['accessBarriers', 'authenticationSignals', 'registrationAffordances', 'submissionProtection']);
  });

  test('an HTTP 403 remains a barrier whatever the page offers', async () => {
    const html = `<body><a href="/register">Register</a>${LOGIN_FORM}</body>`;
    const r = await classify(html, 403);
    assert.ok(r.accessBarriers.includes('http 403'));
  });
});

/**
 * The append-only correction itself, and what both packages must say about it.
 */
describe('a re-classification corrects the barrier without rewriting history', () => {
  const AGENCY = 'Health New Zealand';
  const CAT = 'account-registration';
  const URL_ = 'https://jobs.example.govt.nz/login';
  const FILE = 'g-jobs.html';
  const DIGEST = 'c'.repeat(64);

  /** The barred original: a render marked sign-in wall and the observation that carried it. */
  const barredRound = () => {
    const log = emptyLog();
    prepareSet(log, AGENCY, CAT, [URL_]);
    log.renders = [{
      id: 'g-0001', url: URL_, navigatedAt: '2026-09-30T20:00:00Z', permitId: 'p-0001',
      httpStatus: 200, renderFile: FILE, renderedSha256: DIGEST, renderedBytes: 32339,
      accessBarriers: ['sign-in wall'],
    }];
    log.discoveryPermits = [{
      id: 'p-0001', agency: AGENCY, category: CAT, candidateSetVersion: 1, url: URL_,
      robotsCheckId: 'r-0001', issuedAt: '2026-09-30T19:59:00Z', consumedAt: '2026-09-30T20:00:00Z',
    }];
    log.attempts.push({
      id: 'd-9001', recordType: 'observation', renderId: 'g-0001', permitId: 'p-0001',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'retrieval-blocked',
      agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
      category: CAT, candidateSetVersion: 1, navigatedAt: '2026-09-30T20:00:00Z',
      evidence: 'rendered-dom', renderFile: FILE, renderedSha256: DIGEST, renderedBytes: 32339,
      approval: 'approved',
    });
    return log;
  };

  /** The correction: a new render with cleared barriers and an observation superseding the old. */
  const corrected = (log) => {
    log.renders.push({
      id: 'g-0002', url: URL_, navigatedAt: '2026-09-30T20:00:00Z', permitId: 'p-0001',
      httpStatus: 200, renderFile: FILE, renderedSha256: DIGEST, renderedBytes: 32339,
      accessBarriers: [], registrationAffordances: [{ label: 'Register', element: 'a', target: '/register' }],
      adoptedFrom: 'd-9001', correctsRender: 'g-0001',
    });
    appendAttempt(log, {
      recordType: 'observation', renderId: 'g-0002', supersedesDiscoveryId: 'd-9001',
      status: 'discovery', discoveryKind: 'navigation', outcome: 'rendered',
      agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
      category: CAT, candidateSetVersion: 1,
      navigationPerformed: false, checkedAt: '2026-10-01T02:00:00Z',
      evidence: 'rendered-dom', renderFile: FILE, renderedSha256: DIGEST, renderedBytes: 32339,
      note: 'barriers recomputed from the retained bytes; no request was made',
      approval: 'approved',
    });
    return log.attempts.at(-1);
  };

  test('the corrected record no longer counts as technical attrition', () => {
    const log = barredRound();
    const before = log.attempts.filter(
      (a) => TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome) && !isDiscoverySuperseded(log, a.id)
    ).length;
    assert.equal(before, 1);
    corrected(log);
    const after = log.attempts.filter(
      (a) => TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome) && !isDiscoverySuperseded(log, a.id)
    ).length;
    assert.equal(after, 0, 'the superseded blocked record still counts as attrition');
    // And the original is preserved, not rewritten.
    assert.equal(log.attempts.find((a) => a.id === 'd-9001').outcome, 'retrieval-blocked');
  });

  test('a re-classification needs no permit, and must not borrow the consumed one', () => {
    const log = barredRound();
    assert.throws(
      () => appendAttempt(log, {
        recordType: 'observation', renderId: 'g-0002', supersedesDiscoveryId: 'd-9001',
        permitId: 'p-0001',
        status: 'discovery', discoveryKind: 'navigation', outcome: 'rendered',
        agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
        category: CAT, candidateSetVersion: 1, navigationPerformed: false,
        checkedAt: '2026-10-01T02:00:00Z', evidence: 'rendered-dom',
        renderFile: FILE, renderedSha256: DIGEST, renderedBytes: 32339, approval: 'approved',
      }),
      /must not name a permit/
    );
  });

  test('the corrected observation stays outstanding until it is explicitly judged', () => {
    const log = barredRound();
    const record = corrected(log);
    const outstanding = unjudgedRenderedObservations(log);
    assert.equal(outstanding.length, 1, 'the correction did not create a judgement obligation');
    assert.match(outstanding[0], new RegExp(record.id));
  });

  test('the barred render stays unusable as evidence; the corrected one is usable', () => {
    const log = barredRound();
    corrected(log);
    // The old render must go on refusing to support a judgement, which is why the correction
    // replaces the barrier metadata instead of adding a judgement that cites a barred render.
    const barred = assertRenderEvidenceUsable(log, { renderId: 'g-0001', capturesRoot: '/nonexistent' });
    assert.ok(barred.some((p) => /access-barred/.test(p)), JSON.stringify(barred));
  });

  test('both packages agree the corrected log is clean', () => {
    const log = barredRound();
    const record = corrected(log);
    // Judged, so nothing is outstanding.
    appendAttempt(log, {
      recordType: 'judgement-only', renderId: 'g-0002',
      evidenceFromDiscoveryId: record.id, answersDiscoveryId: record.id,
      status: 'discovery', discoveryKind: 'navigation', outcome: 'candidates-found',
      agency: AGENCY, website: 'https://jobs.example.govt.nz/', url: URL_,
      category: CAT, candidateSetVersion: 1, navigationPerformed: false,
      checkedAt: '2026-10-01T02:01:00Z', evidence: 'rendered-dom',
      renderFile: FILE, renderedSha256: DIGEST, renderedBytes: 32339,
      note: 'a visible Register anchor', approval: 'approved',
    });
    assert.deepEqual(unjudgedRenderedObservations(log), []);
    assert.deepEqual(unjudgedRenderProblems(log), []);
  });
});
