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
  DISCOVERY_METHODS, DISCOVERY_OUTCOMES,
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
    if (!isoUtcish(attempt.navigatedAt)) {
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
    if (sameRound) {
      throw new Error(
        `${attempt.url} is already recorded for ${attempt.agency} / ${attempt.category} ` +
          `round ${attempt.candidateSetVersion}`
      );
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
      a.candidateSetVersion === set.version
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
export function deriveDraft(log, { frameSha256, drawOrderSha256, selectionLedgerFile = 'selection-ledger.csv', synthetic = false, frameAgencies = null }) {
  const pending = log.attempts.filter((a) => a.approval === APPROVAL.PENDING);
  if (pending.length) {
    throw new Error(
      `${pending.length} attempt(s) still pending researcher approval; the corpus cannot be built until every inclusion and exclusion is approved`
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
