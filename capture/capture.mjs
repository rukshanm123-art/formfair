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
export async function capturePage({ browserFactory, url, agency, website, pageId, category, outDir, settleMs = POLICY.postLoadSettleMs }) {
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
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    const httpStatus = response?.status() ?? null;

    const redirects = [];
    let hop = response?.request()?.redirectedFrom?.();
    while (hop) {
      redirects.unshift(hop.url());
      hop = hop.redirectedFrom?.();
    }

    // A fixed settling period after load. Capturing the instant `load` fires misses
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
