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
 * Detects controls that would have to be bypassed to see the form, without bypassing any.
 *
 * The protocol requires an eligible form to be publicly reachable without signing in, so a
 * page behind one of these is genuinely ineligible rather than merely awkward. What is
 * found is recorded and the page is excluded; nothing here clicks, dismisses or solves
 * anything.
 */
export async function detectBlocking(page, httpStatus) {
  const signals = [];
  if (httpStatus === 401 || httpStatus === 403) signals.push(`http ${httpStatus}`);
  const found = await page.evaluate(() => {
    const out = [];
    if (document.querySelector('input[type="password"]')) out.push('password field');
    const src = [...document.querySelectorAll('script[src],iframe[src]')].map((e) => e.src).join(' ');
    if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(src)) out.push('captcha');
    const text = (document.body?.innerText ?? '').slice(0, 4000).toLowerCase();
    if (/(^|\W)(sign in|log in|login required)(\W|$)/.test(text) && document.querySelector('input[type="password"]')) {
      out.push('sign-in wall');
    }
    return out;
  });
  return [...signals, ...found];
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

    const html = await page.evaluate(() => document.documentElement.outerHTML);
    writeFileSync(target, html, 'utf8');

    const version = browser.version?.() ?? 'unknown';
    return {
      httpStatus,
      blocking,
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
      file,
      htmlSha256: sha256(html),
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
