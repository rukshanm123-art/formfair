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
 *
 * selection-v1.0.21. Three of these are technical attrition, not findings about the agency, and
 * they exist because `no-candidates` was about to be used for all three. `no-candidates` asserts
 * that a page was read and contained nothing; saying that of a page nobody could read turns a
 * failure of the method into a fact about the ministry, and the prevalence denominator then
 * counts an agency as searched when it was not.
 *
 *   robots-unestablished    No request was made. The host answered /robots.txt with something
 *                           that is not a robots representation, so no policy could be read and
 *                           discovery was withheld. Not a refusal by the host.
 *   retrieval-blocked       A request was made and answered with a challenge or a refusal. No
 *                           agency content and no candidate judgement was obtained.
 *   retrieval-inconclusive  A request was made and succeeded, but the retrieval obtained nothing
 *                           on which a candidate judgement could rest - a client-rendered shell
 *                           whose content never arrives in the markup, for instance. The page is
 *                           neither absent nor empty; this method could not read it.
 */
export const DISCOVERY_OUTCOMES = Object.freeze([
  'candidates-found',
  'no-candidates',
  'unavailable',
  'disallowed',
  'robots-unestablished',
  'retrieval-blocked',
  'retrieval-inconclusive',
  // selection-v1.0.25. An observation, not a judgement: the DOM was retrieved and retained and
  // nothing has yet been concluded from it. It exists because `render-discovery` required
  // `--outcome` before the page had been rendered, which is exactly how a page carrying three name
  // fields came to be recorded `no-candidates`. Judgement is now a separate record.
  'rendered',
]);

/** Outcomes that are a judgement about whether a page yields candidates. */
export const JUDGEMENT_OUTCOMES = Object.freeze(['candidates-found', 'no-candidates']);

/** How a discovery record came to exist. */
export const RECORD_TYPES = Object.freeze({
  /** A retrieval that happened, under a permit. Carries evidence, concludes nothing. */
  OBSERVATION: 'observation',
  /** A conclusion drawn from evidence already held. Makes no request. */
  JUDGEMENT_ONLY: 'judgement-only',
  /**
   * A re-reading of bytes already retrieved, under a corrected classifier. Amendment 48.
   *
   * Amendment 46 wrote its correction as an OBSERVATION, and an observation means a retrieval: it
   * must name the permit that authorised the request, carry the time of that request, and declare
   * that navigation occurred. `d-0684` could satisfy none of those honestly, because no request was
   * made - and the alternative, copying `p-0285` and its navigation time onto a second record,
   * would have made two records claim one retrieval and dressed a metadata correction as traffic.
   *
   * So the third kind is named. It makes no request, holds no permit and no navigation time,
   * supersedes the record whose classification it corrects, and cites the render carrying the
   * corrected metadata for the SAME retained bytes.
   */
  RECLASSIFICATION: 'reclassification',
  /**
   * A TECHNICAL conclusion about a render the server failed to serve. Amendment 54.
   *
   * `https://www.sia.govt.nz/search/SearchForm?Search=register` returned HTTP 500 - the agency's
   * own themed error page, byte-identical for both search terms, while its home page returned 200.
   * The render succeeded: a page loaded and its DOM was captured. What did not happen is the
   * SEARCH, so nothing about the page bears on whether the agency publishes a registration form.
   *
   * A judgement may only record `candidates-found` or `no-candidates`, and Amendment 39 requires
   * every rendered observation to carry one. `no-candidates` there would assert that the search
   * found nothing - the overclaim already recorded against this study as deviation `v-0001`'s
   * sibling `v-0002`, and the reason the ECART note had to be narrowed.
   *
   * So the fourth kind is named. It records `retrieval-inconclusive`, discharges the
   * unjudged-render obligation, and counts as unresolved technical attrition: it contributes no
   * read-content finding, no candidate and no recovered barrier. Which conclusion a render may
   * carry is decided by the HTTP status the RENDER recorded, in both directions.
   */
  TECHNICAL_CONCLUSION: 'technical-conclusion',
});

/** The one outcome a technical conclusion may record. */
export const TECHNICAL_CONCLUSION_OUTCOME = 'retrieval-inconclusive';

/** Did the server actually serve the page? Read from the render, never from a conclusion. */
export function isServedStatus(httpStatus) {
  return Number.isInteger(httpStatus) && httpStatus >= 200 && httpStatus <= 299;
}

/**
 * Is this a status a server actually sent? `0` is what a crashed or aborted fetch leaves behind,
 * not a response, and reading it as "not served" would let a failed request pick the conclusion
 * that suits it. Anything outside the HTTP range refuses every conclusion instead.
 */
export function isUsableStatus(httpStatus) {
  return Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599;
}

/**
 * The outcomes that record attrition in the discovery method rather than a property of the
 * agency. Reported separately so that "searched and found nothing" is never silently merged
 * with "could not be searched".
 */
export const TECHNICAL_ATTRITION_OUTCOMES = Object.freeze([
  'robots-unestablished',
  'retrieval-blocked',
  'retrieval-inconclusive',
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
export function remainingBudget(attempts, { agency, category, url = null }) {
  // Amendment 40. DISTINCT canonical candidate URLs, not attempt records.
  //
  // The bound is five candidates per category, and it counted every non-discovery attempt - so a
  // candidate that was retrieved, found ineligible, rejected and superseded spent three of the five
  // slots by itself. Assessing NZDF's five locked URLs became impossible after two and a half of
  // them: `c-0498` could not even record the exclusion that resolved it. The frozen rule requires
  // all five locked candidates to be examined, so a bound that stops the third is not enforcing the
  // protocol, it is breaking it. Corrections and supersessions are preserved in the log and consume
  // no slot, because they are the same candidate examined once.
  //
  // A SIXTH distinct URL is still refused, which is what the bound is actually for.
  const isCandidate = (a) => a.agency === agency && a.status !== 'discovery';
  const keyOf = (a) => `${a.category ?? ''}\u0000${canonicalise(a.url)}`;
  const agencyUrls = new Set(attempts.filter(isCandidate).map(keyOf));
  const categoryUrls = new Set(
    attempts.filter((a) => isCandidate(a) && a.category === category).map(keyOf)
  );

  // An attempt for a URL already counted is a further record about the SAME candidate and is
  // always allowed; only a new one has to fit inside the bound.
  const incoming = url === null ? null : `${category ?? ''}\u0000${canonicalise(url)}`;
  const alreadyCounted = incoming !== null && categoryUrls.has(incoming);
  const agencyFull = agencyUrls.size >= MAX_CANDIDATES_PER_AGENCY;
  const categoryFull = categoryUrls.size >= MAX_CANDIDATES_PER_CATEGORY;

  return {
    agencyRemaining: MAX_CANDIDATES_PER_AGENCY - agencyUrls.size,
    categoryRemaining: MAX_CANDIDATES_PER_CATEGORY - categoryUrls.size,
    distinctInAgency: agencyUrls.size,
    distinctInCategory: categoryUrls.size,
    exhausted: !alreadyCounted && (agencyFull || categoryFull),
  };
}

export const EFFORT_EXHAUSTED = 'effort bound exhausted — no eligible form located';

/**
 * The frozen draw order, read from the artefact rather than retyped.
 *
 * Agencies are attempted in this order and no other. The file is `frame-v1.0.0` material
 * and is never written by this package.
 */
/**
 * Splits one CSV line, honouring quoted fields.
 *
 * selection-v1.0.9. The frozen draw order DOES quote: two of the forty-five agencies have
 * commas in their names, and both are quoted in the file. The previous parser assumed
 * otherwise and reassembled the agency by joining the middle fields with commas, which
 * returned the name still wrapped in its literal quote characters -
 * `"Ministry of Business, Innovation and Employment"` with the quotes as part of the string.
 *
 * Nothing had noticed because the scan had not reached position 17 yet. It would have failed
 * there: the quoted name would not match the frame, would not match what an operator types,
 * and would key its candidate sets under a name no other artefact uses.
 */
export function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

export function parseDrawOrder(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('position,')) continue;
    const fields = splitCsvLine(line);
    if (fields.length < 3) continue;
    const [position, agency] = fields;
    if (!/^\d+$/.test(position)) continue;
    rows.push({ position: Number(position), agency, drawKey: fields[fields.length - 1] });
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
/**
 * The statuses that SETTLE a candidate. Amendment 41.
 *
 * `status !== 'discovery'` was the de facto test for "this candidate has been decided", and it was
 * correct while every non-discovery record was a decision. Amendment 40 added `retrieved`, which is
 * evidence and nothing else, and every one of those tests silently began accepting it. The
 * consequence, reproduced on a copy of the live log: delete the exclusion `c-0504`, mark the
 * retrieval `c-0503` approved, and `nextWork` advances to the next category while `corpusBlockers`
 * reports nothing - with `complete-signup/` never actually decided.
 *
 * So the notion is named once and shared. A retrieval is not here, and must never qualify, settle
 * or exhaust anything.
 */
export const TERMINAL_STATUSES = Object.freeze([
  'captured', 'excluded', 'eligible-not-selected', 'failed', 'capture-blocked',
]);

/** True for a record that decides a candidate. Evidence-only retrievals are excluded. */
export const isTerminalDecision = (attempt) => TERMINAL_STATUSES.includes(attempt?.status);

/** True for an evidence-only retrieval: bytes held, nothing concluded. */
export const isEvidenceOnly = (attempt) => attempt?.status === 'retrieved';

/**
 * The active terminal decisions for one candidate URL, by canonical URL within an agency.
 *
 * `supersededIds` is passed in rather than recomputed so that both packages can use their own
 * supersession walk without this function needing one.
 */
export function terminalDecisionsFor(attempts, { agency, url, supersededIds = new Set() }) {
  const want = canonicalise(url);
  return attempts.filter(
    (a) => a.agency === agency && isTerminalDecision(a) &&
      canonicalise(a.url) === want && !supersededIds.has(a.id)
  );
}

export function unfinishedFor(log, agency, { requireEveryCategory = true } = {}) {
  // An attempt that is pending or rejected is unfinished business for this agency, and work
  // does not move past it - not to the next candidate, not to the next category and not to the
  // next agency. A rejected decision must be superseded by a corrected one.
  // Amendment 41. A retrieval carries no approval at all, so it is neither pending business nor a
  // resolution; it is excluded here rather than left to be read as one.
  const unresolved = log.attempts.filter(
    (a) => a.agency === agency && a.status !== 'discovery' && !isEvidenceOnly(a) &&
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
    // Amendment 41. TERMINAL decisions only. An evidence-only retrieval settles nothing, and
    // counting it here is what let the category advance with `complete-signup/` undecided.
    const superseded = new Set(
      log.attempts.map((a) => a.supersedesAttemptId).filter((id) => id !== undefined && id !== null)
    );
    const pending = set.locked.filter(
      (u) => terminalDecisionsFor(log.attempts, { agency, url: u, supersededIds: superseded }).length === 0
    );
    if (pending.length > 0) return { agency, category, pending };
    // Exactly one, not at least one: two live decisions about one candidate leave the category
    // with two answers and no way to say which it acted on.
    const contested = set.locked
      .map((u) => ({ url: u, decisions: terminalDecisionsFor(log.attempts, { agency, url: u, supersededIds: superseded }) }))
      .filter((c) => c.decisions.length > 1);
    if (contested.length > 0) {
      return {
        agency, category,
        contested: contested.map((c) => ({ url: c.url, decisions: c.decisions.map((d) => d.id) })),
        reason: 'a locked candidate has more than one active terminal decision',
      };
    }
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
