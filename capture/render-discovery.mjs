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
import {
  detectBlocking, validateUrl, VIEWPORT, LOCALE, NAVIGATION_TIMEOUT_MS, LOAD_EVENT_TIMEOUT_MS,
  structuralReport,
} from './capture.mjs';
import { POLICY } from './politeness.mjs';
import { installRedirectGuard, isRefusedNavigation, REFUSE_ALL_REDIRECTS } from './redirect-guard.mjs';

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
  // Decides one absolute URL against the RECORDED policies. It must never fetch: a render is
  // authorised by a permit issued in advance, and reaching for a fresh policy mid-navigation would
  // be traffic no permit covers.
  policyFor = REFUSE_ALL_REDIRECTS,
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
    // Every top-level redirect target is checked against the recorded policy before it is asked
    // for. See `redirect-guard.mjs` for why this cannot be done with `page.route`.
    const guard = await installRedirectGuard(context, page, { url, policyFor });

    const navigatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    let response = null;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      // A refusal surfaces as a blocked navigation. Anything else is a real failure.
      if (!isRefusedNavigation(error, guard)) throw error;
    }
    if (guard.refusal) {
      return {
        url,
        refused: true,
        refusal: guard.refusal,
        redirectChain: guard.redirectChain,
        navigatedAt,
        browserMode,
        // Deliberately no file, no digest and no controls: nothing was retrieved to record, and a
        // render that stopped at a policy boundary must not leave evidence-shaped fields behind.
        renderFile: null,
        renderedSha256: null,
        renderedBytes: null,
      };
    }
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

    const found = await page.evaluate(() => {
      // The accessible name, by the routes a person actually gets one from. Counts and ids alone
      // showed `q7`, `q8`, `q9` without saying they mean First, Middle and Last name - which is the
      // whole point of looking at a name field. No rule is applied to the text; it is recorded so a
      // reader of the log can see what the control asked for.
      const accessibleName = (c) => {
        const aria = c.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const labelledBy = c.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ').trim();
          if (text) return text;
        }
        const id = c.getAttribute('id');
        if (id) {
          const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
        }
        const wrapping = c.closest('label');
        if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
        // A form-less application labels its controls with ordinary elements. The nearest preceding
        // text in document order is what a sighted person reads as the label, so it is reported -
        // marked `nearby`, because it is weaker evidence than a real label and must not be mistaken
        // for one.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let previous = null;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) {
            const text = node.textContent.trim();
            if (text) previous = text;
          } else break;
        }
        return previous ? `nearby: ${previous}` : null;
      };
      const describe = (c) => ({
        tag: c.tagName.toLowerCase(),
        type: c.getAttribute('type') ?? null,
        name: c.getAttribute('name') ?? null,
        id: c.getAttribute('id') ?? null,
        maxlength: c.getAttribute('maxlength') ?? null,
        placeholder: c.getAttribute('placeholder') ?? null,
        accessibleName: accessibleName(c),
      });
      return {
        title: document.title ?? '',
        links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
        forms: [...document.querySelectorAll('form')].map((f) => ({
          action: f.getAttribute('action') ?? '',
          method: (f.getAttribute('method') ?? 'get').toLowerCase(),
          controls: [...f.querySelectorAll('input,select,textarea')].map(describe),
        })),
        // selection-v1.0.24, corrected. Controls are counted across the WHOLE DOCUMENT, not only
        // inside `<form>` elements. The NZSIS reporting portal has no `<form>` at all - it is a
        // JavaScript application with bare inputs and a submit button - so the first version of
        // this reported "0 forms" for a page carrying First, Middle and Last name fields, and the
        // operator wrote `no-candidates` off that summary. Assuming classic markup is the same
        // mistake as assuming server-rendered markup, one level further in: the rule renders the
        // DOM, so the extraction has to read the DOM as it is.
        controls: [...document.querySelectorAll('input,select,textarea')]
          // Case-insensitively: HTML attribute values are not case-sensitive here, so
          // `type="HIDDEN"` slipped through the first version and would have been counted as a
          // control a person fills in.
          .filter((c) => (c.getAttribute('type') ?? 'text').trim().toLowerCase() !== 'hidden')
          .map(describe),
        buttons: document.querySelectorAll('button,input[type=submit]').length,
        // Whether script actually changed the document is the fact that justifies this whole
        // command, so it is measured rather than assumed.
        domNodes: document.getElementsByTagName('*').length,
      };
    });

    const html = await page.evaluate(() => document.documentElement.outerHTML);
    writeFileSync(target, html, 'utf8');

    return {
      url,
      refused: false,
      redirectChain: guard.redirectChain,
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
      // Amendment 59. The structural report, persisted on the render as well as the capture.
      ...structuralReport(blocking),
      title: found.title,
      domNodes: found.domNodes,
      links: [...new Set(found.links)],
      forms: found.forms,
      controls: found.controls,
      buttons: found.buttons,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
