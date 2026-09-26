/**
 * The run state, and the guarantee that the ledger and the draft agree.
 *
 * Capture, ledger row and draft entry were three separate calls, so nothing stopped a
 * successful capture from being missing from the ledger, or a ledger row from naming a
 * page the draft did not contain. They are not separate any more: `capture-log.json` is
 * the one authoritative append-only record, and BOTH the selection ledger and the corpus
 * draft are derived from it. They cannot disagree because neither is written by hand.
 *
 * The log also carries what the protocol asks a researcher to decide rather than a tool:
 * the five eligibility criteria as an explicit checklist, the evidence for an INCLUSION
 * rather than only a reason for an exclusion, and an approval status that starts at
 * `pending`. Sealing refuses while anything is pending, so the corpus cannot be frozen on
 * judgements nobody confirmed.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { LEDGER_HEADER, recordExamination, CATEGORIES } from './capture.mjs';
import { POLICY } from './politeness.mjs';
import {
  DISCOVERY_KINDS, remainingBudget, MAX_CANDIDATES_PER_CATEGORY, MAX_CANDIDATES_PER_AGENCY,
  canonicalise, setKey, MAX_QUALIFIED_AGENCIES, CATEGORY_ORDER, lockCandidates, isSuperseded,
  DISCOVERY_METHODS, DISCOVERY_OUTCOMES, nextWork, isExhausted,
} from './selection.mjs';

export const LOG_SCHEMA = 'formfair/capture-log@1';

/** The five criteria from the frozen protocol, in its order and wording. */
export const ELIGIBILITY_CRITERIA = Object.freeze([
  'publiclyReachableWithoutSigningIn',
  'reachedFromFrameWebsiteForThatAgency',
  'asksForTheNameOfANaturalPerson',
  'nameFieldVisibleWithoutEnteringDataOrSubmitting',
  'normalHtmlOrBrowserRenderedNotPdfOrNative',
]);

export const APPROVAL = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const isoUtcish = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && v.endsWith('Z');

/** The most recent recorded top-level navigation, whatever produced it. */
function lastNavigation(log) {
  const times = log.attempts
    // selection-v1.0.11: a record that states no request was made must not contribute a
    // navigation time. The two `NOT NAVIGATED` search records carried `navigatedAt` and were
    // counted in the five-second pacing, so the raw data asserted a navigation the note denied.
    .filter((a) => a.navigationPerformed !== false)
    .map((a) => a.navigatedAt ?? a.capturedAt ?? null)
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter((n) => !Number.isNaN(n));
  return times.length ? Math.max(...times) : null;
}

export function emptyLog() {
  return {
    schema: LOG_SCHEMA, politeness: { ...POLICY }, attempts: [],
    candidateSets: {}, supersededCandidateSets: [], exhausted: [],
  };
}

export function readLog(path) {
  if (!existsSync(path)) return emptyLog();
  const log = JSON.parse(readFileSync(path, 'utf8'));
  if (log.schema !== LOG_SCHEMA) throw new Error(`capture log schema must be ${LOG_SCHEMA}`);
  return log;
}

/** Atomic write: a crash mid-write must not leave a half-parsed authoritative record. */
export function writeLog(path, log) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(log, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

function checkAttempt(attempt) {
  const problems = [];
  if (!attempt.agency) problems.push('agency is required');
  if (!attempt.website) problems.push('website is required');
  if (!attempt.url) problems.push('url is required');
  if (!['captured', 'excluded', 'failed', 'discovery'].includes(attempt.status)) {
    problems.push('status must be captured, excluded, failed or discovery');
  }
  if (attempt.status === 'discovery') {
    if (!DISCOVERY_METHODS.includes(attempt.discoveryKind)) {
      problems.push(`a discovery record needs a method from ${DISCOVERY_METHODS.join(', ')}`);
    }
    if (!DISCOVERY_OUTCOMES.includes(attempt.outcome)) {
      problems.push(`a discovery record needs an outcome from ${DISCOVERY_OUTCOMES.join(', ')}`);
    }
    // A discovery record that names neither the category it served nor the version of the
    // set it supports cannot be attributed to a round, which is what made the second round
    // indistinguishable from additions to the first.
    if (!CATEGORIES.includes(attempt.category)) {
      problems.push(`a discovery record needs the category it served, from ${CATEGORIES.join(', ')}`);
    }
    if (!Number.isInteger(attempt.candidateSetVersion) || attempt.candidateSetVersion < 1) {
      problems.push('a discovery record needs candidateSetVersion, the set version it supports');
    }
    // Discovery browsing is not performed by the capture harness, so its pacing cannot be
    // enforced by the pacer. It is recorded instead, and checked against the previous
    // navigation, so a run that went too fast is visible rather than merely promised.
    if (attempt.navigationPerformed === false) {
      // Nothing was requested, so there is no navigation time to record. It must say when the
      // policy was checked instead, and must not carry a navigation timestamp at all.
      if (attempt.navigatedAt !== undefined) {
        problems.push('a record that performed no navigation must not carry navigatedAt');
      }
      if (!isoUtcish(attempt.checkedAt)) {
        problems.push('a record that performed no navigation needs checkedAt as a UTC timestamp');
      }
    } else if (!isoUtcish(attempt.navigatedAt)) {
      problems.push('a discovery record needs navigatedAt as a UTC timestamp');
    }
  }
  if (attempt.status !== 'discovery') {
    for (const c of ELIGIBILITY_CRITERIA) {
      const v = attempt.eligibility?.[c];
      if (v !== true && v !== false && v !== null) {
        problems.push(`eligibility.${c} must be true, false or null`);
      }
    }
  }
  // A candidate with no category would not be counted against any category's limit, which
  // let five more account-registration candidates through after the limit was reached.
  if (attempt.status !== 'discovery' && !CATEGORIES.includes(attempt.category)) {
    problems.push(
      `every candidate needs a category from ${CATEGORIES.join(', ')}; omitting it would ` +
        'escape the per-category limit'
    );
  }
  if (attempt.status === 'captured') {
    if (!attempt.pageId) problems.push('a captured attempt needs a pageId');
    if (!attempt.file) problems.push('a captured attempt needs a file');
    if (!attempt.htmlSha256) problems.push('a captured attempt needs htmlSha256');
    // An inclusion must say WHY it qualified, not merely fail to say why it did not.
    if (!attempt.inclusionEvidence) problems.push('a captured attempt needs inclusionEvidence');
    if (ELIGIBILITY_CRITERIA.some((c) => attempt.eligibility[c] !== true)) {
      problems.push('a captured attempt must satisfy all five eligibility criteria');
    }
  }
  if (attempt.status !== 'captured' && attempt.status !== 'discovery' && !attempt.exclusionReason) {
    problems.push('a non-captured attempt needs an exclusionReason');
  }
  return problems;
}

/**
 * Appends one attempt. Rejects a duplicate pageId or URL so a rerun cannot silently
 * double-count, and refuses an attempt that fails its own checks rather than recording
 * something the seal will later have to interpret.
 */
export function appendAttempt(log, attempt) {
  const problems = checkAttempt(attempt);
  if (problems.length) throw new Error(`invalid capture attempt:\n  ${problems.join('\n  ')}`);
  if (attempt.pageId && log.attempts.some((a) => a.pageId === attempt.pageId)) {
    throw new Error(`pageId ${attempt.pageId} is already recorded`);
  }
  // Per AGENCY, not globally: a third-party form linked by two agencies is genuine
  // evidence for both, and refusing to record it for the second would hide that.
  if (attempt.status === 'discovery') {
    const sameRound = log.attempts.some(
      (a) => a.status === 'discovery' && a.agency === attempt.agency && a.url === attempt.url &&
        a.category === attempt.category && a.candidateSetVersion === attempt.candidateSetVersion
    );
    if (sameRound && !attempt.supersedesDiscoveryId) {
      throw new Error(
        `${attempt.url} is already recorded for ${attempt.agency} / ${attempt.category} ` +
          `round ${attempt.candidateSetVersion}. If that record is wrong, correct it with ` +
          'supersedesDiscoveryId rather than recording the page twice.'
      );
    }
  }

  // selection-v1.0.12. One wrong discovery record is corrected in place, without redoing a
  // whole round. A round of twenty-six inspections with one self-contradictory record does not
  // need twenty-five re-observations, and repeating them would mean re-requesting pages that
  // were legitimately retrieved under permits.
  if (attempt.supersedesDiscoveryId) {
    const target = log.attempts.find((a) => a.id === attempt.supersedesDiscoveryId);
    if (!target) {
      throw new Error(`supersedesDiscoveryId ${attempt.supersedesDiscoveryId} matches no recorded attempt`);
    }
    if (target.status !== 'discovery') {
      throw new Error(`${target.id} is a ${target.status} attempt; only a discovery record is corrected this way`);
    }
    for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
      ['candidateSetVersion', 'round'], ['url', 'url'], ['discoveryKind', 'method']]) {
      if (target[field] !== attempt[field]) {
        throw new Error(
          `a correction must be for the same ${label}: ${target.id} is ` +
            `${JSON.stringify(target[field])}, this record is ${JSON.stringify(attempt[field])}`
        );
      }
    }
    if (isDiscoverySuperseded(log, target.id)) {
      throw new Error(`${target.id} has already been corrected; correct the correction instead`);
    }
  }
  const priorForUrl = log.attempts.filter(
    (a) => a.status !== 'discovery' && a.agency === attempt.agency && a.url === attempt.url
  );
  // capture-v1.0.3: supersede by attempt id, not by URL. Superseding by URL was
  // unambiguous only while one attempt per URL could exist. Once a page can be attempted,
  // rejected and re-attempted, `supersedes: <url>` no longer says WHICH decision is being
  // corrected, and a third attempt would appear to supersede both of the first two.
  //
  // Checked whenever it is present, not only when the URL already has attempts. Validating
  // it inside that branch meant an id naming a DIFFERENT page was accepted in silence, and
  // the rejected decision it claimed to correct stayed open.
  if (attempt.supersedesAttemptId) {
    const target = log.attempts.find((a) => a.id === attempt.supersedesAttemptId);
    if (!target) {
      throw new Error(`supersedesAttemptId ${attempt.supersedesAttemptId} matches no recorded attempt`);
    }
    if (target.agency !== attempt.agency || target.url !== attempt.url) {
      throw new Error(
        `attempt ${target.id} is ${target.agency} / ${target.url}, which is not what this ` +
          `attempt supersedes (${attempt.agency} / ${attempt.url})`
      );
    }
    if (target.approval !== APPROVAL.REJECTED) {
      throw new Error(
        `attempt ${target.id} is ${target.approval}, not rejected; only a rejected decision ` +
          'is corrected by superseding it'
      );
    }
    if (isSuperseded(log, target)) {
      throw new Error(`attempt ${target.id} has already been superseded`);
    }
  } else if (priorForUrl.length > 0) {
    // A rejected decision is corrected by recording a NEW attempt that supersedes it. The
    // original stays in the log: a correction that erases what it corrected is not a
    // correction, and the ledger has to show what was decided first.
    const rejected = priorForUrl.filter((a) => a.approval === APPROVAL.REJECTED && !isSuperseded(log, a));
    if (attempt.supersedes !== attempt.url || rejected.length === 0) {
      throw new Error(
        `url ${attempt.url} is already recorded for ${attempt.agency}` +
          (rejected.length
            ? '. Its decision was rejected; record the correction with ' +
              `supersedesAttemptId set to ${rejected.map((a) => a.id).join(' or ')}.`
            : '')
      );
    }
  }
  if (attempt.status === 'captured') {
    const canonical = canonicalise(attempt.finalUrl ?? attempt.url);
    const already = log.attempts.find(
      (a) => a.status === 'captured' && canonicalise(a.finalUrl ?? a.url) === canonical
    );
    if (already) {
      throw new Error(
        `${canonical} was already captured for ${already.agency}. Record it for ` +
          `${attempt.agency} as excluded with reason "duplicate shared form" and continue ` +
          'searching; the same canonical page must not enter the corpus twice.'
      );
    }
  }
  // The five-second minimum between top-level navigations, checked rather than trusted.
  const at = Date.parse(attempt.navigatedAt ?? attempt.capturedAt ?? '');
  const previous = lastNavigation(log);
  if (!Number.isNaN(at) && previous !== null) {
    const gap = at - previous;
    if (gap < POLICY.minDelayBetweenNavigationsMs) {
      throw new Error(
        `only ${gap} ms since the previous navigation; the policy requires at least ` +
          `${POLICY.minDelayBetweenNavigationsMs} ms between top-level navigations.`
      );
    }
    attempt.msSincePreviousNavigation = gap;
  }

  // Only a URL from the locked candidate set may be assessed. Locking happens after
  // canonicalisation, deduplication and sorting, so the set cannot grow once its members
  // start producing outcomes - which is what makes the ordering rule operational.
  if (attempt.status !== 'discovery') {
    const set = log.candidateSets?.[setKey(attempt.agency, attempt.category)];
    if (!set?.lockedAt) {
      throw new Error(
        `no locked candidate set for ${attempt.agency} / ${attempt.category}. ` +
          'Record the discovered URLs and lock the set before assessing any of them.'
      );
    }
    if (set.approval !== APPROVAL.APPROVED) {
      throw new Error(
        `the candidate set for ${attempt.agency} / ${attempt.category} is ` +
          `${set.approval ?? 'pending'}. The researcher approves the candidate set before ` +
          'any of it is assessed, because that set is where the judgement sits.'
      );
    }
    if (!set.locked.includes(canonicalise(attempt.url))) {
      throw new Error(
        `${attempt.url} is not in the locked candidate set for ${attempt.agency} / ` +
          `${attempt.category}. The set was locked at ${set.lockedAt}.`
      );
    }
  }

  // The effort bound, enforced rather than remembered. Discovery pages do not consume it:
  // a sitemap or a search results page is inspected to FIND candidates, it is not one.
  if (attempt.status !== 'discovery') {
    const budget = remainingBudget(log.attempts, { agency: attempt.agency, category: attempt.category });
    if (budget.exhausted) {
      throw new Error(
        `effort bound reached for ${attempt.agency}: at most ${MAX_CANDIDATES_PER_CATEGORY} candidates ` +
          `per category and ${MAX_CANDIDATES_PER_AGENCY} per agency. Record the agency as ` +
          'exhausted and move to the next in the frozen order.'
      );
    }
  }
  // Assigned AFTER the spread: a caller passing `id: undefined` must not wipe it, which is
  // exactly what an object built from a template with optional fields does.
  const id = attempt.id ?? `${attempt.status === 'discovery' ? 'd' : 'c'}-${String(log.attempts.length + 1).padStart(4, '0')}`;
  log.attempts.push({ approval: APPROVAL.PENDING, ...attempt, id });
  return log;
}

/**
 * Records discovered candidate URLs for one agency and category.
 *
 * Discovery and assessment are deliberately separate steps. While a set is open it may
 * grow; once locked it cannot, and only then may its members be assessed. That ordering is
 * what stops a candidate being added after an earlier one has already produced an outcome.
 */
/**
 * The discovery records a set stands on: the ones it is bound to, or failing that its round.
 *
 * A locked set names its supporting records, and those are what it claims as evidence, so
 * they are what gets rechecked. A set not yet locked has none, and falls back to its round.
 */
function supportingRecords(log, set) {
  const where = `${set.agency} / ${set.category}`;

  // selection-v1.0.6. A locked set stands on its binding, and on nothing else. Falling back
  // to "any discovery record for this round" let a set be judged against evidence it never
  // claimed, and made an empty binding indistinguishable from a complete one.
  if (set.lockedAt) {
    if (!Array.isArray(set.discoveryRecordIds) || set.discoveryRecordIds.length === 0) {
      throw new Error(
        `${where} is locked but names no discovery records. A locked set is evidenced by the ` +
          'records it is bound to; an unbound set cannot be validated and must be superseded.'
      );
    }
  } else if (!Array.isArray(set.discoveryRecordIds) || set.discoveryRecordIds.length === 0) {
    // Not yet locked: `lockCandidateSet` computes and passes its own records, so this is only
    // reached by a caller validating a set mid-construction.
    return log.attempts.filter(
      (a) => a.status === 'discovery' && a.agency === set.agency && a.category === set.category &&
        a.candidateSetVersion === set.version
    );
  }

  const ids = set.discoveryRecordIds;
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicated.length > 0) {
    throw new Error(
      `${where} names discovery record(s) more than once (${[...new Set(duplicated)].join(', ')}). ` +
        'A duplicated binding would count one inspection as several.'
    );
  }

  const byId = new Map(log.attempts.map((a) => [a.id, a]));
  const records = [];
  for (const id of ids) {
    const record = byId.get(id);
    // Resolved strictly: a missing id used to be dropped silently, so a set bound entirely to
    // ids that do not exist validated as though it had no contradicting evidence - which is
    // true only because it had no evidence at all.
    if (!record) {
      throw new Error(
        `${where} is bound to discovery record ${id}, which does not exist in the log. A set ` +
          'cannot be evidenced by a record that is not there.'
      );
    }
    if (record.status !== 'discovery') {
      throw new Error(
        `${where} is bound to ${id}, which is a ${record.status} attempt, not a discovery ` +
          'record. Only an inspection can evidence a candidate set.'
      );
    }
    // The binding must be to THIS set's round. Otherwise one agency's inspections could
    // evidence another's set, or an earlier round could evidence a later one.
    if (record.agency !== set.agency || record.category !== set.category ||
        record.candidateSetVersion !== set.version) {
      throw new Error(
        `${where} round ${set.version} is bound to ${id}, which belongs to ${record.agency} / ` +
          `${record.category} round ${record.candidateSetVersion}. A set may only be evidenced ` +
          'by its own round.'
      );
    }
    records.push(record);
  }
  return records;
}

/**
 * selection-v1.0.5. The one place the set-versus-evidence rule is expressed.
 *
 * It lived inside `lockCandidateSet`, which made it a property of one code path rather than
 * of the data. A legacy set locked before the rule existed could take a retrospective nil
 * declaration and then be approved, because approval never rechecked anything - so an empty
 * set whose own bound record said `candidates-found` reached APPROVED. Validating at the lock
 * is not enough: the gate has to be at every point that blesses a set, and above all at the
 * last one.
 *
 * `members` and `declaration` are passed rather than read off the set, because the lock
 * validates values it has just computed and the migration validates a declaration it is
 * about to apply.
 */
export function assertSetAgreesWithRound(log, set, { members, declaration, supporting } = {}) {
  const records = supporting ?? supportingRecords(log, set);
  const found = records.filter((a) => a.outcome === 'candidates-found');
  const agency = set.agency;
  const category = set.category;

  if (members.length === 0) {
    if (declaration !== 'none') {
      throw new Error(
        `${agency} / ${category} has no candidates and no nil declaration. An empty set must ` +
          'be declared deliberately - run `candidates --none` - so that it cannot be ' +
          'confused with a category that was never searched.'
      );
    }
    if (found.length > 0) {
      throw new Error(
        `${agency} / ${category} is declared to have no candidates, but ` +
          `${found.length} discovery record(s) report candidates-found ` +
          `(${found.map((a) => a.id).join(', ')}). Record the candidate, or correct the ` +
          'discovery outcome; the set and its evidence must agree.'
      );
    }
  } else if (found.length === 0) {
    throw new Error(
      `${agency} / ${category} locks ${members.length} candidate(s), but no discovery record ` +
        'for this round reports candidates-found. A candidate that no inspection records ' +
        'finding has no provenance; correct the discovery outcome for the page it came from.'
    );
  }
  return set;
}

export function recordCandidates(log, { agency, category, urls, declaration = null }) {
  if (!CATEGORY_ORDER.includes(category)) throw new Error(`unknown category ${category}`);
  const key = setKey(agency, category);
  const existing = log.candidateSets[key];
  if (existing?.approval === APPROVAL.REJECTED) {
    throw new Error(
      `the candidate set for ${agency} / ${category} was rejected and must be superseded ` +
        'before new candidates are recorded. Run `supersede-set` to archive it and open a ' +
        'new version.'
    );
  }
  const version = (log.supersededCandidateSets ?? []).filter(
    (v) => v.agency === agency && v.category === category
  ).length + 1;
  const set = (log.candidateSets[key] ??= {
    agency, category, version, discovered: [], locked: [], lockedAt: null,
    approval: APPROVAL.PENDING, candidateDeclaration: null,
  });

  // selection-v1.0.4. A nil result is declared, not inferred from an empty array. Without a
  // stored declaration an empty set cannot be told apart from a set nobody ever populated,
  // which is the difference between "this agency publishes no such form" and "this category
  // was skipped" - and those are opposite findings.
  if (declaration !== null && declaration !== 'none') {
    throw new Error(`unknown candidate declaration ${JSON.stringify(declaration)}; the only declaration is "none"`);
  }
  if (declaration === 'none' && urls.length > 0) {
    throw new Error('a nil declaration cannot be recorded together with candidate URLs');
  }
  if (declaration === 'none' && set.discovered.length > 0) {
    throw new Error(
      `${agency} / ${category} already has ${set.discovered.length} candidate(s) recorded; ` +
        'a nil result cannot be declared for a set that found something'
    );
  }
  if (declaration === null && urls.length > 0 && set.candidateDeclaration === 'none') {
    throw new Error(
      `${agency} / ${category} was declared to have no candidates; a candidate cannot be ` +
        'added to a nil result. Supersede the set if the declaration was wrong.'
    );
  }

  if (set.lockedAt) {
    // A locked set cannot GROW. Declaring the nil result of a set that is already locked and
    // empty changes no membership - the guards above refuse it the moment anything has been
    // discovered - so it is permitted, and is how a set locked empty before declarations
    // existed records the declaration that was in fact made.
    const declaringEmptyLockedSet =
      declaration === 'none' && set.discovered.length === 0 && set.locked.length === 0 &&
      set.approval === APPROVAL.PENDING && !set.candidateDeclaration;
    if (!declaringEmptyLockedSet) {
      throw new Error(
        `the candidate set for ${agency} / ${category} was locked at ${set.lockedAt} and cannot grow`
      );
    }
    // selection-v1.0.5: the migration is a blessing too, so it validates. Without this the
    // declaration could be attached to a legacy set whose own bound record reports
    // candidates-found, and the contradiction would be carried forward as though declared.
    assertSetAgreesWithRound(log, set, { members: set.locked, declaration: 'none' });
  }

  if (declaration === 'none') {
    set.candidateDeclaration = 'none';
    set.declaredAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  for (const url of urls) if (!set.discovered.includes(url)) set.discovered.push(url);
  return set;
}

/**
 * Closes discovery for a category: canonicalise, deduplicate, sort, keep the first five.
 *
 * The alphabetical order is the tie-break the protocol specifies, and locking is what makes
 * it binding rather than advisory.
 */
export function lockCandidateSet(log, { agency, category }) {
  const key = setKey(agency, category);
  const set = log.candidateSets[key];
  if (!set) throw new Error(`no candidates recorded for ${agency} / ${category}`);
  if (set.lockedAt) throw new Error(`already locked at ${set.lockedAt}`);
  // Bind the set to the exact discovery records that support it. Without this the
  // provenance shows that inspections happened and that a set exists, but not that the one
  // produced the other - which is how a second round became indistinguishable from
  // additions to the first.
  const supporting = log.attempts.filter(
    (a) => a.status === 'discovery' && a.agency === agency && a.category === category &&
      a.candidateSetVersion === set.version &&
      // A corrected record is preserved in the log but does not evidence the set; its
      // replacement does. Binding both would count one inspection twice and keep a finding the
      // operator has explicitly withdrawn.
      !isDiscoverySuperseded(log, a.id)
  );
  if (supporting.length === 0) {
    throw new Error(
      `no discovery records for ${agency} / ${category} round ${set.version}. A candidate ` +
        'set must be supported by the round that produced it.'
    );
  }

  const { ordered, locked } = lockCandidates(set.discovered);

  // selection-v1.0.4. The set and the round that produced it must agree. Binding the two
  // (above) proved only that a round happened; it did not check that the round SAYS what the
  // set claims. Validated here against the values just computed, and again at approval.
  assertSetAgreesWithRound(log, set, {
    members: locked, declaration: set.candidateDeclaration ?? null, supporting,
  });

  set.ordered = ordered;
  set.locked = locked;
  set.lockedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  set.droppedBeyondBound = ordered.slice(locked.length);
  set.discoveryRecordIds = supporting.map((a) => a.id);
  set.discoveryMethods = [...new Set(supporting.map((a) => a.discoveryKind))].sort();
  return set;
}

/**
 * The researcher approves the locked candidate set before anything in it is assessed.
 *
 * The candidate set is where judgement actually sits: which links looked like a form, which
 * search results were worth opening. Approving only the verdicts would leave that judgement
 * unreviewed, and no code can check it - so it is approved explicitly, as its own step.
 */
export function approveCandidateSet(log, { agency, category, approved, note }) {
  const set = log.candidateSets[setKey(agency, category)];
  if (!set) throw new Error(`no candidate set for ${agency} / ${category}`);
  if (!set.lockedAt) throw new Error('the set must be locked before it can be approved');
  // selection-v1.0.5. The last gate revalidates the evidence. Checking only at the lock made
  // the rule a property of one code path: a set locked before the rule existed, or reached by
  // any route that did not pass through `lockCandidateSet`, was approved unchecked.
  //
  // Rejection is deliberately NOT gated. A set whose evidence contradicts itself is exactly
  // the kind that has to be rejectable, and refusing to record the rejection would leave the
  // contradiction sitting in the log with no way to resolve it.
  if (approved) {
    assertSetAgreesWithRound(log, set, {
      members: set.locked ?? [], declaration: set.candidateDeclaration ?? null,
    });
  }
  set.approval = approved ? APPROVAL.APPROVED : APPROVAL.REJECTED;
  set.approvedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (note) set.approvalNote = note;
  return set;
}

/**
 * The frozen reason an agency leaves the scan without contributing a page.
 *
 * Frozen, not free text, because it is the denominator's explanation. Forty agencies that
 * qualified and five that did not is only interpretable if every one of the five left for the
 * same stated reason, and an operator-authored sentence per agency would not guarantee that.
 */
export const EXHAUSTION_REASON =
  'all four categories in the frozen priority order were searched and none yielded an eligible form';

/**
 * Records that an agency is exhausted: searched in full, contributing no page.
 *
 * selection-v1.0.8. `nextWork` could already SAY an agency was exhausted, but nothing could
 * record it - no command wrote to `log.exhausted`, so the scan could not advance past the first
 * agency that failed to qualify without hand-editing the log, which the protocol forbids. An
 * exhaustion is also a claim about the sample, not a bookkeeping detail: it is what makes the
 * prevalence denominator "agencies searched" rather than "agencies with a form", so it needs a
 * timestamp, a fixed reason, and the evidence it rests on.
 *
 * The agency is DERIVED from `nextWork` and never taken from the caller. Accepting an agency
 * would let the draw order be skipped - exhausting agency seven while three is unfinished - and
 * the draw order is the whole sampling claim. A caller may pass `agency` only to be checked
 * against the derived one, which turns an operator's mistake into a refusal rather than a
 * silent reordering.
 */
export function exhaustAgency(log, drawOrder, { agency = null } = {}) {
  const approvedCaptureFor = (ag) =>
    log.attempts.find((a) => a.agency === ag && a.status === 'captured' && a.approval === APPROVAL.APPROVED);

  // Checked on the NAMED agency first, so that an operator who names the wrong one gets the
  // specific reason rather than a generic "that is not the next work" message.
  if (agency !== null) {
    if (isExhausted(log, agency)) {
      throw new Error(`${agency} is already recorded as exhausted; an exhaustion is recorded once`);
    }
    const qualified = approvedCaptureFor(agency);
    if (qualified) {
      throw new Error(
        `${agency} has an approved captured page (${qualified.pageId}); an agency that ` +
          'contributed a page to the corpus is not exhausted'
      );
    }
  }

  const work = nextWork(log, drawOrder);
  if (!work.exhaustedAgency) {
    const what = work.done
      ? work.reason
      : `${work.agency} / ${work.category ?? 'unknown category'}: ${
          work.reason ?? (work.needsLock ? 'the candidate set is not locked' : 'candidates are unassessed')
        }`;
    throw new Error(
      `no agency is exhausted at this point in the frozen order. The next work is: ${what}`
    );
  }
  if (agency !== null && agency !== work.agency) {
    throw new Error(
      `the next agency in the frozen order is ${work.agency}, not ${agency}. An exhaustion is ` +
        'derived from the draw order and cannot be recorded out of turn.'
    );
  }

  const target = work.agency;
  if (isExhausted(log, target)) {
    throw new Error(`${target} is already recorded as exhausted; an exhaustion is recorded once`);
  }
  const qualified = approvedCaptureFor(target);
  if (qualified) {
    throw new Error(
      `${target} has an approved captured page (${qualified.pageId}); an agency that contributed ` +
        'a page to the corpus is not exhausted'
    );
  }

  // Re-verified here rather than inferred from `nextWork` having said so. The rule belongs to
  // the data, and the same lesson applies as at the approval gate: a guard that lives in one
  // caller is a guard that another caller does not have.
  const categorySetVersions = {};
  for (const category of CATEGORY_ORDER) {
    const set = log.candidateSets?.[setKey(target, category)];
    if (!set) {
      throw new Error(`${target} / ${category} was never searched; every category must be settled`);
    }
    if (!set.lockedAt) throw new Error(`${target} / ${category} is not locked`);
    if (set.approval !== APPROVAL.APPROVED) {
      throw new Error(`${target} / ${category} is ${set.approval ?? 'pending'}, not approved`);
    }
    const decided = new Set(
      log.attempts.filter((a) => a.agency === target && a.status !== 'discovery').map((a) => a.url)
    );
    const unassessed = (set.locked ?? []).filter((u) => !decided.has(u));
    if (unassessed.length) {
      throw new Error(
        `${target} / ${category} has ${unassessed.length} locked candidate(s) with no outcome: ` +
          unassessed.join(', ')
      );
    }
    categorySetVersions[category] = set.version;
  }

  const record = {
    agency: target,
    exhaustedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    reason: EXHAUSTION_REASON,
    categorySetVersions,
  };
  (log.exhausted ??= []).push(record);
  return record;
}

/**
 * Archives a rejected candidate set and opens a new version.
 *
 * A rejected set is not deleted. The reason it was rejected - here, discovery provenance
 * that did not record every page inspected - is part of the record of how the sample was
 * arrived at, and a redo that erased the attempt it replaced would hide exactly the thing
 * the ledger exists to show.
 */
export function supersedeCandidateSet(log, { agency, category, reason }) {
  const key = setKey(agency, category);
  const set = log.candidateSets[key];
  if (!set) throw new Error(`no candidate set for ${agency} / ${category}`);
  if (set.approval !== APPROVAL.REJECTED) {
    throw new Error('only a rejected candidate set may be superseded');
  }
  if (!reason) throw new Error('superseding a candidate set needs a reason');
  const history = (log.supersededCandidateSets ??= []);
  history.push({
    // A set created before versioning existed carries no version; it is the one before
    // whatever is already archived for this agency and category.
    ...set,
    version: set.version ?? history.filter((v) => v.agency === agency && v.category === category).length + 1,
    supersededAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    supersededReason: reason,
  });
  delete log.candidateSets[key];
  return log.supersededCandidateSets.at(-1);
}

/** Every locked candidate must have an outcome before the category can be settled. */
export function categorySettled(log, { agency, category }) {
  const set = log.candidateSets[setKey(agency, category)];
  if (!set?.lockedAt) return { settled: false, reason: 'not locked' };
  const decided = new Set(
    log.attempts.filter((a) => a.agency === agency && a.status !== 'discovery').map((a) => a.url)
  );
  const pending = set.locked.filter((u) => !decided.has(u));
  return { settled: pending.length === 0, pending };
}

/** The selection ledger, derived. Every URL examined appears, captured or not. */
export function deriveLedger(log) {
  const rows = log.attempts.map((a) =>
    [
      a.examinedAt,
      a.agency,
      a.website,
      a.url,
      a.finalUrl ?? '',
      a.status,
      a.category ?? '',
      a.status === 'captured'
        ? a.inclusionEvidence
        : a.status === 'discovery'
          ? `discovery: ${a.discoveryKind}${a.note ? ` - ${a.note}` : ''}`
          : a.exclusionReason,
      a.pageId ?? '',
      a.htmlSha256 ?? '',
      a.approval,
    ]
      .map((v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',')
  );
  const header = LEDGER_HEADER.trimEnd() + ',approval\n';
  return header + rows.join('\n') + (rows.length ? '\n' : '');
}

/** The corpus draft, derived. Only approved captures; provenance only, never findings. */
/**
 * Agencies that finished every category with nothing eligible and have no exhaustion record.
 *
 * Derived from the log alone rather than from `nextWork`, so that `deriveDraft` does not need
 * the draw order threaded into it, and so that the rule holds for every agency at once rather
 * than only for whichever one is next in turn.
 */
export function agenciesAwaitingExhaustion(log) {
  const agencies = new Set(Object.values(log.candidateSets ?? {}).map((s) => s.agency));
  const out = [];
  for (const agency of agencies) {
    if (isExhausted(log, agency)) continue;
    if (log.attempts.some((a) => a.agency === agency && a.status === 'captured' && a.approval === APPROVAL.APPROVED)) {
      continue;
    }
    const settled = CATEGORY_ORDER.every((category) => {
      const set = log.candidateSets?.[setKey(agency, category)];
      if (!set?.lockedAt || set.approval !== APPROVAL.APPROVED) return false;
      const decided = new Set(
        log.attempts.filter((a) => a.agency === agency && a.status !== 'discovery').map((a) => a.url)
      );
      return (set.locked ?? []).every((u) => decided.has(u));
    });
    if (settled) out.push(agency);
  }
  return out;
}

export function deriveDraft(log, { frameSha256, drawOrderSha256, selectionLedgerFile = 'selection-ledger.csv', synthetic = false, frameAgencies = null }) {
  // selection-v1.0.17: one shared list, read by `status` too, so a gate and its report cannot
  // disagree about the same log.
  const blockers = corpusBlockers(log);
  if (blockers.length) {
    throw new Error(
      `the corpus cannot be built while work is unfinished:\n` +
        blockers.map((b) => `  ${b.summary}${b.items.length ? `: ${b.items.slice(0, 4).join('; ')}` : ''}`).join('\n')
    );
  }

  const approved = log.attempts.filter((a) => a.status === 'captured' && a.approval === APPROVAL.APPROVED);

  // One page per agency. The protocol takes at most one form page from each, and nothing
  // downstream would notice two.
  const perAgency = new Map();
  for (const a of approved) perAgency.set(a.agency, (perAgency.get(a.agency) ?? 0) + 1);
  const doubled = [...perAgency].filter(([, n]) => n > 1);
  if (doubled.length) {
    throw new Error(
      `more than one approved page for: ${doubled.map(([ag, n]) => `${ag} (${n})`).join(', ')}. ` +
        'The protocol takes at most one form page per agency.'
    );
  }
  if (approved.length > MAX_QUALIFIED_AGENCIES) {
    throw new Error(`${approved.length} approved pages exceeds the target of ${MAX_QUALIFIED_AGENCIES}`);
  }
  if (frameAgencies) {
    const outside = approved.map((a) => a.agency).filter((ag) => !frameAgencies.includes(ag));
    if (outside.length) {
      throw new Error(`agencies outside the frozen frame: ${[...new Set(outside)].join(', ')}`);
    }
  }
  // The selected page must come from the FIRST category that yielded an eligible result,
  // otherwise the priority order was not actually followed.
  for (const a of approved) {
    const earlier = CATEGORY_ORDER.slice(0, CATEGORY_ORDER.indexOf(a.category));
    for (const category of earlier) {
      const eligible = log.attempts.find(
        (o) => o.agency === a.agency && o.category === category && o.status === 'captured'
      );
      if (eligible) {
        throw new Error(
          `${a.agency}: selected a ${a.category} form while ${category} also yielded one. ` +
            'The first category with an eligible result must be used.'
        );
      }
    }
  }

  const pages = approved
    .map((a) => ({
      pageId: a.pageId,
      agency: a.agency,
      website: a.website,
      originalUrl: a.url,
      finalUrl: a.finalUrl,
      capturedAt: a.capturedAt,
      browser: a.browser,
      automationTool: a.automationTool,
      viewport: a.viewport,
      locale: a.locale,
      redirects: a.redirects ?? [],
      category: a.category,
      file: a.file,
      // capture-v1.0.3. Whether this page was captured at its load event or at the bounded
      // fallback, and what was still in flight if it was the latter. A corpus that mixed
      // the two without saying which was which would not be reproducible: the same page,
      // captured twice, could legitimately differ.
      loadState: a.loadState ?? 'load',
      outstandingRequests: a.outstandingRequests ?? [],
      // capture-v1.0.5. Carried into the sealed corpus: a reader comparing two pages needs to
      // know which carried submission protection and which had credential fields, because those
      // are properties of the form being measured, not reasons it was excluded.
      accessBarriers: a.accessBarriers ?? [],
      submissionProtection: a.submissionProtection ?? [],
      authenticationSignals: a.authenticationSignals ?? [],
    }));
  // A draft carrying null hashes would be refused by the seal anyway, but writing one at
  // all invites it being read as a real artefact.
  for (const [name, value] of [['frameSha256', frameSha256], ['drawOrderSha256', drawOrderSha256]]) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new Error(`${name} must be a SHA-256 digest to build a corpus draft, got ${value ?? 'nothing'}`);
    }
  }
  return {
    schema: 'formfair/solo-corpus-draft@1',
    synthetic,
    frameSha256,
    drawOrderSha256,
    selectionLedgerFile,
    pages,
    // selection-v1.0.8. Sealed, not merely held in memory. An agency that was searched in full
    // and yielded nothing is part of the denominator, so a corpus that recorded only its pages
    // would describe a sample of forty without saying how many agencies were looked at to get
    // them. Legacy bare-string entries are normalised so an older log still seals.
    exhaustedAgencies: (log.exhausted ?? []).map((e) =>
      typeof e === 'string'
        ? { agency: e, exhaustedAt: null, reason: EXHAUSTION_REASON, categorySetVersions: null }
        : e
    ),
  };
}

/**
 * The publishable provenance record.
 *
 * `evaluation/data/` is ignored by Git, correctly: it holds captured third-party markup.
 * But the protocol publishes provenance - hashes, the selection ledger, the schemas - and
 * leaving the ledger inside the ignored tree would make the audit trail unpublishable.
 *
 * This writes a tracked copy containing no markup: URLs examined, when, by what discovery
 * method, the outcome, the reason, and content hashes. Nothing here reproduces any part of
 * a captured page.
 */
export function publishProvenance(log, { to }) {
  const ledgerProblems = checkPermitLedger(log);
  if (ledgerProblems.length) {
    throw new Error(
      `the permit ledger is inconsistent and must not be published:\n  ${ledgerProblems.join('\n  ')}`
    );
  }
  const dir = resolve(to);
  mkdirSync(dir, { recursive: true });
  const ledgerPath = join(dir, 'selection-ledger.csv');
  writeFileSync(ledgerPath, deriveLedger(log), 'utf8');

  const discovery = log.attempts.filter((a) => a.status === 'discovery');
  const candidates = log.attempts.filter((a) => a.status !== 'discovery');
  const provenance = {
    schema: 'formfair/capture-provenance@1',
    politeness: log.politeness,
    counts: {
      discoveryPages: discovery.length,
      candidatesAssessed: candidates.length,
      captured: candidates.filter((a) => a.status === 'captured').length,
      excluded: candidates.filter((a) => a.status === 'excluded').length,
      failed: candidates.filter((a) => a.status === 'failed').length,
      pendingApprovalAttempts: log.attempts.filter((a) => a.approval === APPROVAL.PENDING).length,
      pendingApprovalCandidateSets: Object.values(log.candidateSets ?? {}).filter(
        (set) => set.approval === APPROVAL.PENDING
      ).length,
    },
    discoveryByMethod: discovery.reduce((acc, a) => {
      acc[a.discoveryKind] = (acc[a.discoveryKind] ?? 0) + 1;
      return acc;
    }, {}),
    discoveryByOutcome: discovery.reduce((acc, a) => {
      const key = a.outcome ?? 'unrecorded';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    exhaustedAgencies: (log.exhausted ?? []).map((e) =>
      typeof e === 'string' ? { agency: e, exhaustedAt: null, reason: EXHAUSTION_REASON } : e
    ),
    // The traffic audit. A duplicate-request permit covered a real request and is counted as
    // traffic; it produced no additional inspection, candidate, page or observation, and is
    // counted nowhere else.
    permits: permitAudit(log),
    discoveryByRound: discovery.reduce((acc, a) => {
      const key = `${a.agency ?? '?'} / ${a.category ?? 'unattributed'} v${a.candidateSetVersion ?? '?'}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    candidateSets: Object.values(log.candidateSets ?? {}).map((set) => ({
      agency: set.agency, category: set.category, version: set.version,
      discovered: set.discovered.length, locked: set.locked.length,
      droppedBeyondBound: set.droppedBeyondBound?.length ?? 0,
      lockedAt: set.lockedAt, approval: set.approval, approvedAt: set.approvedAt ?? null,
      supportedByDiscoveryRecords: set.discoveryRecordIds ?? [],
      discoveryMethods: set.discoveryMethods ?? [],
    })),
    supersededCandidateSets: (log.supersededCandidateSets ?? []).map((set) => ({
      agency: set.agency, category: set.category, version: set.version,
      approval: set.approval, approvalNote: set.approvalNote ?? null,
      supersededAt: set.supersededAt, supersededReason: set.supersededReason,
    })),
  };
  const provenancePath = join(dir, 'provenance.json');
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  return { ledgerPath, provenancePath };
}

/** Writes both derived artefacts beside the log, so nothing is edited by hand. */
export function writeDerived({ log, dir, frameSha256, drawOrderSha256, synthetic = false }) {
  const root = resolve(dir);
  // The ledger lives INSIDE captures/, because the frozen seal resolves
  // selectionLedgerFile relative to the captures directory it is given. Writing it beside
  // the draft instead left the seal unable to find it.
  const capturesDir = join(root, 'captures');
  mkdirSync(capturesDir, { recursive: true });
  const ledgerPath = join(capturesDir, 'selection-ledger.csv');
  writeFileSync(ledgerPath, deriveLedger(log), 'utf8');
  let draftPath = null;
  try {
    const draft = deriveDraft(log, { frameSha256, drawOrderSha256, synthetic });
    draftPath = join(root, 'corpus-draft.json');
    writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  } catch (error) {
    // A pending approval is the normal mid-run state, not a failure.
    return { ledgerPath, draftPath: null, draftHeld: error.message };
  }
  return { ledgerPath, draftPath, draftHeld: null };
}

export { sha256, recordExamination };

/**
 * The recorded robots policy for an origin, or null.
 *
 * Persisted in the log so that repeated one-shot CLI calls reuse one check instead of issuing a
 * fresh request each time. Those requests were real traffic that no record described.
 */
export function findRobotsCheck(log, origin) {
  // The most recent check for that origin. History is append-only, so this reads forwards.
  const all = (log.robotsChecks ?? []).filter((c) => c.origin === origin);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Appends a robots check. Never replaces one.
 *
 * selection-v1.0.13. A refresh used to overwrite the previous policy while keeping its id, so a
 * permit issued yesterday would afterwards appear to have been authorised by today's policy
 * rather than the one actually observed when the request was made. The evidence for a past
 * decision has to be the evidence that existed at the time, which means keeping it.
 */
export function recordRobotsCheck(log, policy) {
  (log.robotsChecks ??= []);
  const record = { ...policy, id: `r-${String(log.robotsChecks.length + 1).padStart(4, '0')}` };
  log.robotsChecks.push(record);
  return record;
}

/**
 * A single-use permission to navigate one URL, for one round.
 *
 * The robots check used to happen when the record was written, which is after the browsing. It
 * could refuse the record but not the request, so it documented a breach rather than preventing
 * one. A permit is issued before navigation and consumed by the record, which makes the check a
 * precondition of the traffic instead of a comment on it.
 *
 * Scoped to agency, category, round and URL, and usable once: a permit for one page cannot
 * authorise another, and re-recording requires re-checking.
 */
export function issueDiscoveryPermit(log, { agency, category, candidateSetVersion, url, robotsCheckId, reason }) {
  (log.discoveryPermits ??= []);

  // selection-v1.0.14. One open permit per URL and round. Two permits were issued for the same
  // page - once to inspect it, once by the recording script - and since consumption took the
  // oldest match, the second stayed open. Two requests really were made, so the permits were not
  // spurious; what was lost was any way to say which request each one covered.
  const already = findOpenPermit(log, { agency, category, candidateSetVersion, url });
  if (already) {
    throw new Error(
      `permit ${already.id} is already open for ${url} (${agency} / ${category} round ` +
        `${candidateSetVersion}), issued at ${already.issuedAt}. Use it, or close it with ` +
        '`close-permit` before issuing another.'
    );
  }
  const permit = {
    id: `p-${String(log.discoveryPermits.length + 1).padStart(4, '0')}`,
    agency, category, candidateSetVersion, url, robotsCheckId,
    reason: reason ?? null,
    issuedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    consumedAt: null,
  };
  log.discoveryPermits.push(permit);
  return permit;
}

export function findOpenPermit(log, { agency, category, candidateSetVersion, url }) {
  return (log.discoveryPermits ?? []).find(
    (p) => p.consumedAt === null && !p.closedAt && p.agency === agency && p.category === category &&
      p.candidateSetVersion === candidateSetVersion && p.url === url
  ) ?? null;
}

export function consumeDiscoveryPermit(log, { agency, category, candidateSetVersion, url, navigatedAt = null, permitId = null }) {
  // selection-v1.0.14: the record names its permit. Taking whichever open permit matched left
  // the pairing between a request and its authorisation implicit, and when two existed it was
  // simply wrong.
  if (!permitId) {
    throw new Error(
      `a discovery record must name the permit that authorised its navigation (--permit-id). ` +
        `Run \`preflight-discovery\` for ${url} and use the permit it issues.`
    );
  }
  const permit = (log.discoveryPermits ?? []).find((p) => p.id === permitId);
  if (!permit) throw new Error(`permit ${permitId} does not exist`);
  if (permit.consumedAt) throw new Error(`permit ${permitId} was already consumed at ${permit.consumedAt}`);
  if (permit.closedAt) throw new Error(`permit ${permitId} was closed at ${permit.closedAt} as ${permit.disposition}`);
  if (permit.agency !== agency || permit.category !== category ||
      permit.candidateSetVersion !== candidateSetVersion || permit.url !== url) {
    throw new Error(
      `permit ${permitId} is for ${permit.agency} / ${permit.category} round ` +
        `${permit.candidateSetVersion} ${permit.url}, not this record`
    );
  }

  // selection-v1.0.12. A permit authorises a FUTURE request, so the navigation it covers must
  // have happened after it was issued and within its life. Without this, a permit could be
  // issued now and attached to an observation made days ago, which would make the check look
  // preventative when it was retrospective - the exact appearance the permit exists to deny.
  const issued = Date.parse(permit.issuedAt);
  const now = Date.now();
  if (now - issued > PERMIT_TTL_MS) {
    throw new Error(
      `permit ${permit.id} was issued at ${permit.issuedAt} and has expired. Re-run ` +
        '`preflight-discovery`: a stale permit cannot authorise a request made much later, ' +
        'because the policy may have changed in between.'
    );
  }
  if (navigatedAt !== null) {
    const navigated = Date.parse(navigatedAt);
    if (Number.isNaN(navigated)) throw new Error(`navigatedAt ${navigatedAt} is not a timestamp`);
    if (navigated < issued) {
      throw new Error(
        `the navigation at ${navigatedAt} precedes permit ${permit.id}, issued at ${permit.issuedAt}. ` +
          'A permit authorises a request that has not happened yet; it cannot be attached to an ' +
          'observation already made.'
      );
    }
    if (navigated - issued > PERMIT_TTL_MS) {
      throw new Error(
        `the navigation at ${navigatedAt} is more than an hour after permit ${permit.id} was issued`
      );
    }
  }

  permit.consumedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return permit;
}

/** Has this discovery record been corrected by a later one? */
export function isDiscoverySuperseded(log, id) {
  return log.attempts.some((a) => a.supersedesDiscoveryId === id);
}

/** How long a navigation permit stays usable. A permit authorises an imminent request. */
export const PERMIT_TTL_MS = 60 * 60 * 1000;

/**
 * RFC 9309 section 2.4: cached robots content should generally not be used for more than 24
 * hours. A permanently cached policy could authorise a path that has since become disallowed.
 */
export const ROBOTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function robotsCheckIsFresh(check, at = Date.now()) {
  const fetched = Date.parse(check?.fetchedAt ?? '');
  return !Number.isNaN(fetched) && at - fetched < ROBOTS_MAX_AGE_MS;
}

/**
 * Discovery rounds that exist in the log but are not resolved into a locked, approved set.
 *
 * The bypass this closes: twenty-six discovery records were written for a round with no candidate
 * set object at all. Every gate keyed off candidate sets, so `status` reported nothing
 * outstanding and the corpus draft built while an entire agency's round sat in the log, unlocked
 * and unreviewed. Unfinished discovery could disappear from the corpus gate simply by never
 * reaching the step that creates the set.
 */
export function unresolvedDiscoveryRounds(log) {
  const rounds = new Map();
  for (const a of log.attempts) {
    if (a.status !== 'discovery') continue;
    if (isDiscoverySuperseded(log, a.id)) continue;
    const key = `${a.agency}\u0000${a.category}\u0000${a.candidateSetVersion}`;
    if (!rounds.has(key)) {
      rounds.set(key, { agency: a.agency, category: a.category, version: a.candidateSetVersion, records: 0 });
    }
    rounds.get(key).records += 1;
  }

  const out = [];
  for (const round of rounds.values()) {
    const set = log.candidateSets?.[setKey(round.agency, round.category)];
    const archived = (log.supersededCandidateSets ?? []).some(
      (v) => v.agency === round.agency && v.category === round.category && v.version === round.version
    );
    if (archived) continue; // its round was superseded with it, and is preserved as history
    if (!set) {
      out.push({ ...round, reason: 'no candidate set exists for this round' });
      continue;
    }
    if (set.version !== round.version) {
      out.push({ ...round, reason: `the active set is version ${set.version}, not ${round.version}` });
      continue;
    }
    // Not locked is the bypass this detects. A set that is locked but awaiting approval is
    // already counted as a pending candidate set, and reporting it here too would double-count
    // one outstanding item as two.
    if (!set.lockedAt) out.push({ ...round, reason: 'the candidate set is not locked' });
  }
  return out;
}

/** Permits issued and never consumed: a navigation authorised and never accounted for. */
export function openDiscoveryPermits(log) {
  return (log.discoveryPermits ?? []).filter((p) => p.consumedAt === null && !p.closedAt);
}

export const PERMIT_DISPOSITIONS = Object.freeze({
  /** No navigation occurred under this permit. */
  UNUSED: 'unused',
  /** A navigation occurred, but duplicated an inspection already recorded under another permit. */
  DUPLICATE_REQUEST: 'duplicate-request',
});

/**
 * Closes an open permit, with an explicit account of what happened under it.
 *
 * Deliberately not called "release": these permits were not unused. Two requests were made for
 * each URL and only one discovery judgement recorded, so calling the remainder released would
 * assert that no request occurred - the opposite of the truth. The two dispositions say which
 * it was, and `duplicate-request` must name the inspection that accounts for the traffic.
 */
export function closeDiscoveryPermit(log, { permitId, disposition, reason, accountedBy = null }) {
  const permit = (log.discoveryPermits ?? []).find((p) => p.id === permitId);
  if (!permit) throw new Error(`permit ${permitId} does not exist`);
  if (permit.consumedAt) {
    throw new Error(`permit ${permitId} was consumed at ${permit.consumedAt} and cannot be closed`);
  }
  if (permit.closedAt) {
    throw new Error(`permit ${permitId} was already closed at ${permit.closedAt} as ${permit.disposition}`);
  }
  if (!Object.values(PERMIT_DISPOSITIONS).includes(disposition)) {
    throw new Error(`disposition must be one of ${Object.values(PERMIT_DISPOSITIONS).join(', ')}`);
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('closing a permit requires a reason, which is recorded');
  }

  if (disposition === PERMIT_DISPOSITIONS.DUPLICATE_REQUEST) {
    if (!accountedBy) {
      throw new Error('a duplicate-request closure must name the discovery record that accounts for the traffic');
    }
    const record = log.attempts.find((a) => a.id === accountedBy);
    if (!record) throw new Error(`discovery record ${accountedBy} does not exist`);
    if (record.status !== 'discovery') throw new Error(`${accountedBy} is a ${record.status} attempt, not a discovery record`);
    for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
      ['candidateSetVersion', 'round'], ['url', 'url']]) {
      if (record[field] !== permit[field]) {
        throw new Error(
          `${accountedBy} is ${label} ${JSON.stringify(record[field])}, but permit ${permitId} is ` +
            `${JSON.stringify(permit[field])}`
        );
      }
    }
  } else if (accountedBy) {
    throw new Error('an unused closure names no discovery record: nothing was requested under it');
  }

  const closedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const closureId = `x-${String((log.discoveryPermits ?? []).filter((p) => p.closedAt).length + 1).padStart(4, '0')}`;
  Object.assign(permit, { closedAt, disposition, closureReason: reason, accountedBy, closureId });

  // Validated after assignment so the ledger is checked in the state it would be left in, and
  // rolled back entirely if it does not hold.
  // Full validation, not scoped to this permit: `{ only }` skipped every general check, so a
  // closure could be written into a ledger that was already inconsistent.
  const problems = checkPermitLedger(log);
  if (problems.length) {
    for (const key of ['closedAt', 'disposition', 'closureReason', 'accountedBy', 'closureId']) {
      delete permit[key];
    }
    throw new Error(`the closure would leave the permit ledger inconsistent:\n  ${problems.join('\n  ')}`);
  }
  return permit;
}

/** The traffic audit: what was authorised, what was used, and how the rest was accounted for. */
export function permitAudit(log) {
  const permits = log.discoveryPermits ?? [];
  const closed = permits.filter((p) => p.closedAt);
  return {
    issued: permits.length,
    consumed: permits.filter((p) => p.consumedAt).length,
    closedUnused: closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.UNUSED).length,
    closedDuplicateRequest: closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.DUPLICATE_REQUEST).length,
    open: openDiscoveryPermits(log).length,
    // A duplicate-request permit covered a real request, so it counts as traffic. It produced no
    // additional inspection, candidate, page or observation, and is counted nowhere else.
    networkRequestsAuthorised:
      permits.filter((p) => p.consumedAt).length +
      closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.DUPLICATE_REQUEST).length,
    closures: closed.map((p) => ({
      closureId: p.closureId, permitId: p.id, closedAt: p.closedAt,
      disposition: p.disposition, reason: p.closureReason, accountedBy: p.accountedBy ?? null,
      url: p.url, agency: p.agency, category: p.category, round: p.candidateSetVersion,
    })),
  };
}

/**
 * Reopens a locked set that has not been approved, so a correction can still be bound.
 *
 * selection-v1.0.13. A discovery correction appended after locking left the binding pointing at
 * the superseded record while its replacement sat outside the set entirely - the set would
 * evidence a finding that had been withdrawn. Locking is meant to stop a set GROWING, not to
 * freeze a mistake in place, and an unapproved set has not yet been relied on by anyone.
 *
 * An approved set is not reopenable: that judgement has been made, and correcting it means
 * rejecting and superseding the set, which the protocol already provides.
 */
export function reopenCandidateSet(log, { agency, category, reason }) {
  const set = log.candidateSets?.[setKey(agency, category)];
  if (!set) throw new Error(`no candidate set for ${agency} / ${category}`);
  if (!set.lockedAt) throw new Error(`${agency} / ${category} is not locked`);
  if (set.approval === APPROVAL.APPROVED) {
    throw new Error(
      `${agency} / ${category} is approved and cannot be reopened. Reject and supersede it instead: ` +
        'an approved set has been relied on, and changing it silently would rewrite a decision.'
    );
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('reopening a locked set requires a reason, which is recorded');
  }

  (set.lockHistory ??= []).push({
    lockedAt: set.lockedAt,
    ordered: set.ordered ?? [],
    locked: set.locked ?? [],
    discoveryRecordIds: set.discoveryRecordIds ?? [],
    discoveryMethods: set.discoveryMethods ?? [],
    reopenedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    reason,
  });
  set.lockedAt = null;
  return set;
}

/**
 * The permit ledger must describe traffic that actually happened.
 *
 * selection-v1.0.15. `closeDiscoveryPermit` checked that the named record existed and matched the
 * permit's agency, category, round and URL — and nothing else. A record carrying
 * `navigationPerformed: false` was therefore accepted as evidence that a request had been made,
 * and the audit then reported an authorised network request whose own named evidence said no
 * navigation occurred. The corpus gate checked only for OPEN permits, so the fabricated state
 * escaped the final gate too.
 *
 * The rule the checks were missing: a `duplicate-request` closure asserts that a second request
 * was made and that an existing inspection accounts for it. That inspection must therefore be a
 * real navigation, recorded under its own consumed permit, and that permit must be a different
 * one covering the same scope — otherwise the closure is not a duplicate of anything.
 *
 * Returns problems rather than throwing, so every caller can report all of them at once, and is
 * called from the closure itself, from `deriveDraft` and from `publishProvenance`: a rule enforced
 * where a value is written but not where it is trusted is the defect this scan keeps rediscovering.
 */
export function checkPermitLedger(log) {
  const problems = [];
  const allPermits = log.discoveryPermits ?? [];
  const permits = allPermits;
  const byId = new Map(log.attempts.map((a) => [a.id, a]));
  const ms = (v) => { const t = Date.parse(v ?? ''); return Number.isNaN(t) ? null : t; };

  // selection-v1.0.16. The consumption side of the ledger, which the closure checks never
  // reached. Validating only closures left three inconsistent states passing cleanly: a record
  // whose URL differed from its own permit's, a consumed permit no record referenced, and two
  // records naming one single-use permit. A permit and the inspection it authorised are a pair;
  // anything else means the log does not describe the traffic that occurred.
  //
  // Records predating the permit model carry no `permitId` and are exempt: the invariants apply
  // to permits and to records that participate in the model.
  {
    const seenPermitIds = new Set();
    const seenClosureIds = new Set();
    for (const permit of allPermits) {
      if (seenPermitIds.has(permit.id)) problems.push(`permit id ${permit.id} appears more than once`);
      seenPermitIds.add(permit.id);
      if (permit.closureId) {
        if (seenClosureIds.has(permit.closureId)) {
          problems.push(`closure id ${permit.closureId} appears more than once`);
        }
        seenClosureIds.add(permit.closureId);
      }
      // A permit should rest on a robots check for its own origin: that check is why it was
      // issued at all.
      const check = (log.robotsChecks ?? []).find((c) => c.id === permit.robotsCheckId);
      if (!check) {
        problems.push(`${permit.id} names robots check ${permit.robotsCheckId}, which does not exist`);
      } else {
        let origin = null;
        try { origin = new URL(permit.url).origin; } catch { origin = null; }
        if (origin && check.origin !== origin) {
          problems.push(`${permit.id} is for ${origin} but names a robots check for ${check.origin}`);
        }
      }
    }

    const citations = new Map();
    for (const attempt of log.attempts) {
      if (!attempt.permitId) continue;
      if (!citations.has(attempt.permitId)) citations.set(attempt.permitId, []);
      citations.get(attempt.permitId).push(attempt);
      const permit = allPermits.find((p) => p.id === attempt.permitId);
      if (!permit) {
        problems.push(`${attempt.id} names permit ${attempt.permitId}, which does not exist`);
        continue;
      }
      if (!permit.consumedAt) {
        problems.push(`${attempt.id} names permit ${permit.id}, which is not recorded as consumed`);
      }
      for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
        ['candidateSetVersion', 'round'], ['url', 'url']]) {
        if (attempt[field] !== permit[field]) {
          problems.push(
            `${attempt.id} has ${label} ${JSON.stringify(attempt[field])} but its permit ` +
              `${permit.id} covers ${JSON.stringify(permit[field])}`
          );
        }
      }
    }

    for (const [permitId, records] of citations) {
      if (records.length > 1) {
        problems.push(
          `permit ${permitId} is named by ${records.length} records ` +
            `(${records.map((r) => r.id).join(', ')}); a permit authorises one request`
        );
      }
    }
    // selection-v1.0.18. The permit lifecycle: a state machine and a clock.
    //
    // Five states passed cleanly before this: a record saying no navigation occurred, a
    // navigation predating its own permit, a robots check fetched after the permit it
    // supposedly justified, a robots check older than a day, and a navigation an hour past
    // issuance. Each makes the ledger assert a sequence of events that cannot have happened.
    // selection-v1.0.19. Presence is not validity. The state machine asked whether fields were
    // there, not whether they parsed, were ordered, or were permitted in that state - so an open
    // permit could carry `accountedBy`, a closure could be stamped `"not-a-date"` or dated before
    // its own issuance, and a robots check could carry an unparseable time. A field nobody can
    // read is not weaker evidence than a missing one; it is a claim that cannot be checked.
    const stamp = (value, label, at) => {
      if (value === undefined || value === null) return null;
      if (!isoUtcish(value)) {
        problems.push(`${at} has ${label} ${JSON.stringify(value)}, which is not a UTC timestamp`);
        return null;
      }
      return ms(value);
    };

    // selection-v1.0.20. Four states, mutually exclusive, tested by field PRESENCE rather than
    // truthiness. Truthiness let `closureId: ''` and `disposition: ''` sit on an open permit
    // unnoticed, and a consumed permit carry `accountedBy`, because an empty string and an absent
    // field are the same thing to `if (x)`. They are not the same thing to a reader of the log:
    // one says the field was set and left blank.
    //
    //   open                      nothing but issuedAt
    //   consumed                  consumedAt, and no closure metadata
    //   closed unused             closedAt, disposition, closureId, closureReason; no accountedBy
    //   closed duplicate-request  the same, plus accountedBy
    const present = (v) => v !== undefined && v !== null;
    const CLOSURE_FIELDS = ['closedAt', 'disposition', 'closureId', 'closureReason', 'accountedBy'];

    for (const permit of allPermits) {
      const where = permit.id;
      const closed = present(permit.closedAt);
      const consumed = present(permit.consumedAt);

      if (!closed && !consumed) {
        for (const field of CLOSURE_FIELDS) {
          if (present(permit[field])) {
            problems.push(
              `${where} is open but carries ${field} ${JSON.stringify(permit[field])}; an open permit ` +
                'has neither been used nor accounted for'
            );
          }
        }
      } else if (consumed && !closed) {
        for (const field of CLOSURE_FIELDS) {
          if (present(permit[field])) {
            problems.push(
              `${where} is consumed but carries ${field} ${JSON.stringify(permit[field])}; a consumed ` +
                'permit is accounted for by its own record, not by a closure'
            );
          }
        }
      } else if (closed) {
        if (!Object.values(PERMIT_DISPOSITIONS).includes(permit.disposition)) {
          problems.push(
            `${where} is closed with disposition ${JSON.stringify(permit.disposition)}, which is not ` +
              Object.values(PERMIT_DISPOSITIONS).join(' or ')
          );
        }
        if (typeof permit.closureId !== 'string' || permit.closureId.trim() === '') {
          problems.push(`${where} is closed without a closure id`);
        }
        if (typeof permit.closureReason !== 'string' || permit.closureReason.trim() === '') {
          problems.push(`${where} is closed without a reason`);
        }
        if (permit.disposition === PERMIT_DISPOSITIONS.DUPLICATE_REQUEST && !present(permit.accountedBy)) {
          problems.push(`${where} is closed duplicate-request but names no discovery record`);
        }
      }

      const issued = stamp(permit.issuedAt, 'issuedAt', where);
      if (permit.issuedAt === undefined || permit.issuedAt === null) {
        problems.push(`${where} has no issuedAt`);
      }
      const closedAt = stamp(permit.closedAt, 'closedAt', where);
      if (issued !== null && closedAt !== null && closedAt < issued) {
        problems.push(`${where} was closed at ${permit.closedAt}, before it was issued at ${permit.issuedAt}`);
      }

      const check = (log.robotsChecks ?? []).find((c) => c.id === permit.robotsCheckId);
      const fetched = check ? stamp(check.fetchedAt, `robots check ${check.id} fetchedAt`, where) : null;
      if (check && (check.fetchedAt === undefined || check.fetchedAt === null)) {
        problems.push(`${where} names robots check ${check.id}, which has no fetchedAt`);
      }
      if (issued !== null && fetched !== null) {
        if (fetched > issued) {
          problems.push(
            `${where} was issued at ${permit.issuedAt} but its robots check was fetched later, at ` +
              `${check.fetchedAt}. A permit rests on a policy read before it, not after.`
          );
        } else if (issued - fetched >= ROBOTS_MAX_AGE_MS) {
          problems.push(
            `${where} rests on a robots check fetched at ${check.fetchedAt}, more than 24 hours ` +
              'before it was issued; RFC 9309 section 2.4 does not support relying on it that long'
          );
        }
      }

      const consumedAt = stamp(permit.consumedAt, 'consumedAt', where);
      const record = (citations.get(permit.id) ?? [])[0];
      const navigated = record ? stamp(record.navigatedAt, `${record.id} navigatedAt`, where) : null;
      if (record) {
        if (record.status !== 'discovery') {
          problems.push(`${where} is named by ${record.id}, a ${record.status} attempt, not a discovery record`);
        }
        if (record.navigationPerformed === false) {
          problems.push(
            `${where} is named by ${record.id}, which records navigationPerformed: false. A permit ` +
              'authorises a request; a record stating none occurred cannot be what consumed it.'
          );
        }
        if (navigated === null) {
          problems.push(`${where} is named by ${record.id}, which carries no navigation timestamp`);
        }
      }
      if (issued !== null && navigated !== null) {
        if (navigated < issued) {
          problems.push(
            `${where} was issued at ${permit.issuedAt} but ${record.id} navigated earlier, at ` +
              `${record.navigatedAt}. A permit cannot authorise a request already made.`
          );
        } else if (navigated - issued > PERMIT_TTL_MS) {
          problems.push(
            `${where} was issued at ${permit.issuedAt} and ${record.id} navigated at ` +
              `${record.navigatedAt}, more than an hour later; the permit had expired`
          );
        }
      }
      if (navigated !== null && consumedAt !== null && consumedAt < navigated) {
        problems.push(
          `${where} was consumed at ${permit.consumedAt}, before ${record.id} navigated at ` +
            `${record.navigatedAt}`
        );
      }
      if (issued !== null && consumedAt !== null && consumedAt < issued) {
        problems.push(`${where} was consumed at ${permit.consumedAt}, before it was issued`);
      }
    }

    // A duplicate-request closure cannot predate the traffic it claims to duplicate: the second
    // request happened after the first, and the closure records that it happened.
    for (const permit of allPermits) {
      if (permit.disposition !== PERMIT_DISPOSITIONS.DUPLICATE_REQUEST) continue;
      const closedAt = ms(permit.closedAt);
      const evidence = byId.get(permit.accountedBy);
      if (closedAt === null || !evidence) continue;
      const evidenceNavigated = ms(evidence.navigatedAt);
      if (evidenceNavigated !== null && closedAt < evidenceNavigated) {
        problems.push(
          `${permit.id} was closed at ${permit.closedAt}, before ${evidence.id} navigated at ` +
            `${evidence.navigatedAt}. A duplicate-request closure records traffic that has already ` +
            'happened; it cannot precede the inspection that accounts for it.'
        );
      }
      const evidencePermit = allPermits.find((p) => p.id === evidence.permitId);
      const evidenceConsumed = evidencePermit ? ms(evidencePermit.consumedAt) : null;
      if (evidenceConsumed !== null && closedAt < evidenceConsumed) {
        problems.push(
          `${permit.id} was closed at ${permit.closedAt}, before its evidence permit ` +
            `${evidencePermit.id} was consumed at ${evidencePermit.consumedAt}`
        );
      }
    }

    for (const permit of allPermits) {
      if (!permit.consumedAt) continue;
      const cited = citations.get(permit.id) ?? [];
      if (cited.length === 0) {
        problems.push(
          `permit ${permit.id} is recorded as consumed at ${permit.consumedAt} but no discovery ` +
            'record names it, so a request it authorised is unaccounted for'
        );
      }
    }
  }

  for (const permit of permits) {
    if (permit.consumedAt && permit.closedAt) {
      problems.push(`${permit.id} is both consumed and closed`);
    }
    if (permit.disposition === PERMIT_DISPOSITIONS.UNUSED && permit.accountedBy) {
      problems.push(`${permit.id} is closed unused but names ${permit.accountedBy}`);
    }
    if (permit.disposition !== PERMIT_DISPOSITIONS.DUPLICATE_REQUEST) continue;

    const where = `${permit.id} (duplicate-request)`;
    const record = byId.get(permit.accountedBy);
    if (!record) {
      problems.push(`${where} names ${permit.accountedBy}, which is not in the log`);
      continue;
    }
    if (record.status !== 'discovery') {
      problems.push(`${where} names ${record.id}, a ${record.status} attempt`);
      continue;
    }
    // The evidence must be a navigation. A record that states no request was made cannot
    // account for a request having been made.
    if (record.navigationPerformed === false) {
      problems.push(
        `${where} names ${record.id}, which records navigationPerformed: false. A closure ` +
          'asserting a duplicate request cannot be evidenced by a record stating no request occurred.'
      );
    }
    if (!record.navigatedAt) {
      problems.push(`${where} names ${record.id}, which carries no navigation timestamp`);
    }
    // And that navigation must itself have been authorised, by a different consumed permit.
    const evidencePermit = (log.discoveryPermits ?? []).find((p) => p.id === record.permitId);
    if (!record.permitId) {
      problems.push(`${where} names ${record.id}, which names no permit of its own`);
    } else if (!evidencePermit) {
      problems.push(`${where} names ${record.id}, whose permit ${record.permitId} does not exist`);
    } else {
      if (!evidencePermit.consumedAt) {
        problems.push(`${where} names ${record.id}, whose permit ${evidencePermit.id} was never consumed`);
      }
      if (evidencePermit.id === permit.id) {
        problems.push(`${where} names a record authorised by this same permit, so it duplicates nothing`);
      }
      for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
        ['candidateSetVersion', 'round'], ['url', 'url']]) {
        if (evidencePermit[field] !== permit[field]) {
          problems.push(
            `${where} names a record whose permit covers a different ${label}: ` +
              `${JSON.stringify(evidencePermit[field])} against ${JSON.stringify(permit[field])}`
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Everything unfinished that withholds the corpus draft.
 *
 * selection-v1.0.17. `status` and `deriveDraft` each computed this list for themselves, and drifted
 * apart twice. The second time, `status` reported "nothing outstanding; the corpus draft is not
 * withheld" while `next` said four locked candidates were unassessed and the draft refused for
 * exactly that reason - three commands describing three different states of one log.
 *
 * So there is one list, and both callers read it. `deriveDraft` refuses if it is non-empty;
 * `status` prints it and counts it. A gate and its report cannot disagree if they are the same
 * computation.
 *
 * Structural checks on an already-complete corpus - one page per agency, the forty-page bound,
 * the draw-order prefix, frame membership - stay in `deriveDraft`. Those ask whether a finished
 * sample is valid, not whether the work is finished.
 */
export function corpusBlockers(log) {
  const blockers = [];
  const add = (kind, summary, items = []) => blockers.push({ kind, summary, items });

  const pending = log.attempts.filter((a) => a.approval === APPROVAL.PENDING);
  if (pending.length) {
    add('pending-attempts', `${pending.length} attempt(s) still pending researcher approval`,
      pending.map((a) => `${a.id} ${a.url}`));
  }

  const unresolvedSets = Object.values(log.candidateSets ?? {}).filter(
    (set) => set.approval !== APPROVAL.APPROVED
  );
  if (unresolvedSets.length) {
    add('unapproved-sets', `${unresolvedSets.length} candidate set(s) are not approved`,
      unresolvedSets.map((s) => `${s.agency} / ${s.category} v${s.version} (${s.approval ?? 'pending'})`));
  }

  const dangling = log.attempts.filter(
    (a) => a.status !== 'discovery' && a.approval === APPROVAL.REJECTED && !isSuperseded(log, a)
  );
  if (dangling.length) {
    add('unsuperseded-rejections', `${dangling.length} rejected attempt(s) have not been superseded by a correction`,
      dangling.map((a) => `${a.id} ${a.url}`));
  }

  // The check `status` was missing entirely.
  const unassessed = [];
  for (const set of Object.values(log.candidateSets ?? {})) {
    const decided = new Set(
      log.attempts.filter((a) => a.agency === set.agency && a.status !== 'discovery').map((a) => a.url)
    );
    for (const url of (set.locked ?? []).filter((u) => !decided.has(u))) {
      unassessed.push(`${set.agency} / ${set.category}: ${url}`);
    }
  }
  if (unassessed.length) {
    add('unassessed-candidates', `${unassessed.length} locked candidate(s) with no outcome`, unassessed);
  }

  const rounds = unresolvedDiscoveryRounds(log);
  if (rounds.length) {
    add('unresolved-rounds', `${rounds.length} discovery round(s) are not resolved into a locked, approved set`,
      rounds.map((r) => `${r.agency} / ${r.category} v${r.version}: ${r.records} records, ${r.reason}`));
  }

  const open = openDiscoveryPermits(log);
  if (open.length) {
    add('open-permits', `${open.length} navigation permit(s) issued and never consumed`,
      open.map((p) => `${p.id} ${p.url}`));
  }

  // The other check `status` was missing.
  const ledger = checkPermitLedger(log);
  if (ledger.length) add('permit-ledger', `the permit ledger is inconsistent: ${ledger.length} problem(s)`, ledger);

  const awaiting = agenciesAwaitingExhaustion(log);
  if (awaiting.length) {
    add('awaiting-exhaustion', `${awaiting.length} agency(ies) awaiting an exhaustion record`, awaiting);
  }

  return blockers;
}
