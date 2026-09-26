/**
 * Rendered-DOM discovery evidence.
 *
 * selection-v1.0.24. Every discovery inspection in this scan until now was a plain HTTP fetch,
 * while the capture step drives Chromium and executes JavaScript. That asymmetry is a selection
 * bias, not a detail: a form inserted by script is invisible to discovery and perfectly capturable,
 * so a client-rendered service-application form would be recorded as `no-candidates` - the same
 * false statement `no-candidates` would have made about an Incapsula challenge page.
 *
 * The first proposal was to render only where a plain fetch returned "script-driven and no form".
 * That trigger does not hold: a raw page can carry a search box, a cookie form or a login form
 * while script inserts the personal-name form later, and such a page escapes the trigger entirely.
 * So the rule is not conditional. For a permitted HTML navigation or internal-search page, the
 * RENDERED DOM is the authoritative discovery evidence. Plain retrieval remains right for
 * robots.txt, sitemaps, status codes and non-HTML files, where there is nothing to render.
 *
 * What this deliberately does not do: no persistent profile, no imported cookies, no custom user
 * agent, no stealth or fingerprint modification, no typing, no clicking, no interaction with any
 * challenge, and nothing submitted. It loads a page and reads what a member of the public would
 * see. The rendered bytes are third-party markup and stay in the private data tree; only their
 * hash, size and provenance are ever published.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectBlocking, validateUrl, VIEWPORT, LOCALE, NAVIGATION_TIMEOUT_MS, LOAD_EVENT_TIMEOUT_MS } from './capture.mjs';
import { POLICY } from './politeness.mjs';

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

/** How a discovery record's evidence was obtained. */
export const DISCOVERY_EVIDENCE = Object.freeze({
  RENDERED_DOM: 'rendered-dom',
  PLAIN_RETRIEVAL: 'plain-retrieval',
});

/** The methods for which a rendered DOM is authoritative. The others have nothing to render. */
export const RENDERED_METHODS = Object.freeze(['navigation', 'internal-search']);

/**
 * Renders one page and returns what it holds, without judging any of it.
 *
 * Links and form structure are extracted because discovery is about finding candidate URLs and
 * seeing whether a page carries a form at all. No rule is applied and no field is classified: the
 * capture harness must not be able to analyse anything, or a page could be judged before the
 * corpus containing it is sealed.
 */
export async function renderDiscoveryPage({
  browserFactory, url, outDir, recordId,
  settleMs = POLICY.postLoadSettleMs,
  loadEventTimeoutMs = LOAD_EVENT_TIMEOUT_MS,
  browserMode = 'headless',
}) {
  validateUrl(url);
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const file = `${recordId}.html`;
  const target = join(dir, file);
  if (existsSync(target)) throw new Error(`${file} already exists; refusing to overwrite rendered evidence`);

  const browser = await browserFactory();
  const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALE });
  const page = await context.newPage();
  try {
    const navigatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    const httpStatus = response?.status() ?? null;

    let loadState = 'load';
    try {
      await page.waitForLoadState('load', { timeout: loadEventTimeoutMs });
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
      loadState = 'domcontentloaded';
    }
    await page.waitForTimeout(settleMs);

    const contentType = response?.headers?.()['content-type'] ?? null;
    const blocking = await detectBlocking(page, httpStatus);
    const userAgent = await page.evaluate(() => navigator.userAgent);

    const found = await page.evaluate(() => ({
      title: document.title ?? '',
      links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
      forms: [...document.querySelectorAll('form')].map((f) => ({
        action: f.getAttribute('action') ?? '',
        method: (f.getAttribute('method') ?? 'get').toLowerCase(),
        controls: [...f.querySelectorAll('input,select,textarea')].map((c) => ({
          tag: c.tagName.toLowerCase(),
          type: c.getAttribute('type') ?? null,
          name: c.getAttribute('name') ?? null,
        })),
      })),
      // Whether script actually changed the document is the fact that justifies this whole
      // command, so it is measured rather than assumed.
      domNodes: document.getElementsByTagName('*').length,
    }));

    const html = await page.evaluate(() => document.documentElement.outerHTML);
    writeFileSync(target, html, 'utf8');

    return {
      url,
      finalUrl: page.url(),
      navigatedAt,
      httpStatus,
      contentType,
      loadState,
      browserMode,
      browser: `Chromium ${browser.version?.() ?? 'unknown'}`,
      automationTool: 'playwright',
      userAgent,
      viewport: VIEWPORT,
      locale: LOCALE,
      settleMs,
      evidence: DISCOVERY_EVIDENCE.RENDERED_DOM,
      renderFile: file,
      renderedSha256: sha256(html),
      renderedBytes: Buffer.byteLength(html),
      accessBarriers: blocking.accessBarriers,
      submissionProtection: blocking.submissionProtection,
      authenticationSignals: blocking.authenticationSignals,
      title: found.title,
      domNodes: found.domNodes,
      links: [...new Set(found.links)],
      forms: found.forms,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
