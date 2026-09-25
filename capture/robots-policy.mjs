/**
 * The robots policy for one origin, fetched once and recorded.
 *
 * Two defects this exists to fix.
 *
 * The previous code treated every non-2xx response and every network failure the same way: no
 * rules, therefore permitted. RFC 9309 does not say that. A 4xx means the file is *unavailable*
 * and the crawler may access the site (section 2.3.1.3); a 5xx or a network failure means the
 * file is *unreachable*, and the crawler is to assume complete disallow (2.3.1.4). Collapsing the
 * two turns a server having a bad afternoon into permission to crawl it.
 *
 * And the fetch lived in a per-process cache, so every one-shot CLI invocation re-requested
 * `robots.txt`. A scan that records twenty-six inspections made twenty-six extra robots requests
 * that appear in nobody's log - invisible traffic produced by the very machinery meant to make
 * traffic accountable. The policy is now written into the capture log and reused.
 */

import { createHash } from 'node:crypto';
import { parseRobots, isAllowed } from './politeness.mjs';

export const DISPOSITION = Object.freeze({
  /** 2xx: the file was served; its rules govern. */
  RULES: 'rules',
  /** 4xx: unavailable. RFC 9309 section 2.3.1.3 - access is permitted. */
  ALLOW_ALL: 'allow-all',
  /** 5xx or network failure: unreachable. Section 2.3.1.4 - assume complete disallow. */
  DISALLOW_ALL: 'disallow-all',
});

export function dispositionForStatus(status) {
  if (status === null) return DISPOSITION.DISALLOW_ALL; // network failure or timeout
  if (status >= 200 && status < 300) return DISPOSITION.RULES;
  if (status >= 400 && status < 500) return DISPOSITION.ALLOW_ALL;
  return DISPOSITION.DISALLOW_ALL;
}

/**
 * Fetches `robots.txt` for one origin, exactly once.
 *
 * Redirects are followed by `fetch`; a redirect chain that does not resolve surfaces as a network
 * failure, which is the conservative reading.
 */
export async function fetchRobotsPolicy(origin, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const url = new URL('/robots.txt', origin).href;
  let status = null;
  let body = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
      status = res.status;
      if (status >= 200 && status < 300) body = await res.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    status = null;
  }
  const disposition = dispositionForStatus(status);
  return {
    origin: new URL(origin).origin,
    url,
    fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    httpStatus: status,
    disposition,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body),
    body: disposition === DISPOSITION.RULES ? body : '',
  };
}

/**
 * Applies a recorded policy to one path.
 *
 * `disallow-all` refuses everything except `/robots.txt` itself: re-reading the policy file must
 * stay possible, or an origin whose server failed once could never be re-checked.
 */
export function evaluatePolicy(policy, pathWithQuery, userAgent = 'chromium') {
  if (policy?.disposition === DISPOSITION.ALLOW_ALL) {
    return { allowed: true, reason: `robots.txt unavailable (HTTP ${policy.httpStatus}); RFC 9309 permits access`, crawlDelay: null };
  }
  if (policy?.disposition === DISPOSITION.DISALLOW_ALL) {
    if (pathWithQuery === '/robots.txt') {
      return { allowed: true, reason: 'the policy file itself is always retrievable', crawlDelay: null };
    }
    const why = policy.httpStatus === null ? 'could not be reached' : `returned HTTP ${policy.httpStatus}`;
    return {
      allowed: false,
      reason: `robots.txt ${why}; RFC 9309 section 2.3.1.4 requires assuming complete disallow`,
      crawlDelay: null,
    };
  }
  return isAllowed(parseRobots(policy?.body ?? ''), pathWithQuery, userAgent);
}
