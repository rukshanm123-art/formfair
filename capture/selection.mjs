/**
 * The bounded search rule (Amendment 2 to the solo protocol).
 *
 * The frozen draw order fixes which agency is attempted and in what order. It does not fix
 * how hard to look inside one, and that decides the achieved sample just as much. Deciding
 * effort per agency would make "attempted" mean something different each time and invite
 * exactly the selection-bias question the draw order exists to answer, so the bound is
 * fixed here, before the first agency, and enforced rather than remembered.
 */

/** The ten frozen search terms, mapped to the categories they belong to. */
export const SEARCH_TERMS = Object.freeze({
  'account-registration': ['register', 'sign up'],
  'service-application': ['apply', 'application', 'tono'],
  'enquiry-or-contact': ['contact', 'enquiry', 'whakapā'],
  'subscription-or-newsletter': ['subscribe', 'newsletter'],
});

/** Category order, and the effort bound. */
export const CATEGORY_ORDER = Object.freeze([
  'account-registration',
  'service-application',
  'enquiry-or-contact',
  'subscription-or-newsletter',
]);

export const MAX_CANDIDATES_PER_CATEGORY = 5;
export const MAX_CANDIDATES_PER_AGENCY = MAX_CANDIDATES_PER_CATEGORY * CATEGORY_ORDER.length; // 20

/** Where a candidate URL came from. Discovery pages are logged, not treated as candidates. */
export const DISCOVERY_KINDS = Object.freeze(['navigation', 'sitemap', 'internal-search']);

/**
 * Canonical form of a URL, for deduplication and for the alphabetical tie-break.
 *
 * Query parameters are KEPT: on government sites a form is routinely identified by one,
 * and dropping them would merge distinct forms into a single candidate. Fragments are
 * removed because they never reach the server. Scheme and host are lowercased and a
 * default port removed, because those differ without the resource differing.
 *
 * `canonicalLink` is the page's own <link rel="canonical"> when it has a valid absolute
 * one; otherwise the final URL after redirects is used.
 */
export function canonicalise(finalUrl, canonicalLink = null) {
  let chosen = finalUrl;
  if (typeof canonicalLink === 'string' && canonicalLink.trim() !== '') {
    try {
      const candidate = new URL(canonicalLink, finalUrl);
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') chosen = candidate.href;
    } catch {
      // An unparsable canonical link is ignored; the final URL is used instead.
    }
  }
  const u = new URL(chosen);
  u.hash = '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }
  return u.href;
}

/** Deduplicates canonical URLs and sorts them, which is how the tie-break is decided. */
export function orderCandidates(urls) {
  return [...new Set(urls.map((u) => canonicalise(u)))].sort();
}

/**
 * How many candidates remain within the bound.
 *
 * Counts only form candidates. Discovery pages - a sitemap, a search results page, a
 * landing page inspected to find links - are recorded in the log for auditability but do
 * not consume the bound, because they are not forms being assessed.
 */
export function remainingBudget(attempts, { agency, category }) {
  const isCandidate = (a) => a.agency === agency && a.status !== 'discovery';
  const inAgency = attempts.filter(isCandidate).length;
  const inCategory = attempts.filter((a) => isCandidate(a) && a.category === category).length;
  return {
    agencyRemaining: MAX_CANDIDATES_PER_AGENCY - inAgency,
    categoryRemaining: MAX_CANDIDATES_PER_CATEGORY - inCategory,
    exhausted: inAgency >= MAX_CANDIDATES_PER_AGENCY || inCategory >= MAX_CANDIDATES_PER_CATEGORY,
  };
}

export const EFFORT_EXHAUSTED = 'effort bound exhausted — no eligible form located';
