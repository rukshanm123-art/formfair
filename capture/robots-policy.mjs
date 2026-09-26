/**
 * The robots policy for one origin, fetched once and recorded.
 *
 * Three defects this exists to fix.
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
 *
 * selection-v1.0.21. And a 200 was taken as proof that a robots file had been served. All three
 * New Zealand Security Intelligence Service hosts sit behind Imperva/Incapsula, which answers
 * `/robots.txt` with HTTP 200 and a 212-byte HTML challenge page. `parseRobots` finds no
 * directives in HTML, `isAllowed` then reports "no applicable rule", and the log recorded that
 * robots permitted `/user/register` on the evidence of a document that is not a robots file and
 * says nothing about crawling. Six requests were authorised that way.
 *
 * RFC 9309 section 2.3 requires the representation to be UTF-8 `text/plain`. A 2xx that is not
 * one establishes no policy at all - which is neither permission nor refusal - so it gets its own
 * disposition rather than being forced into one of the two that make a claim.
 */

import { createHash } from 'node:crypto';
import { parseRobots, isAllowed } from './politeness.mjs';

export const DISPOSITION = Object.freeze({
  /** 2xx carrying a valid UTF-8 text/plain representation: its rules govern. */
  RULES: 'rules',
  /** 4xx: unavailable. RFC 9309 section 2.3.1.3 - access is permitted. */
  ALLOW_ALL: 'allow-all',
  /** 5xx or network failure: unreachable. Section 2.3.1.4 - assume complete disallow. */
  DISALLOW_ALL: 'disallow-all',
  /**
   * 2xx, but not a robots representation: an HTML challenge page, some other media type, or
   * bytes that are not UTF-8. No policy was established.
   *
   * Deliberately none of the other three. It is not `rules`, because nothing was parsed. It is
   * not `allow-all`, because the host did serve something and we cannot read it. It is not
   * `disallow-all`, because the host has not refused anything - asserting that it had would put
   * a refusal in the record that no server ever made. And it is not a finding about the agency's
   * forms: it is technical attrition in the discovery method, reported as such.
   */
  UNESTABLISHED: 'unestablished',
});

/**
 * Documents that are recognisably bot management rather than content.
 *
 * Detection is for the RECORD, not for the decision: HTML disqualifies a robots representation
 * whether or not we can name the vendor. Naming it is what lets the deviation say what was
 * actually served instead of "unparseable".
 */
const CHALLENGE_SIGNATURES = Object.freeze([
  ['Imperva/Incapsula', /_Incapsula_Resource|Incapsula incident ID/i],
  ['Cloudflare', /cf-browser-verification|__cf_chl|cf_chl_opt|Attention Required!\s*\|\s*Cloudflare/i],
  ['Akamai', /AkamaiGHost|Access Denied[\s\S]{0,200}Reference #/i],
  ['AWS WAF', /awswaf|aws-waf-token/i],
]);

/** Does this text look like markup rather than a line-oriented robots file? */
const looksLikeMarkup = (text) =>
  /^\s*(<\?xml|<!DOCTYPE|<html\b|<head\b)/i.test(text) || /<(html|head|body|script)\b/i.test(text);

/**
 * Is this 2xx response a robots representation at all?
 *
 * The three conditions RFC 9309 section 2.3 gives, checked separately so the record says which
 * one failed. An EMPTY `text/plain` body passes: a server may legitimately publish a robots file
 * with no rules, and that means everything is allowed. Requiring at least one directive would
 * turn a real, permissive policy into an unreadable one.
 */
export function classifyRepresentation({ contentType = null, bytes = null } = {}) {
  const mediaType = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : null;
  const parameters = typeof contentType === 'string' ? contentType.slice(contentType.indexOf(';') + 1) : '';

  let text = null;
  let utf8 = true;
  if (bytes !== null) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      utf8 = false;
    }
  }
  const challenge = text === null ? null
    : (CHALLENGE_SIGNATURES.find(([, pattern]) => pattern.test(text))?.[0] ?? null);

  if (mediaType === null) {
    return { valid: false, reason: 'the response carried no content type', mediaType: null, challenge, text: null };
  }
  if (mediaType !== 'text/plain') {
    return {
      valid: false,
      reason: `the media type was ${mediaType}, not text/plain`,
      mediaType, challenge, text: null,
    };
  }
  if (!utf8) {
    return { valid: false, reason: 'the bytes are not valid UTF-8', mediaType, challenge: null, text: null };
  }
  // text/plain that is nonetheless a markup document. A server can label anything text/plain;
  // the media type is a claim, and this is the claim being checked rather than trusted.
  if (looksLikeMarkup(text)) {
    return {
      valid: false,
      reason: challenge
        ? `the body is a ${challenge} challenge document served as text/plain`
        : 'the body is a markup document served as text/plain',
      mediaType, challenge, text: null,
    };
  }
  return {
    valid: true,
    reason: text.trim() === '' ? 'an empty text/plain robots file: no rules' : 'a UTF-8 text/plain robots file',
    mediaType,
    // `charset` other than UTF-8 is not fatal: the bytes decoded as UTF-8, which is what
    // section 2.3 asks of them, and a mislabelled charset on ASCII directives is routine.
    charset: /charset\s*=\s*([^;]+)/i.exec(parameters)?.[1]?.trim()?.toLowerCase() ?? null,
    challenge: null,
    text,
  };
}

/**
 * What a status code alone establishes.
 *
 * Note what this does NOT do: a 2xx never returns `rules` here. A status code says a response
 * arrived, not that the response was a robots file, and treating the two as the same thing is
 * precisely the defect that authorised six requests against a challenge page. The 2xx branch
 * needs the representation, so it is decided by `classifyResponse`.
 */
export function dispositionForStatus(status) {
  if (status === null) return DISPOSITION.DISALLOW_ALL; // network failure or timeout
  if (status >= 200 && status < 300) return DISPOSITION.UNESTABLISHED;
  if (status >= 400 && status < 500) return DISPOSITION.ALLOW_ALL;
  return DISPOSITION.DISALLOW_ALL;
}

/** The disposition for a whole response: status, and for a 2xx its representation. */
export function classifyResponse({ status, contentType = null, bytes = null }) {
  if (status === null || status < 200 || status >= 300) {
    return { disposition: dispositionForStatus(status), representation: null };
  }
  const representation = classifyRepresentation({ contentType, bytes });
  return {
    disposition: representation.valid ? DISPOSITION.RULES : DISPOSITION.UNESTABLISHED,
    representation,
  };
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
  let contentType = null;
  let bytes = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
      status = res.status;
      if (status >= 200 && status < 300) {
        contentType = res.headers?.get?.('content-type') ?? null;
        bytes = Buffer.from(await res.arrayBuffer());
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    status = null;
    contentType = null;
    bytes = null;
  }

  const { disposition, representation } = classifyResponse({ status, contentType, bytes });
  const received = bytes ?? Buffer.alloc(0);
  return {
    origin: new URL(origin).origin,
    url,
    fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    httpStatus: status,
    disposition,
    contentType,
    // Hashed and sized as RECEIVED, so an unestablished policy still carries evidence of what
    // arrived. The body itself is kept only when it is a policy; a challenge page is not one,
    // and storing it as `body` would invite it being parsed as though it were.
    sha256: createHash('sha256').update(received).digest('hex'),
    bytes: received.length,
    body: disposition === DISPOSITION.RULES ? representation.text : '',
    representation: representation
      ? {
          valid: representation.valid,
          reason: representation.reason,
          mediaType: representation.mediaType,
          charset: representation.charset ?? null,
          challenge: representation.challenge ?? null,
        }
      : null,
  };
}

/**
 * Applies a recorded policy to one path.
 *
 * `disallow-all` and `unestablished` both refuse everything except `/robots.txt` itself:
 * re-reading the policy file must stay possible, or an origin whose server failed once, or
 * answered with a challenge once, could never be re-checked.
 */
export function evaluatePolicy(policy, pathWithQuery, userAgent = 'chromium') {
  // RFC 9309 section 2.2.2: "The /robots.txt URI is implicitly allowed." It is not that a
  // `Disallow: /` file forbids its own policy file and we choose to override that - the rule
  // never reaches it. Treating it as governed made a robots inspection record ITSELF as not
  // navigated, while carrying a note describing contents only reading it could supply.
  if (pathWithQuery === '/robots.txt') {
    return { allowed: true, reason: 'the policy file itself is always retrievable', crawlDelay: null };
  }
  if (policy?.disposition === DISPOSITION.ALLOW_ALL) {
    return { allowed: true, reason: `robots.txt unavailable (HTTP ${policy.httpStatus}); RFC 9309 permits access`, crawlDelay: null };
  }
  if (policy?.disposition === DISPOSITION.DISALLOW_ALL) {
    const why = policy.httpStatus === null ? 'could not be reached' : `returned HTTP ${policy.httpStatus}`;
    return {
      allowed: false,
      reason: `robots.txt ${why}; RFC 9309 section 2.3.1.4 requires assuming complete disallow`,
      crawlDelay: null,
    };
  }
  // `unestablished` is refused, but it is NOT a disallow, and the flag is what stops a caller
  // recording it as one. A record saying this host disallows the path would attribute to the
  // agency a refusal it never made.
  if (policy?.disposition === DISPOSITION.UNESTABLISHED) {
    const r = policy.representation ?? {};
    const what = r.challenge
      ? `a ${r.challenge} challenge document`
      : (r.reason ?? 'not a robots representation');
    return {
      allowed: false,
      unestablished: true,
      reason:
        `robots.txt returned HTTP ${policy.httpStatus ?? '?'} but ${what}; RFC 9309 section 2.3 ` +
        'requires a UTF-8 text/plain representation, so no policy is established and automated ' +
        'discovery is withheld for this origin',
      crawlDelay: null,
    };
  }
  return isAllowed(parseRobots(policy?.body ?? ''), pathWithQuery, userAgent);
}
