/**
 * Capture harness for the solo descriptive scan (SOLO-PROTOCOL.md step 5, and section 5
 * of the held-out protocol, which the solo design inherits unchanged).
 *
 * It lives outside `evaluation/` on purpose. That package is dependency-free by design so
 * that building evaluation tooling cannot change the instrument the evaluation runs with,
 * and a browser automation dependency would end that. Nothing here analyses anything: it
 * retrieves pages, records provenance, and writes a draft the frozen seal then verifies.
 *
 * Three protocol rules are enforced here rather than remembered:
 *
 *   - A fresh browser context with no stored state. Not a persistent profile, so no
 *     account, cookie or cached credential from any other browsing can reach a captured
 *     page.
 *   - A fixed 1280x800 viewport, matching CWAC's documented medium viewport.
 *   - Nothing is typed and no form is submitted. The harness has no code path that
 *     enters text or clicks a submit control.
 *
 * The complete rendered document is saved, not a hand-cut form fragment, because cutting
 * would add a preprocessing step and could remove labels the analyser relies on. Scripts
 * are allowed to run while the page loads; FormFair later reads the saved markup without
 * executing anything.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { POLICY } from './politeness.mjs';

export const VIEWPORT = { width: 1280, height: 800 };
export const LOCALE = 'en-NZ';

/**
 * Navigation budget, split in two so that one hanging subresource cannot cost a page.
 *
 * `load` is still what the harness waits for. What changed in capture-v1.0.3 is what
 * happens when `load` never arrives: a third-party analytics script that never completes
 * holds the load event open indefinitely, even though the document, its markup and its
 * form arrived in a few hundred milliseconds. Waiting for `load` as a navigation
 * precondition threw that whole page away, which silently biases the corpus against
 * agencies whose sites carry a slow tracker - exactly the pages a prevalence study must
 * not drop.
 *
 * So navigation now waits for `domcontentloaded`, then waits separately for `load`. A
 * page that reaches `load` is captured at precisely the same point as before; a page that
 * does not is captured anyway, and records that it did not along with the requests that
 * were still outstanding. The deviation is visible on the page it applies to instead of
 * being a silent property of the harness.
 */
export const NAVIGATION_TIMEOUT_MS = 45000;
export const LOAD_EVENT_TIMEOUT_MS = 15000;
/** Outstanding requests are recorded to explain a missing load event, not to enumerate it. */
export const MAX_RECORDED_OUTSTANDING = 20;

/**
 * An outstanding request is recorded as origin plus pathname, and nothing else.
 *
 * The point of the field is to say which host and resource held the load event open, which
 * origin and path answer completely. A query string on an analytics beacon is generated
 * per visit and routinely carries a session or client identifier, a cache-buster, and the
 * URL of the page being viewed; a fragment can carry the same. None of that is evidence
 * about the agency's form, and publishing provenance means it would be published.
 */
export function requestProvenanceUrl(raw) {
  try {
    const u = new URL(raw);
    // Opaque schemes (data:, blob:) have no origin or path worth recording, and a data URI
    // would embed the resource itself in the provenance record.
    if (!/^https?:$/.test(u.protocol)) return `${u.protocol}//`;
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

export const CATEGORIES = [
  'account-registration',
  'service-application',
  'enquiry-or-contact',
  'subscription-or-newsletter',
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** CSV field quoting, so an agency name containing a comma cannot corrupt the ledger. */
const csv = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const LEDGER_HEADER =
  'examinedAt,agency,website,url,finalUrl,status,category,exclusionReason,pageId,htmlSha256\n';

/**
 * Appends one row to the selection ledger.
 *
 * Every URL examined is recorded, captured or not. The protocol requires the reason for
 * every inclusion and exclusion, because a ledger that lists only successes cannot show
 * that the draw order was followed.
 */
export function recordExamination(ledgerPath, row) {
  if (!existsSync(ledgerPath)) writeFileSync(ledgerPath, LEDGER_HEADER, 'utf8');
  const line =
    [
      row.examinedAt,
      row.agency,
      row.website,
      row.url,
      row.finalUrl ?? '',
      row.status,
      row.category ?? '',
      row.exclusionReason ?? '',
      row.pageId ?? '',
      row.htmlSha256 ?? '',
    ]
      .map(csv)
      .join(',') + '\n';
  appendFileSync(ledgerPath, line, 'utf8');
  return line;
}

/** Only real web pages. A file: or data: URL is not a government form. */
export function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`only http and https may be captured, got ${parsed.protocol}`);
  }
  return parsed;
}

/**
 * A pageId becomes a filename, so it may not traverse or collide with anything.
 * Lowercase letters, digits and hyphens only.
 */
export function validatePageId(pageId) {
  if (typeof pageId !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pageId) || pageId.length > 64) {
    throw new Error(
      `pageId must be lowercase alphanumeric words separated by hyphens, got ${JSON.stringify(pageId)}`
    );
  }
  return pageId;
}

/**
 * Classifies what stands between a reader and the form, without touching any of it.
 *
 * Three kinds of signal, because they mean different things:
 *
 *   accessBarriers        the form cannot be read at all - a 401 or 403, a challenge
 *                         interstitial with nothing behind it, a sign-in wall. Excluded.
 *   submissionProtection  a challenge that guards submitting, on a form already readable.
 *                         Recorded, not excluded: the protocol never submits.
 *   authenticationSignals password fields on the page. Recorded, not excluded: a public
 *                         registration form has them, and that is the highest-priority
 *                         category in the protocol.
 *
 * Nothing here clicks, dismisses or solves anything.
 */
export async function detectBlocking(page, httpStatus) {
  const accessBarriers = [];
  const submissionProtection = [];
  const authenticationSignals = [];

  // An HTTP 401 or 403 is the page refusing to be read at all.
  if (httpStatus === 401 || httpStatus === 403) accessBarriers.push(`http ${httpStatus}`);

  const found = await page.evaluate(() => {
    const visible = (el) => Boolean(el) && el.offsetParent !== null;
    // Text-like inputs the page renders on load, other than the site search. A form the study
    // could assess has at least one; a challenge interstitial or a sign-in wall has none.
    const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'number'];
    const textInputs = [...document.querySelectorAll('input')].filter(
      (i) => TEXT_TYPES.includes(i.type) && visible(i)
    );
    const looksLikeSearch = (i) =>
      /search|^q$|query|keyword/i.test(`${i.name} ${i.id} ${i.getAttribute('aria-label') ?? ''}`) ||
      /search/i.test(i.closest('form')?.getAttribute('action') ?? '');
    const contentInputs = textInputs.filter((i) => !looksLikeSearch(i));
    const textareas = [...document.querySelectorAll('textarea')].filter(visible);

    const src = [...document.querySelectorAll('script[src],iframe[src]')].map((e) => e.src).join(' ');
    const challenge = /recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(src)
      ? (src.match(/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i) ?? ['challenge'])[0].toLowerCase()
      : null;
    const passwords = document.querySelectorAll('input[type="password"]').length;
    const text = (document.body?.innerText ?? '').slice(0, 4000).toLowerCase();
    const saysSignIn = /(^|\W)(sign in|log in|login required)(\W|$)/.test(text);

    // A login form's username box is part of the barrier, not the form the study wants, so
    // content inputs are counted OUTSIDE any form that carries a password field.
    const passwordForms = new Set(
      [...document.querySelectorAll('input[type="password"]')].map((i) => i.closest('form')).filter(Boolean)
    );
    const outside = (el) => !passwordForms.has(el.closest('form'));
    const contentInputsOutsideCredentials = contentInputs.filter(outside);
    const textareasOutsideCredentials = textareas.filter(outside);

    // The discriminator is whether the password-bearing form exposes a personal-name field,
    // which is precisely this study's subject. Such a form is not AUTOMATICALLY classified as a
    // sign-in wall; it proceeds to researcher assessment. A name field does not prove the form is
    // a registration - it means the detector must not decide, and the candidate-set and
    // attempt-approval gates still control inclusion. Conservative in one direction only: no
    // automatic exclusion, and no automatic inclusion either.
    const NAME_HINT = /(^|[^a-z])(name|firstname|first_name|givenname|given_name|surname|lastname|last_name|fullname|full_name)([^a-z]|$)/i;
    const asksForAName = [...passwordForms].some((form) =>
      [...form.querySelectorAll('input, label')].some((el) =>
        NAME_HINT.test(`${el.getAttribute?.('name') ?? ''} ${el.id ?? ''} ${el.textContent ?? ''}`)
      )
    );

    return {
      challenge,
      passwords,
      saysSignIn,
      asksForAName,
      contentInputs: contentInputs.length,
      textareas: textareas.length,
      readableOutsideCredentials:
        contentInputsOutsideCredentials.length + textareasOutsideCredentials.length,
      credentialFieldNames: [...document.querySelectorAll('input[type="password"]')]
        .map((i) => i.name || i.id || '(unnamed)')
        .slice(0, 5),
    };
  });

  // capture-v1.0.5. A challenge or a password field is not itself an access barrier.
  //
  // The previous detector returned a flat list in which `password field` and `captcha` both meant
  // "not publicly reachable". That excluded two kinds of page the protocol wants: a public contact
  // form whose reCAPTCHA protects only submission, and a public registration form - the highest
  // priority category - which necessarily contains password fields. Neither prevents reading the
  // form, and the protocol never types or submits.
  //
  // What makes a page unreadable is the intended form being unreachable without interacting with
  // a challenge or authenticating. That is what is tested: a challenge with no readable content
  // field behind it is an interstitial, and credential fields with nothing else readable are a
  // sign-in wall.
  const hasReadableForm = found.contentInputs > 0 || found.textareas > 0;
  if (found.challenge) {
    if (hasReadableForm) submissionProtection.push(found.challenge);
    else accessBarriers.push(`${found.challenge} interstitial`);
  }
  if (found.passwords > 0) {
    authenticationSignals.push(
      `${found.passwords} password field(s): ${found.credentialFieldNames.join(', ')}`
    );
    // A sign-in wall: the page says so, carries credentials, offers nothing readable beyond
    // them, and does not ask for a person's name - which a registration form would.
    if (found.saysSignIn && found.readableOutsideCredentials === 0 && !found.asksForAName) {
      accessBarriers.push('sign-in wall');
    }
  }

  return { accessBarriers, submissionProtection, authenticationSignals };
}

/** A sign-in wall is a fact about the page; everything else may be bot management. */
const isAuthBarrier = (barrier) => /sign-in wall/.test(barrier);

/**
 * Is the headed fallback warranted by this result?
 *
 * Only for an automation barrier. A sign-in wall is a finding about what the public can read, and
 * opening a visible window would not change it.
 */
export function needsHeadedFallback(record) {
  return (record?.accessBarriers ?? []).some((b) => !isAuthBarrier(b));
}

/**
 * What to do with a capture result. One decision, from one record.
 *
 * capture-v1.0.7. This exists because the CLI made the decision in pieces, in an order that
 * stopped being correct once the headed fallback was added: the sign-in branch ran BEFORE the
 * fallback and was never revisited afterwards. A headed attempt that got past a challenge and
 * revealed a sign-in wall then matched no branch at all - the sign-in test was behind it,
 * `capture-blocked` tests for a non-auth barrier and none was left - and execution reached the
 * adoption branch carrying a barrier, no file and no hash, where it died inside validation. The
 * harness had established that page's ineligibility and could not write it down.
 *
 * As a function of the final record it cannot drift out of order, and the previously unreachable
 * combination is a case in a table rather than a path nobody could run.
 */
export function captureDisposition(record) {
  if (!record) return { kind: 'failed', authBarriers: [], automationBarriers: [] };
  const barriers = record.accessBarriers ?? [];
  const authBarriers = barriers.filter(isAuthBarrier);
  const automationBarriers = barriers.filter((b) => !isAuthBarrier(b));
  // A 429 outranks everything: the policy stops the run whatever else the page showed, and the
  // markup already written for it must be dealt with before any other branch can adopt it.
  if (record.httpStatus === 429) return { kind: 'rate-limited', authBarriers, automationBarriers };
  if (authBarriers.length > 0) return { kind: 'excluded-sign-in', authBarriers, automationBarriers };
  if (automationBarriers.length > 0) return { kind: 'capture-blocked', authBarriers, automationBarriers };
  return { kind: 'adopt', authBarriers, automationBarriers };
}

/**
 * Captures one page.
 *
 * `browserFactory` is injected so the harness can be exercised against local synthetic
 * pages without reaching the network, which is what the protocol requires of it before
 * any real page is opened.
 */
export async function capturePage({
  browserFactory, url, agency, website, pageId, category, outDir,
  settleMs = POLICY.postLoadSettleMs,
  // Injectable so the hanging-subresource path can be exercised in a second rather than
  // in fifteen. Real captures always use the constant.
  loadEventTimeoutMs = LOAD_EVENT_TIMEOUT_MS,
  // capture-v1.0.6. Which browser mode produced this attempt, recorded on the result. The protocol
  // says "the normal Chromium user agent, unmodified and recorded", and the implementation launched
  // default headless Chromium, whose unmodified user agent says HeadlessChrome. That mismatch was
  // invisible until a host served a challenge to it.
  browserMode = 'headless',
}) {
  validateUrl(url);
  validatePageId(pageId);
  if (!CATEGORIES.includes(category)) {
    throw new Error(`category must be one of ${CATEGORIES.join(', ')}`);
  }
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const file = `${pageId}.html`;
  const target = join(dir, file);
  // Never silently replace a capture: an overwritten page would change what the corpus
  // manifest hashes without changing the manifest.
  if (existsSync(target)) throw new Error(`${file} already exists; refusing to overwrite a capture`);

  const browser = await browserFactory();
  // A fresh context, never a persistent profile.
  const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALE });
  const page = await context.newPage();
  try {
    // Tracked before navigation so that a request which is already outstanding when the
    // load wait gives up is attributable. Playwright fires `requestfinished` and
    // `requestfailed` for every request it fires `request` for, so what remains in the
    // map is exactly what is still in flight.
    const inFlight = new Map();
    page.on('request', (r) => inFlight.set(r, r.url()));
    page.on('requestfinished', (r) => inFlight.delete(r));
    page.on('requestfailed', (r) => inFlight.delete(r));

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const httpStatus = response?.status() ?? null;

    // The load event, waited for separately and bounded. A page that reaches it is at the
    // identical state `waitUntil: 'load'` would have returned.
    let loadState = 'load';
    let outstandingRequests = [];
    try {
      await page.waitForLoadState('load', { timeout: loadEventTimeoutMs });
    } catch (error) {
      // Only a timeout means "this page never finished loading", which is the case this
      // fallback exists for. Anything else - a closed page, a crashed target, a navigation
      // away mid-wait - means the capture did not happen, and must stay a failure rather
      // than be quietly downgraded into a successful capture of an unknown document.
      if (error?.name !== 'TimeoutError') throw error;
      loadState = 'domcontentloaded';
      outstandingRequests = [...new Set([...inFlight.values()].map(requestProvenanceUrl))]
        .slice(0, MAX_RECORDED_OUTSTANDING);
    }

    const redirects = [];
    let hop = response?.request()?.redirectedFrom?.();
    while (hop) {
      redirects.unshift(hop.url());
      hop = hop.redirectedFrom?.();
    }

    // A fixed settling period after the load wait resolves, whether it resolved by the
    // load event firing or by its budget expiring. Capturing the instant `load` fires misses
    // constraints that a framework applies a tick later, and a variable wait would make
    // two runs of the same page incomparable. It is recorded in provenance so a reader
    // knows exactly what was waited for.
    await page.waitForTimeout(settleMs);

    const blocking = await detectBlocking(page, httpStatus);
    const userAgent = await page.evaluate(() => navigator.userAgent);

    // capture-v1.0.6. The markup is written only for a page that is not access-barred.
    //
    // It used to be written before the CLI decided whether to exclude, so a blocked response left
    // an official .html file in the captures directory that no attempt record owned - a Cloudflare
    // interstitial among the corpus material, indistinguishable by filename from a real capture.
    // The decision now precedes the write.
    const blocked = blocking.accessBarriers.length > 0;
    const html = blocked ? null : await page.evaluate(() => document.documentElement.outerHTML);
    if (!blocked) writeFileSync(target, html, 'utf8');

    const version = browser.version?.() ?? 'unknown';
    return {
      blocked,
      browserMode,
      httpStatus,
      // capture-v1.0.5: three fields, not one flat list. Only accessBarriers excludes.
      accessBarriers: blocking.accessBarriers,
      submissionProtection: blocking.submissionProtection,
      authenticationSignals: blocking.authenticationSignals,
      userAgent,
      settleMs,
      // 'load' for a page captured at the load event, 'domcontentloaded' for one whose
      // load event never fired within its budget. Any reader comparing two captures needs
      // to know which of the two they are looking at.
      loadState,
      outstandingRequests,
      pageId,
      agency,
      website,
      originalUrl: url,
      finalUrl: page.url(),
      capturedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      browser: `Chromium ${version}`,
      automationTool: `playwright ${playwrightVersion()}`,
      viewport: { ...VIEWPORT },
      locale: LOCALE,
      redirects,
      category,
      file: blocked ? null : file,
      htmlSha256: blocked ? null : sha256(html),
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

function playwrightVersion() {
  try {
    const pkg = new URL('./node_modules/playwright/package.json', import.meta.url);
    return JSON.parse(readFileSync(pkg, 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

/** Builds the corpus draft the frozen seal will verify. Provenance only; no analysis. */
export function buildDraft({ pages, frameSha256, drawOrderSha256, selectionLedgerFile = 'selection-ledger.csv' }) {
  return {
    schema: 'formfair/solo-corpus-draft@1',
    synthetic: false,
    frameSha256,
    drawOrderSha256,
    selectionLedgerFile,
    pages: pages.map((p) => ({
      pageId: p.pageId,
      agency: p.agency,
      website: p.website,
      originalUrl: p.originalUrl,
      finalUrl: p.finalUrl,
      capturedAt: p.capturedAt,
      browser: p.browser,
      automationTool: p.automationTool,
      viewport: p.viewport,
      locale: p.locale,
      redirects: p.redirects,
      category: p.category,
      file: p.file,
    })),
  };
}
