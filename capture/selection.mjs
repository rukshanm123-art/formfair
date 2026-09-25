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

/**
 * How a discovery page was reached.
 *
 * `robots` is its own method. Earlier rounds recorded a robots.txt fetch as `sitemap`,
 * which made the provenance say something untrue about how the page was found and made the
 * published method counts wrong.
 */
export const DISCOVERY_METHODS = Object.freeze(['navigation', 'sitemap', 'internal-search', 'robots']);

/** Kept as the old name so existing callers and records still resolve. */
export const DISCOVERY_KINDS = DISCOVERY_METHODS;

/**
 * What the inspection established. A method that turned out not to exist, or to be
 * forbidden, is a finding about the agency and has to be as visible as a method that
 * produced candidates.
 */
export const DISCOVERY_OUTCOMES = Object.freeze([
  'candidates-found',
  'no-candidates',
  'unavailable',
  'disallowed',
]);

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

/**
 * The frozen draw order, read from the artefact rather than retyped.
 *
 * Agencies are attempted in this order and no other. The file is `frame-v1.0.0` material
 * and is never written by this package.
 */
export function parseDrawOrder(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('position,')) continue;
    const [position, ...rest] = line.split(',');
    if (!/^\d+$/.test(position)) continue;
    // The agency name may contain commas only if quoted; the frozen file does not quote,
    // so the draw key is the last field and the agency is everything between.
    const key = rest[rest.length - 1];
    const agency = rest.slice(0, -1).join(',');
    rows.push({ position: Number(position), agency, drawKey: key });
  }
  return rows.sort((a, b) => a.position - b.position);
}

export const MAX_QUALIFIED_AGENCIES = 40;

/** The key a candidate set is stored under. */
export const setKey = (agency, category) => `${agency}\u0000${category}`;

/**
 * Locks a category's candidate set: canonicalise, deduplicate, sort, take the first five.
 *
 * Locking is what makes the ordering rule operational rather than merely documented. After
 * this, only a URL in the locked set may be assessed, so the set cannot grow once its
 * members start producing outcomes.
 */
export function lockCandidates(discovered) {
  const ordered = orderCandidates(discovered);
  return { ordered, locked: ordered.slice(0, MAX_CANDIDATES_PER_CATEGORY) };
}

/**
 * Which agency may be worked on next, and which category within it.
 *
 * Both are derived from the frozen order and the log, never supplied by the caller, so an
 * agency cannot be skipped because its forms look interesting and a lower-priority
 * category cannot be reached before a higher one is finished.
 */
/**
 * Has this agency been recorded as exhausted?
 *
 * selection-v1.0.8. `log.exhausted` now holds a record per agency rather than a bare name, so
 * that an exhaustion carries its timestamp, its reason and the category-set versions it rests
 * on. A bare string is still recognised, because a log written before this change would
 * otherwise silently stop counting as exhausted and the agency would be re-offered as work.
 */
export function isExhausted(log, agency) {
  return (log.exhausted ?? []).some((e) => (typeof e === 'string' ? e : e?.agency) === agency);
}

/**
 * What this agency still has outstanding, or null.
 *
 * `requireEveryCategory` distinguishes the two callers. For an agency still being worked, a
 * category with no set yet is work to do. For an agency that has already qualified, it is not:
 * qualification is precisely what stops the later categories being searched.
 */
export function unfinishedFor(log, agency, { requireEveryCategory = true } = {}) {
  // An attempt that is pending or rejected is unfinished business for this agency, and work
  // does not move past it - not to the next candidate, not to the next category and not to the
  // next agency. A rejected decision must be superseded by a corrected one.
  const unresolved = log.attempts.filter(
    (a) => a.agency === agency && a.status !== 'discovery' &&
      (a.approval === 'pending' || (a.approval === 'rejected' && !isSuperseded(log, a)))
  );
  if (unresolved.length > 0) {
    return {
      agency,
      category: unresolved[0].category,
      blocked: unresolved.map((a) => ({ url: a.url, approval: a.approval })),
      reason: 'outcomes are pending or rejected and must be resolved before work continues',
    };
  }

  for (const category of CATEGORY_ORDER) {
    const set = log.candidateSets?.[setKey(agency, category)];
    if (!set) {
      if (requireEveryCategory) return { agency, category, needsLock: true };
      continue;
    }
    if (!set.lockedAt) return { agency, category, needsLock: true };
    if (set.approval !== 'approved') {
      return {
        agency, category, needsSetApproval: true,
        locked: set.locked,
        reason: `the locked candidate set is ${set.approval ?? 'pending'} and must be approved before assessment`,
      };
    }
    const outcomes = new Set(
      log.attempts.filter((a) => a.agency === agency && a.status !== 'discovery').map((a) => a.url)
    );
    const pending = set.locked.filter((u) => !outcomes.has(u));
    if (pending.length > 0) return { agency, category, pending };
    // Every locked candidate has an approved outcome and none qualified: the category is
    // finished, not abandoned, so the next one may be searched.
  }
  return null;
}

export function nextWork(log, drawOrder) {
  // Only an APPROVED capture qualifies an agency. Counting a pending one would let forty
  // unreviewed captures end the scan, which is the opposite of what the approval gate is
  // for. A rejected capture does not qualify anything either.
  const qualified = new Set(
    log.attempts.filter((a) => a.status === 'captured' && a.approval === 'approved').map((a) => a.agency)
  );
  if (qualified.size >= MAX_QUALIFIED_AGENCIES) {
    return { done: true, reason: `${MAX_QUALIFIED_AGENCIES} agencies have qualified` };
  }
  // selection-v1.0.7. A qualified agency is skipped, but only once it has nothing left
  // outstanding. Skipping on qualification alone hid a correction in progress: Te Puni Kokiri
  // had an approved capture, so its superseded-and-redone service-application set - locked and
  // awaiting approval - was stepped over entirely, and the scan moved on as though the
  // correction had been finished.
  //
  // A category this agency never searched is NOT outstanding. Qualification is what stops the
  // remaining categories being searched, so counting them as unfinished would make every
  // qualified agency permanently blocked.
  for (const row of drawOrder) {
    if (qualified.has(row.agency)) {
      const outstanding = unfinishedFor(log, row.agency, { requireEveryCategory: false });
      if (outstanding) return outstanding;
      continue;
    }
    if (isExhausted(log, row.agency)) continue;

    const outstanding = unfinishedFor(log, row.agency, { requireEveryCategory: true });
    if (outstanding) return outstanding;
    return { agency: row.agency, exhaustedAgency: true };
  }
  return { done: true, reason: 'all agencies in the frozen order have been attempted' };
}

/**
 * A rejected decision is resolved only by a later attempt that explicitly supersedes it.
 *
 * Both forms count. `supersedesAttemptId` (capture-v1.0.3) names the decision it corrects
 * and is the form to use; `supersedes: <url>` is the earlier form, still honoured so that
 * corrections already in the log keep their meaning.
 */
export function isSuperseded(log, attempt) {
  return log.attempts.some(
    (a) =>
      (attempt.id !== undefined && a.supersedesAttemptId === attempt.id) ||
      (a.supersedesAttemptId === undefined &&
        a.supersedes === attempt.url &&
        a.agency === attempt.agency)
  );
}
