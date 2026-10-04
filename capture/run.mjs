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
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  LEDGER_HEADER, recordExamination, CATEGORIES, needsHeadedFallback,
  STRUCTURAL_REPORT_VERSION, STRUCTURAL_REPORT_SOURCES, NAME_FIELD_HINT, classifyNameField,
  REGISTER_LABEL,
} from './capture.mjs';
import { POLICY } from './politeness.mjs';
import { DISCOVERY_EVIDENCE, RENDERED_METHODS } from './render-discovery.mjs';
import { evaluatePolicy } from './robots-policy.mjs';
import {
  DISCOVERY_KINDS, remainingBudget, MAX_CANDIDATES_PER_CATEGORY, MAX_CANDIDATES_PER_AGENCY,
  canonicalise, setKey, MAX_QUALIFIED_AGENCIES, CATEGORY_ORDER, lockCandidates, isSuperseded,
  DISCOVERY_METHODS, DISCOVERY_OUTCOMES, nextWork, isExhausted, TECHNICAL_ATTRITION_OUTCOMES,
  JUDGEMENT_OUTCOMES, RECORD_TYPES, RENDER_BEARING_RECORD_TYPES,
  TECHNICAL_CONCLUSION_OUTCOME, isServedStatus, isUsableStatus,
  TERMINAL_STATUSES, isTerminalDecision, isEvidenceOnly, terminalDecisionsFor,
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

export const APPROVAL = Object.freeze({
  PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected',
  // Amendment 41. An evidence-only retrieval has no decision to approve. Leaving it `pending`
  // made it unfinished business that approving would "resolve", and approving it then satisfied
  // every gate that tested `status !== 'discovery'` - so a candidate could be settled by the act
  // of retrieving it. There is nothing to approve, so the field says so.
  NOT_APPLICABLE: 'not-applicable',
});

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const isoUtcish = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && v.endsWith('Z');

/** The most recent recorded top-level navigation, whatever produced it. */
/**
 * Amendment 64. A plain-resource fetch is traffic, so it constrains the next request.
 *
 * This read `log.attempts` alone, so a `read-resource` fetch was invisible to pacing until a
 * discovery record was written for it. Two sitemap documents were therefore requested one second
 * apart against a five-second floor, and the breach surfaced only when the second outcome record
 * was refused - after both requests had been made. Traffic is counted where it happens.
 */
export const FETCH_PACING_REQUIRED_FROM = Date.parse('2026-10-04T09:04:00Z');

export function lastNavigation(log) {
  const fetchTimes = (log.fetches ?? [])
    .map((f) => Date.parse(f.fetchedAt ?? ''))
    .filter((n) => !Number.isNaN(n));
  const times = log.attempts
    // selection-v1.0.11: a record that states no request was made must not contribute a
    // navigation time. The two `NOT NAVIGATED` search records carried `navigatedAt` and were
    // counted in the five-second pacing, so the raw data asserted a navigation the note denied.
    .filter((a) => a.navigationPerformed !== false)
    .map((a) => a.navigatedAt ?? a.capturedAt ?? null)
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter((n) => !Number.isNaN(n));
  const all = [...times, ...fetchTimes];
  return all.length ? Math.max(...all) : null;
}

/**
 * Amendment 65. The last request of ANY kind, for seeding the pacer: page navigations, retained
 * resource fetches and robots.txt fetches alike. `lastNavigation` deliberately keeps its narrower
 * meaning, because the record-time navigation check is about navigations.
 */
export function lastRequest(log) {
  const times = [
    ...(log.attempts ?? [])
      .filter((a) => a.navigationPerformed !== false && !a.promotedFrom && !a.fetchId)
      .map((a) => instantUpperBound(a.navigatedAt ?? a.capturedAt)),
    ...(log.fetches ?? []).map((f) => instantUpperBound(f.fetchedAt)),
    ...(log.robotsChecks ?? []).map((c) => instantUpperBound(c.fetchedAt)),
  ].filter((n) => typeof n === 'number' && !Number.isNaN(n));
  return times.length ? Math.max(...times) : null;
}

/**
 * Amendment 66. The LATEST instant a recorded timestamp can stand for.
 *
 * Every time in this log is written to second precision, so a request made at 09:03:24.900Z is
 * recorded as 09:03:24Z. Seeding the pacer from the parsed value therefore believed the previous
 * request was up to 999 ms earlier than it was, and the wait came out short: the timing tests for
 * this amendment measured 4418 ms and 4537 ms against a five-second floor, from the server's own
 * clock. Pacing must err towards waiting too long, so a second-granularity timestamp is read as
 * the end of its second.
 */
export function instantUpperBound(iso) {
  if (typeof iso !== 'string') return NaN;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return NaN;
  return /\.\d{3}Z$/.test(iso) ? parsed : parsed + 999;
}

export function emptyLog() {
  return {
    schema: LOG_SCHEMA, politeness: { ...POLICY }, attempts: [],
    candidateSets: {}, supersededCandidateSets: [], exhausted: [],
  };
}

/**
 * The artefacts a capture directory holds besides the log. `init` refuses to write a log beside
 * any of them, because that state means a log was lost or the path is wrong.
 */
export const CAPTURE_ARTEFACTS = Object.freeze([
  'captures', 'rendered', 'quarantine', 'selection-ledger.csv', 'provenance.json', 'corpus.json',
]);

/**
 * Reads the log, or refuses. It never invents one.
 *
 * Amendment 52. This returned `emptyLog()` for a path that did not exist, so a mistyped `--out`
 * did not fail - it answered, about a scan that had not happened. The command that exposed it was
 * `npm --prefix capture run approve-set -- --out evaluation/data/capture`, which reads correctly
 * from the repository root and is wrong: `npm run` executes with the PACKAGE directory as its cwd,
 * so the path resolved to `capture/evaluation/data/capture`. The same slip on a read-only command
 * reported Te Puni Kokiri, agency 1 of the frozen draw order, finished five agencies earlier, as
 * current work.
 *
 * Nothing was written that time, but only because the command happened to be read-only. A write
 * would have begun a second log in the wrong place, and a discovery command would have fetched
 * robots.txt and issued permits against a log that believes no politeness has been spent yet.
 *
 * So the default is removed rather than guarded at each call site, and starting a scan is an
 * explicit act: `init`. The message carries the RESOLVED path, because the whole difficulty is
 * that the operator cannot see the resolution in the command they typed.
 */
export function readLog(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(
      `no capture log at ${resolved}\n` +
        '  Nothing was read, written or requested.\n' +
        '  To start a new scan here:   init --out <dir>\n' +
        '  For an existing scan, check --out: a relative path resolves against the current\n' +
        '  directory, and `npm --prefix capture run` makes that the capture/ directory. Prefer\n' +
        '  running from the repository root with an absolute path:\n' +
        '    node capture/cli-capture.mjs <command> --out "$PWD/evaluation/data/capture"'
    );
  }
  const log = JSON.parse(readFileSync(resolved, 'utf8'));
  if (log.schema !== LOG_SCHEMA) throw new Error(`capture log schema must be ${LOG_SCHEMA}`);
  return log;
}

/**
 * Starts a scan: writes an empty log, once, into a directory that holds no scan already.
 *
 * Deliberately a command of its own rather than a flag. A general `--init` could accompany any
 * other operation and create the very log that operation was supposed to find, which is the
 * failure this amendment exists to close, reintroduced one layer up.
 */
export function initLog(dir) {
  const root = resolve(dir);
  const path = join(root, 'capture-log.json');
  if (existsSync(path)) {
    throw new Error(
      `a capture log already exists at ${path}\n` +
        '  init never overwrites one. A scan in progress is the evidence; starting again would ' +
        'discard it.'
    );
  }
  const orphaned = CAPTURE_ARTEFACTS.filter((name) => existsSync(join(root, name)));
  if (orphaned.length) {
    throw new Error(
      `${root} already holds capture artefacts (${orphaned.join(', ')}) but no capture-log.json\n` +
        '  A log written here would disclaim the evidence sitting beside it. Either this is the ' +
        'wrong\n  --out, or a log was lost and belongs in a recovery, not a fresh scan.'
    );
  }
  // `writeLog` creates the directory and writes through a temporary file, so a reader never sees
  // a partial log.
  writeLog(path, emptyLog());
  return path;
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
  if (!['captured', 'retrieved', 'excluded', 'eligible-not-selected', 'failed', 'capture-blocked', 'discovery'].includes(attempt.status)) {
    problems.push('status must be captured, excluded, failed, capture-blocked or discovery');
  }
  // capture-v1.0.6. `capture-blocked` says the harness could not retrieve the page, and says
  // nothing about whether the public can. Conflating the two produced an eligibility claim the
  // evidence did not support, so this status must leave every criterion unknown.
  if (attempt.status === 'capture-blocked') {
    for (const c of ELIGIBILITY_CRITERIA) {
      if (attempt.eligibility?.[c] !== null) {
        problems.push(
          `a capture-blocked attempt must leave eligibility.${c} null: automated retrievability ` +
            'and public eligibility are different facts'
        );
      }
    }
    if (!Array.isArray(attempt.attemptedModes) || attempt.attemptedModes.length === 0) {
      problems.push('a capture-blocked attempt must record which browser modes were attempted');
    }
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
    // selection-v1.0.24. A record claiming rendered evidence must carry the evidence. Without
    // this, `evidence: 'rendered-dom'` would be a word that satisfies the backlog gate while
    // resting on nothing - and the gate exists precisely because plain retrieval was being
    // treated as though it had read the page.
    // selection-v1.0.25. Observation and judgement are different kinds of record and are held to
    // different requirements. Leaving the distinction implicit is what let a judgement be supplied
    // before the evidence was read.
    if (attempt.recordType !== undefined) {
      if (!Object.values(RECORD_TYPES).includes(attempt.recordType)) {
        problems.push(`recordType must be ${Object.values(RECORD_TYPES).join(' or ')}, not ${JSON.stringify(attempt.recordType)}`);
      }
      if (attempt.recordType === RECORD_TYPES.OBSERVATION) {
        if (!attempt.renderId) problems.push('an observation needs renderId, the render it recorded');
        // Amendment 46. A RE-CLASSIFICATION made no request, so it has no permit of its own and
        // must not borrow the one its predecessor consumed. It is an observation because it records
        // what the retained bytes show; it declares `navigationPerformed: false` and names the
        // record it supersedes, and those two together are what distinguish it from an observation
        // that quietly lost its permit.
        const reclassification = attempt.navigationPerformed === false && attempt.supersedesDiscoveryId;
        if (!attempt.permitId && !reclassification) {
          problems.push('an observation needs the permit that authorised its request');
        }
        if (attempt.permitId && reclassification) {
          problems.push(
            'a re-classification made no request and must not name a permit; the permit its ' +
              'predecessor consumed authorised that request, not this record'
          );
        }
        if (!['rendered', 'retrieval-blocked'].includes(attempt.outcome)) {
          problems.push(
            `an observation records ${JSON.stringify(attempt.outcome)}; it may only be rendered or ` +
              'retrieval-blocked, because an observation concludes nothing'
          );
        }
      }
      // Amendment 48. A re-reading of bytes already held: no request, so no permit and no
      // navigation time, and it must say which classification it corrects.
      if (attempt.recordType === RECORD_TYPES.RECLASSIFICATION) {
        if (!attempt.renderId) {
          problems.push('a reclassification needs renderId, the render carrying the corrected metadata');
        }
        if (!attempt.supersedesDiscoveryId) {
          problems.push('a reclassification must supersede the record whose classification it corrects');
        }
        if (attempt.navigationPerformed !== false) {
          problems.push(
            'a reclassification must record navigationPerformed: false; it re-reads bytes already ' +
              'held and makes no request'
          );
        }
        if (attempt.permitId) {
          problems.push(
            'a reclassification must not name a permit; the permit its predecessor consumed ' +
              'authorised that retrieval, not this re-reading'
          );
        }
        if (attempt.navigatedAt) {
          problems.push(
            'a reclassification must not carry navigatedAt; the render it cites holds when those ' +
              'bytes were fetched'
          );
        }
        if (!['rendered', 'retrieval-blocked'].includes(attempt.outcome)) {
          problems.push(
            `a reclassification records ${JSON.stringify(attempt.outcome)}; like an observation it ` +
              'concludes nothing about candidates'
          );
        }
      }
      // Amendment 57. A policy-reuse record: the round's robots position, resting on a policy
      // already recorded. It makes no request, so it must name none of a request's apparatus.
      if (attempt.recordType === RECORD_TYPES.POLICY_REUSE) {
        if (attempt.discoveryKind !== 'robots') {
          problems.push('a policy-reuse record is a robots-method record');
        }
        if (!attempt.robotsCheckId) {
          problems.push('a policy-reuse record needs robotsCheckId, the recorded policy it rests on');
        }
        if (attempt.permitId) {
          problems.push(
            'a policy-reuse record makes no request, so it must not name a permit; naming one ' +
              'would claim the very refetch this record exists to avoid'
          );
        }
        if (attempt.navigatedAt) {
          problems.push('a policy-reuse record makes no request, so it must not carry a navigation timestamp');
        }
        if (attempt.navigationPerformed !== false) {
          problems.push('a policy-reuse record must record navigationPerformed: false');
        }
        if (attempt.fetchId) {
          problems.push('a policy-reuse record retains nothing: the recorded check already holds the bytes');
        }
        if (attempt.outcome !== 'no-candidates') {
          problems.push(
            `a policy-reuse record records no-candidates, not ${JSON.stringify(attempt.outcome)}: ` +
              'a policy yields no discovery lead of its own'
          );
        }
      }

      // Amendment 54. A technical conclusion: the render happened, the server did not serve the
      // page, and nothing on it bears on candidates. Which conclusion a render may carry is
      // decided by the status the RENDER recorded - see `renderStatusProblems` below, which
      // enforces it in both directions and reads the status from the registry, never from here.
      if (attempt.recordType === RECORD_TYPES.TECHNICAL_CONCLUSION) {
        if (!attempt.renderId) {
          problems.push('a technical conclusion needs renderId, the render it concludes about');
        }
        if (!attempt.evidenceFromDiscoveryId) {
          problems.push('a technical conclusion needs evidenceFromDiscoveryId, the observation it cites');
        }
        if (attempt.permitId) {
          problems.push(
            'a technical conclusion makes no request, so it must not name a permit'
          );
        }
        if (attempt.navigatedAt) {
          problems.push(
            'a technical conclusion makes no request, so it must not carry a navigation timestamp'
          );
        }
        if (attempt.navigationPerformed !== false) {
          problems.push('a technical conclusion must record navigationPerformed: false');
        }
        if (attempt.outcome !== TECHNICAL_CONCLUSION_OUTCOME) {
          problems.push(
            `a technical conclusion records ${TECHNICAL_CONCLUSION_OUTCOME}, not ` +
              JSON.stringify(attempt.outcome)
          );
        }
        // It concludes about a render; it does not withdraw the observation that made it. The
        // render DID happen, and that record stays active.
        if (attempt.supersedesDiscoveryId) {
          problems.push(
            'a technical conclusion does not supersede the observation it cites: the render ' +
              'happened, and this is a separate conclusion about what the server served'
          );
        }
      }
      if (attempt.recordType === RECORD_TYPES.JUDGEMENT_ONLY) {
        if (!attempt.renderId) problems.push('a judgement needs renderId, the evidence it rests on');
        if (!attempt.evidenceFromDiscoveryId) {
          problems.push('a judgement needs evidenceFromDiscoveryId, the observation record it reads');
        }
        if (attempt.permitId) {
          problems.push(
            'a judgement makes no request, so it must not name a permit; naming one would claim a ' +
              'second retrieval that did not happen'
          );
        }
        if (attempt.navigationPerformed !== false) {
          problems.push('a judgement must record navigationPerformed: false');
        }
        if (!JUDGEMENT_OUTCOMES.includes(attempt.outcome)) {
          problems.push(`a judgement records ${JUDGEMENT_OUTCOMES.join(' or ')}, not ${JSON.stringify(attempt.outcome)}`);
        }
      }
    }
    // Amendment 48. A reclassification may also record `rendered`: it states what the retained
    // bytes show under a corrected classifier, which is the same kind of statement an observation
    // makes about them, minus the retrieval.
    if (attempt.outcome === 'rendered' &&
        ![RECORD_TYPES.OBSERVATION, RECORD_TYPES.RECLASSIFICATION].includes(attempt.recordType)) {
      problems.push('only an observation or a reclassification may record the outcome `rendered`');
    }
    if (attempt.evidence !== undefined) {
      if (!['rendered-dom', 'plain-retrieval'].includes(attempt.evidence)) {
        problems.push(`evidence must be rendered-dom or plain-retrieval, not ${JSON.stringify(attempt.evidence)}`);
      }
      if (attempt.evidence === 'rendered-dom') {
        if (!/^[0-9a-f]{64}$/.test(attempt.renderedSha256 ?? '')) {
          problems.push('a rendered-dom record needs renderedSha256, the digest of the rendered markup');
        }
        if (!attempt.renderFile) problems.push('a rendered-dom record needs renderFile');
        if (!Number.isInteger(attempt.renderedBytes) || attempt.renderedBytes < 0) {
          problems.push('a rendered-dom record needs renderedBytes');
        }
        if (!RENDERED_METHODS.includes(attempt.discoveryKind)) {
          problems.push(
            `a rendered-dom record must be a ${RENDERED_METHODS.join(' or ')} inspection; there is ` +
              'no DOM behind a robots file, a sitemap or a status code'
          );
        }
      }
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
  if (attempt.status !== 'retrieved' && attempt.approval === APPROVAL.NOT_APPLICABLE) {
    problems.push(
      `only an evidence-only retrieval may record approval ${JSON.stringify(APPROVAL.NOT_APPLICABLE)}; ` +
        `a ${attempt.status} attempt is a decision and must be approved or rejected`
    );
  }
  if (attempt.status !== 'discovery' && !CATEGORIES.includes(attempt.category)) {
    problems.push(
      `every candidate needs a category from ${CATEGORIES.join(', ')}; omitting it would ` +
        'escape the per-category limit'
    );
  }
  // Amendment 40. Assessment-only retrieval: the bytes, their digest and the browser that fetched
  // them, and NO eligibility claim. The capture path asserts criteria three and four as true on its
  // captured branch, so obtaining a page in order to decide whether it qualifies meant asserting
  // that it did - which is how `c-0494` came to record a page with zero controls as satisfying all
  // five. A retrieval that concludes nothing cannot make that mistake, and the researcher then
  // excludes from it or promotes it without requesting the page a second time.
  if (attempt.status === 'retrieved') {
    if (attempt.approval !== APPROVAL.NOT_APPLICABLE) {
      problems.push(
        `a retrieved attempt must record approval ${JSON.stringify(APPROVAL.NOT_APPLICABLE)}, not ` +
          `${JSON.stringify(attempt.approval)}: it holds evidence and decides nothing, so there is ` +
          'nothing to approve or reject'
      );
    }
    if (!attempt.pageId) problems.push('a retrieved attempt needs a pageId');
    if (!attempt.file) problems.push('a retrieved attempt needs a file');
    if (!attempt.htmlSha256) problems.push('a retrieved attempt needs htmlSha256');
    if (attempt.inclusionEvidence) {
      problems.push('a retrieved attempt must not carry inclusionEvidence; it claims nothing');
    }
    if (ELIGIBILITY_CRITERIA.some((c) => attempt.eligibility?.[c] !== null)) {
      problems.push(
        'a retrieved attempt must leave every eligibility criterion null; it records what was ' +
          'fetched, not what it means'
      );
    }
  }
  // Amendment 44. A candidate that satisfied every criterion and lost only the tie-break.
  //
  // Recorded as `excluded` with all five criteria null, "eligible but not selected" was legible
  // only in prose: the log could not compute how many candidates were eligible, and the tie-break
  // could not be checked against anything. `doExclude`'s own comment makes this argument about
  // criterion-five counts; it applies with equal force here.
  if (attempt.status === 'eligible-not-selected') {
    if (ELIGIBILITY_CRITERIA.some((c) => attempt.eligibility?.[c] !== true)) {
      problems.push(
        'an eligible-not-selected attempt must record every eligibility criterion as true; it is ' +
          'not an exclusion on eligibility'
      );
    }
    if (!attempt.exclusionReason) {
      problems.push('an eligible-not-selected attempt needs a reason stating the tie-break');
    }
    if (!attempt.evidenceFromAttemptId) {
      problems.push(
        'an eligible-not-selected attempt must cite the assessment-only retrieval it was judged ' +
          'from, so the eligibility claim rests on named evidence'
      );
    }
    if (!attempt.notSelectedInFavourOf) {
      problems.push(
        'an eligible-not-selected attempt must name the captured candidate that was selected ' +
          'instead, in notSelectedInFavourOf'
      );
    }
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
  if (!['captured', 'retrieved', 'discovery', 'eligible-not-selected'].includes(attempt.status) &&
      !attempt.exclusionReason) {
    problems.push('a non-captured attempt needs an exclusionReason');
  }
  return problems;
}

/**
 * Free text may not restate what the structured fields already carry. Amendment 42.
 *
 * `c-0576` was approved-ready with a fabricated digest: its reason read "sha256 0e7b3cb3ee1b" while
 * the file hashed to `fa4c2f68…`. The record's own `htmlSha256` was right and the citation check had
 * verified it against the retrieval - the invented string lived in the free-text reason, where
 * nothing checks anything. Every gate in this package compares fields to fields, so none of them
 * could have caught it; it was found by reading the prose against the file.
 *
 * So prose stops being a second source of truth. A digest-shaped token is refused outright: name the
 * evidence record instead, and let the ledger render the digest from the field. A byte count is
 * refused only when the record HAS `htmlBytes` - describing some other artefact, such as the
 * 212-byte challenge document served in place of a robots file, is still legitimate prose.
 */
const FREE_TEXT_FIELDS = Object.freeze(['exclusionReason', 'inclusionEvidence', 'note', 'approvalNote']);

export function restatedEvidenceProblems(attempt) {
  const problems = [];
  for (const field of FREE_TEXT_FIELDS) {
    const text = attempt[field];
    if (typeof text !== 'string' || text === '') continue;
    for (const m of text.matchAll(/\b[0-9a-f]{12,}\b/g)) {
      problems.push(
        `${field} states the digest-shaped token ${JSON.stringify(m[0])}. Do not restate a digest ` +
          'in free text: cite the evidence record by id and let the ledger render htmlSha256 from ' +
          'the verified field.'
      );
    }
    if (attempt.htmlBytes !== undefined && attempt.htmlBytes !== null) {
      for (const m of text.matchAll(/\b(\d{4,})[ -]byte(?:s)?\b/g)) {
        problems.push(
          `${field} states ${m[1]} bytes while this record carries htmlBytes=${attempt.htmlBytes}. ` +
            'Do not restate a length this record already records; the ledger renders it.'
        );
      }
    }
  }
  return problems;
}

/**
 * Appends one attempt. Rejects a duplicate pageId or URL so a rerun cannot silently
 * double-count, and refuses an attempt that fails its own checks rather than recording
 * something the seal will later have to interpret.
 */
/** Amendment 62. The supersession target's identity - decidable before any request. */
export function supersedesTargetProblem(log, attempt) {
  if (!attempt.supersedesAttemptId) return null;
  const target = (log.attempts ?? []).find((a) => a.id === attempt.supersedesAttemptId);
  if (!target) return `supersedesAttemptId ${attempt.supersedesAttemptId} matches no recorded attempt`;
  if (target.agency !== attempt.agency || target.url !== attempt.url) {
    return (
      `attempt ${target.id} is ${target.agency} / ${target.url}, which is not what this ` +
      `attempt supersedes (${attempt.agency} / ${attempt.url})`
    );
  }
  return null;
}

/**
 * Amendment 62. An authorised RE-RETRIEVAL of a page already retrieved, for evidence the first
 * retrieval does not carry.
 *
 * `c-1017` retrieved the SIA contact page truthfully before the report boundary and carries no
 * structural report, and Amendment 59 proved an offline replay cannot establish the live
 * visibility criterion four needs. So the only way to settle the candidate is to request the page
 * once more - and the duplicate-URL rule had no way to express that, because the earlier record is
 * neither rejected nor an evidence citation. This is deliberately narrow: it names a STANDING
 * evidence-only retrieval of the same page which lacks a complete current report, it does NOT
 * supersede it (that record is incomplete, not false), and it carries its own pageId so neither
 * retrieval's bytes are overwritten. Every one of these is decidable before the request, which is
 * the point: a re-retrieval that would establish nothing must cost nothing to refuse.
 */
export function extendsTargetProblem(log, attempt) {
  if (!attempt.extendsAttemptId) return null;
  const prior = (log.attempts ?? []).find((a) => a.id === attempt.extendsAttemptId);
  if (!prior) return `extendsAttemptId names ${attempt.extendsAttemptId}, which is not a recorded attempt`;
  if (attempt.status !== 'retrieved') {
    return (
      `a ${attempt.status} record may not extend ${prior.id}; only an evidence-only retrieval ` +
      're-retrieves a page, and the decision is recorded from it afterwards'
    );
  }
  if (prior.status !== 'retrieved') {
    return `${prior.id} is a ${prior.status} attempt; extendsAttemptId names an evidence-only retrieval`;
  }
  if (isSuperseded(log, prior)) {
    return `${prior.id} has been superseded; it is not standing evidence to extend`;
  }
  if (prior.agency !== attempt.agency || canonicalise(prior.url) !== canonicalise(attempt.url)) {
    return (
      `${prior.id} is ${prior.agency} / ${prior.url}, not ${attempt.agency} / ${attempt.url}; ` +
      'a re-retrieval extends the same page for the same agency'
    );
  }
  if (hasCompleteCurrentReport(prior)) {
    return (
      `${prior.id} already carries a complete live structural report; there is nothing a second ` +
      'request would establish, so the page is not requested again'
    );
  }
  if (attempt.pageId && prior.pageId === attempt.pageId) {
    return `a re-retrieval must carry its own pageId; ${prior.pageId} belongs to ${prior.id} and its bytes stand`;
  }
  return null;
}

/**
 * The duplicate-URL rule, as one function.
 *
 * Amendment 62. This lived inline in `appendAttempt`, which runs AFTER the page has been
 * requested. It is a pure function of the log and the record's identity - nothing a response can
 * change - so an authorised request was spent on a write that could never have succeeded. It is
 * extracted so the same rule can decide before the request, and is not restated anywhere.
 */
export function duplicateUrlProblem(log, attempt) {
  if (attempt.status === 'discovery') return null;
  const priorForUrl = (log.attempts ?? []).filter(
    (a) => a.status !== 'discovery' && a.agency === attempt.agency && a.url === attempt.url
  );
  if (priorForUrl.length === 0) return null;
  // Each of these is a second record for one URL BY DESIGN, and each is validated on its own terms.
  if (attempt.supersedesAttemptId) return null;
  if (attempt.evidenceFromAttemptId) return null;
  if (attempt.promotedFrom) return null;
  if (attempt.extendsAttemptId) return null;
  // A rejected decision is corrected by recording a NEW attempt that supersedes it. The original
  // stays in the log: a correction that erases what it corrected is not a correction, and the
  // ledger has to show what was decided first.
  const rejected = priorForUrl.filter((a) => a.approval === APPROVAL.REJECTED && !isSuperseded(log, a));
  if (attempt.supersedes === attempt.url && rejected.length > 0) return null;
  const retrievals = priorForUrl.filter((a) => a.status === 'retrieved' && !isSuperseded(log, a));
  return (
    `url ${attempt.url} is already recorded for ${attempt.agency}` +
    (rejected.length
      ? '. Its decision was rejected; record the correction with ' +
        `supersedesAttemptId set to ${rejected.map((a) => a.id).join(' or ')}.`
      : '') +
    (!rejected.length && retrievals.length
      ? '. It holds an evidence-only retrieval; an authorised re-retrieval names it with ' +
        `extendsAttemptId set to ${retrievals.map((a) => a.id).join(' or ')}.`
      : '')
  );
}

/**
 * Everything refusable BEFORE the request, so a refusal costs nothing.
 *
 * Amendment 62. The identity checks do not depend on the response: a colliding pageId and an
 * already-recorded URL are both decidable from the log and the arguments. Checking them only at
 * write time meant the bytes were on the wire first, and the one authorised retrieval of
 * `www.sia.govt.nz/about/contact-us` was consumed by a write that was always going to fail. The
 * checks that genuinely need the response - a redirect's final URL, the digest - necessarily stay
 * at write time.
 */
export function preRequestProblems(log, attempt) {
  const problems = [];
  const sameBytesAs = attempt.recordType === RECORD_TYPES.STRUCTURAL_REANALYSIS
    ? attempt.evidenceFromAttemptId
    : attempt.promotedFrom;
  if (attempt.pageId && (log.attempts ?? []).some(
    (a) => a.pageId === attempt.pageId && a.id !== sameBytesAs
  )) {
    problems.push(`pageId ${attempt.pageId} is already recorded`);
  }
  for (const problem of [
    duplicateUrlProblem(log, attempt),
    supersedesTargetProblem(log, attempt),
    extendsTargetProblem(log, attempt),
  ]) {
    if (problem) problems.push(problem);
  }
  return problems;
}

export function appendAttempt(log, attempt) {
  const problems = [...checkAttempt(attempt), ...restatedEvidenceProblems(attempt)];
  if (problems.length) throw new Error(`invalid capture attempt:\n  ${problems.join('\n  ')}`);
  // Amendment 40. A promotion carries its retrieval's pageId BY DESIGN: it is the same page, the
  // same bytes and the same file, recorded now with an eligibility decision attached. The id
  // collision rule exists to stop two different pages sharing one identity, which this is not.
  const promotionOf = attempt.promotedFrom
    ? log.attempts.find((a) => a.id === attempt.promotedFrom)
    : null;
  if (attempt.promotedFrom && !promotionOf) {
    throw new Error(`promotedFrom names ${attempt.promotedFrom}, which is not a recorded attempt`);
  }
  if (promotionOf && promotionOf.status !== 'retrieved') {
    throw new Error(
      `${attempt.promotedFrom} is a ${promotionOf.status} attempt; only an assessment-only ` +
        'retrieval is promoted'
    );
  }
  // Amendment 62. An authorised RE-RETRIEVAL of a page already retrieved, for evidence the first
  // retrieval does not carry.
  //
  // `c-1017` retrieved this contact page truthfully before the report boundary and carries no
  // structural report, and Amendment 59 proved an offline replay cannot establish the live
  // visibility criterion four needs. So the only way to settle the candidate is to request the
  // page once more - and the duplicate-URL rule had no way to express that, because the earlier
  // record is neither rejected nor an evidence citation. This is deliberately narrow: it names a
  // standing evidence-only retrieval of the same page, which must lack a complete current report,
  // it does NOT supersede it (that record is incomplete, not false), and it carries its own
  // pageId and file so neither retrieval's bytes are overwritten.
  if (attempt.extendsAttemptId) {
    const problem = extendsTargetProblem(log, attempt);
    if (problem) throw new Error(problem);
  }
  // Amendment 61. A structural reanalysis names the evidence it re-read, exactly as a promotion
  // names the retrieval it settles: same bytes, same identity, a reading added rather than a
  // second retrieval. The collision rule exists to stop two DIFFERENT pages sharing an identity,
  // which neither of those is.
  const sameBytesAs = attempt.recordType === RECORD_TYPES.STRUCTURAL_REANALYSIS
    ? attempt.evidenceFromAttemptId
    : attempt.promotedFrom;
  if (attempt.pageId && log.attempts.some(
    (a) => a.pageId === attempt.pageId && a.id !== sameBytesAs
  )) {
    throw new Error(`pageId ${attempt.pageId} is already recorded`);
  }
  // Per AGENCY, not globally: a third-party form linked by two agencies is genuine
  // evidence for both, and refusing to record it for the second would hide that.
  if (attempt.status === 'discovery') {
    // selection-v1.0.25. An observation and a judgement about the same page in the same round are
    // two records for one URL BY DESIGN - the evidence and the reading of it. The duplicate rule
    // exists to stop one page being recorded twice as two findings, and an observation is not a
    // finding, so the two kinds are compared only against their own kind.
    // selection-v1.0.28: a REFUSED retrieval is an attempt, not a finding, so it shares the
    // observation side of this split. Without that, recording "this page redirects somewhere the
    // policy forbids" was impossible for any URL the round had already inspected - which is every
    // URL in the retrospective backlog.
    const kindOf = (a) =>
      (a.recordType === RECORD_TYPES.OBSERVATION || a.renderRefused === true ? 'observation' : 'finding');
    const incoming = kindOf(attempt);
    const sameRound = log.attempts.some(
      (a) => a.status === 'discovery' && a.agency === attempt.agency && a.url === attempt.url &&
        a.category === attempt.category && a.candidateSetVersion === attempt.candidateSetVersion &&
        kindOf(a) === incoming
    );
    // selection-v1.0.32. A headed fallback is a SECOND observation of the same page in the same
    // round, by design - two browser modes of one attempt to read it. It is permitted only when it
    // says so, by naming the barred observation it follows; an unlinked second observation is still
    // refused, because that would be the same page requested twice for no stated reason.
    const inSameRound = (id) => log.attempts.some(
      (a) => a.id === id && a.status === 'discovery' &&
        a.agency === attempt.agency && a.category === attempt.category &&
        a.candidateSetVersion === attempt.candidateSetVersion &&
        canonicalise(a.url) === canonicalise(attempt.url)
    );
    const isLinkedFallback = attempt.recordType === RECORD_TYPES.OBSERVATION &&
      typeof attempt.followsDiscoveryId === 'string' && inSameRound(attempt.followsDiscoveryId);
    // selection-v1.0.34. A rendered judgement ANSWERING the plain-retrieval record for the same page
    // and round is the second legitimate case, and it is the whole retrospective backlog: all
    // sixty-six obligations are a plain-fetch record and the rendered judgement that answers it. The
    // alternative was to supersede each one, which would withdraw sixty-six records that are not
    // wrong - each was true of the method it used - and would drop the `answersDiscoveryId` link the
    // protocol asks a judgement to carry. `answersDiscoveryId` is already validated above for agency,
    // category, round, page and rendered evidence, so naming it is not a way round the rule.
    const isAnsweringJudgement = attempt.recordType === RECORD_TYPES.JUDGEMENT_ONLY &&
      typeof attempt.answersDiscoveryId === 'string' && inSameRound(attempt.answersDiscoveryId);
    if (sameRound && !attempt.supersedesDiscoveryId && !isLinkedFallback && !isAnsweringJudgement) {
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
    // selection-v1.0.35. The chain's answer link is inherited, not dropped and not changed.
    const inherited = answerChain(log, target);
    if (inherited.conflict) {
      throw new Error(
        `the correction chain through ${target.id} answers more than one record ` +
          `(${inherited.answers.join(', ')}); a chain of corrections resolves one obligation`
      );
    }
    // Amendment 48. The link may be resolved FORWARD through supersession, and only forward.
    //
    // selection-v1.0.35 fixed the link so a repair could not quietly retarget it, which is right.
    // What it did not cover is the ANSWERED record being withdrawn and replaced: `d-0684` was
    // superseded by the reclassification `d-0686`, and inheriting the link verbatim left the
    // judgement answering a record that no longer stands while its replacement read as unjudged.
    // Any OTHER target is still refused, so this permits following a supersession and nothing else.
    const forwardFrom = (id) => {
      const chain = new Set();
      let current = id;
      for (;;) {
        chain.add(current);
        // Evidence successors only, for the reason given at `answerChain`.
        const next = log.attempts.find(
          (a) => a.supersedesDiscoveryId === current &&
            [RECORD_TYPES.OBSERVATION, RECORD_TYPES.RECLASSIFICATION].includes(a.recordType)
        );
        if (!next) return chain;
        current = next.id;
      }
    };
    if (inherited.stable && attempt.answersDiscoveryId !== inherited.stable &&
        !forwardFrom(inherited.stable).has(attempt.answersDiscoveryId)) {
      throw new Error(
        `this correction must keep answering ${inherited.stable}, which its chain established, or a ` +
          'record that supersedes it' +
          (attempt.answersDiscoveryId ? `, not ${attempt.answersDiscoveryId}` : '; it names none') +
          '. A correction that drops the link silently reopens the obligation it discharged.'
      );
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
  // selection-v1.0.24. A rendered inspection names the plain-fetch record it supersedes as
  // evidence, and the original is PRESERVED. Not `supersedesDiscoveryId`: that requires the same
  // category, and the first use of this is a service-application render of a page first inspected
  // under account-registration. The link must therefore cross categories, and it is not a
  // correction - the earlier record was true about the method it used.
  // selection-v1.0.32. The fallback link: the record it follows must be the same work, and must be
  // an observation that was actually barred - otherwise "follows" would be a way of recording a
  // second request for a page that had already been read.
  if (attempt.followsDiscoveryId) {
    const target = log.attempts.find((a) => a.id === attempt.followsDiscoveryId);
    if (!target) {
      throw new Error(`followsDiscoveryId ${attempt.followsDiscoveryId} matches no recorded attempt`);
    }
    if (target.status !== 'discovery') {
      throw new Error(`${target.id} is a ${target.status} attempt; a fallback follows a discovery record`);
    }
    if (target.recordType !== RECORD_TYPES.OBSERVATION) {
      throw new Error(`${target.id} is not an observation; a fallback follows the retrieval it retries`);
    }
    if (target.outcome !== 'retrieval-blocked') {
      throw new Error(
        `${target.id} records ${JSON.stringify(target.outcome)}; a fallback follows an attempt that ` +
          'was access-barred, or there was nothing to retry'
      );
    }
    for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
      ['candidateSetVersion', 'round']]) {
      if (target[field] !== attempt[field]) {
        throw new Error(`${target.id} is ${label} ${JSON.stringify(target[field])}, not ${JSON.stringify(attempt[field])}`);
      }
    }
    if (canonicalise(target.url) !== canonicalise(attempt.url)) {
      throw new Error(`${target.id} is ${target.url}, not ${attempt.url}`);
    }
    if (target.permitId && attempt.permitId && target.permitId === attempt.permitId) {
      throw new Error(
        `${attempt.id ?? 'this record'} and ${target.id} name the same permit ${target.permitId}; a ` +
          'fallback is a second navigation and takes its own'
      );
    }
  }

  // selection-v1.0.26. An explicit answered record, checked at write time as well as at the gate.
  // Keying answers by canonical URL and category alone let a judgement about a shared third-party
  // form under one agency clear another agency's backlog entry for the same page.
  if (attempt.answersDiscoveryId) {
    const target = log.attempts.find((a) => a.id === attempt.answersDiscoveryId);
    if (!target) {
      throw new Error(`answersDiscoveryId ${attempt.answersDiscoveryId} matches no recorded attempt`);
    }
    if (target.status !== 'discovery') {
      throw new Error(`${target.id} is a ${target.status} attempt; a judgement answers a discovery record`);
    }
    if (!attempt.renderId) {
      throw new Error('a record that answers another must cite the rendered evidence it rests on');
    }
    for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
      ['candidateSetVersion', 'round']]) {
      if (target[field] !== attempt[field]) {
        throw new Error(
          `${target.id} is ${label} ${JSON.stringify(target[field])}, but this judgement is ` +
            `${JSON.stringify(attempt[field])}; a judgement answers a record in its own round`
        );
      }
    }
    if (canonicalise(target.url) !== canonicalise(attempt.url)) {
      throw new Error(`${target.id} is ${target.url}, not ${attempt.url}`);
    }
  }

  if (attempt.rendersDiscoveryId) {
    const target = log.attempts.find((a) => a.id === attempt.rendersDiscoveryId);
    if (!target) {
      throw new Error(`rendersDiscoveryId ${attempt.rendersDiscoveryId} matches no recorded attempt`);
    }
    if (target.status !== 'discovery') {
      throw new Error(`${target.id} is a ${target.status} attempt; a render names a discovery record`);
    }
    if (canonicalise(target.url) !== canonicalise(attempt.url)) {
      throw new Error(
        `a render must be of the same page: ${target.id} is ${target.url}, this record is ` +
          `${attempt.url}`
      );
    }
    if (attempt.evidence !== 'rendered-dom') {
      throw new Error('only a rendered-dom record may name the plain-retrieval record it answers');
    }
  }

  // Amendment 54. Which conclusion this render may carry, decided by the status the RENDER
  // recorded. Checked after the lineage rules above, so that the more specific complaint about an
  // answered record's agency, round or page is the one an operator sees first: this rule is about
  // which CONCLUSION is permissible once the lineage itself is sound.
  const conclusionProblems = renderConclusionProblems(log, attempt);
  if (conclusionProblems.length) {
    throw new Error(`invalid capture attempt:\n  ${conclusionProblems.join('\n  ')}`);
  }

  // Amendment 57. The policy a reuse record names must be the one that governed it.
  const reuseProblems = policyReuseProblems(log, attempt);
  if (reuseProblems.length) {
    throw new Error(`invalid capture attempt:\n  ${reuseProblems.join('\n  ')}`);
  }

  // selection-v1.0.31. Only a CANDIDATE assessment is blocked by a prior candidate assessment. This
  // rule refuses a second judgement on one page, and a discovery record is not a judgement on a page
  // - so it was refusing exactly the two pages the corpus rests on: `www.tkm.govt.nz/contact/` and
  // `www.health.govt.nz/about-this-site/feedback` both have approved captures, and both were skipped
  // by the retrospective render pass because of this branch. The pages most worth re-examining were
  // the only two that could not be.
  const priorForUrl = attempt.status === 'discovery' ? [] : log.attempts.filter(
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
  // Amendment 41. An exclusion written from a retrieval names that retrieval STRUCTURALLY, and the
  // link is verified rather than trusted. `c-0504` superseded its own evidence, which erased the
  // retrieval from the active record and left the exclusion resting on nothing a reader could
  // check. The citation is a separate field from supersession because they say different things:
  // supersession withdraws a decision, citation points at evidence that stays.
  if (attempt.evidenceFromAttemptId) {
    const source = log.attempts.find((a) => a.id === attempt.evidenceFromAttemptId);
    if (!source) {
      throw new Error(`evidenceFromAttemptId names ${attempt.evidenceFromAttemptId}, which is not a recorded attempt`);
    }
    if (source.status !== 'retrieved') {
      throw new Error(
        `${source.id} is a ${source.status} attempt; evidenceFromAttemptId cites an ` +
          'assessment-only retrieval'
      );
    }
    if (source.agency !== attempt.agency) {
      throw new Error(`${source.id} is ${source.agency}, not ${attempt.agency}`);
    }
    if (source.category !== attempt.category) {
      throw new Error(`${source.id} is category ${source.category}, not ${attempt.category}`);
    }
    // Amendment 53. One retrieval may settle two locked candidates when a RECORDED redirect proves
    // they are one page - and only then.
    //
    // `https://teara.govt.nz/contact-us` and `https://teara.govt.nz/en/contact-us` were both locked,
    // because the bound is applied to URLs nobody has requested yet and the canonicaliser keeps them
    // distinct. Requesting the first returned HTTP 301 to the second and served a page whose own
    // `<link rel="canonical">` names the second, so they are one page - but this guard demanded the
    // citation's URL equal the retrieval's requested URL, which left the second candidate with no
    // way to be settled except a second request for a page already held.
    //
    // The exception is narrow by construction: it reads only what the retrieval RECORDED, so a
    // citation cannot assert an equivalence the evidence does not contain.
    if (canonicalise(source.url) !== canonicalise(attempt.url)) {
      const problems = redirectEquivalenceProblems(log, {
        source, decisionUrl: attempt.url, agency: attempt.agency, category: attempt.category,
        candidateSetVersion: attempt.candidateSetVersion ?? source.candidateSetVersion,
      });
      if (problems.length) {
        throw new Error(
          `${source.id} is ${source.url}, not ${attempt.url}, and no recorded redirect makes them ` +
            `one page:\n  ${problems.join('\n  ')}`
        );
      }
    }
    // The retrieval must still be active evidence. A supersession CLAIM from a record that has
    // itself been superseded does not keep the evidence withdrawn - otherwise `c-0504`, rejected
    // and replaced, would go on hiding `c-0503` from the record that cites it - but a live
    // supersession does, and citing withdrawn evidence must fail.
    // This attempt is not in the log yet, so a record IT supersedes does not read as superseded.
    // Counting its own supersession is what makes the repair expressible in one record.
    const activeSupersession = log.attempts.find(
      (a) => a.supersedesAttemptId === source.id &&
        a.id !== attempt.supersedesAttemptId && !isSuperseded(log, a)
    );
    if (activeSupersession) {
      throw new Error(
        `${source.id} has been superseded by ${activeSupersession.id} and is no longer active ` +
          'evidence; it cannot be cited'
      );
    }
    // The bytes themselves, by length and digest. A citation that matched only on ids would still
    // let the evidence be swapped underneath it.
    for (const [field, label] of [['htmlSha256', 'digest'], ['htmlBytes', 'byte length']]) {
      if (attempt[field] !== undefined && attempt[field] !== source[field]) {
        throw new Error(
          `this attempt records ${label} ${JSON.stringify(attempt[field])} but cites ${source.id}, ` +
            `whose ${label} is ${JSON.stringify(source[field])}`
        );
      }
    }
  }
  // Amendment 44. The tie-break claim is checked against the log, not taken on trust.
  if (attempt.notSelectedInFavourOf) {
    const selected = log.attempts.find((a) => a.id === attempt.notSelectedInFavourOf);
    if (!selected) {
      throw new Error(`notSelectedInFavourOf names ${attempt.notSelectedInFavourOf}, which is not a recorded attempt`);
    }
    if (selected.status !== 'captured') {
      throw new Error(
        `${selected.id} is a ${selected.status} attempt; notSelectedInFavourOf must name the ` +
          'CAPTURED candidate that was selected'
      );
    }
    for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
      ['candidateSetVersion', 'round']]) {
      if (selected[field] !== attempt[field]) {
        throw new Error(
          `${selected.id} is ${label} ${JSON.stringify(selected[field])}, not ` +
            `${JSON.stringify(attempt[field])}; the selection must come from the same locked set`
        );
      }
    }
    const set = log.candidateSets?.[setKey(attempt.agency, attempt.category)];
    const locked = set?.locked ?? [];
    const mine = canonicalise(attempt.url);
    const theirs = canonicalise(selected.url);
    for (const [url, who] of [[mine, 'this candidate'], [theirs, 'the selected candidate']]) {
      if (!locked.includes(url)) {
        throw new Error(`${who} (${url}) is not in the locked set for ${attempt.agency} / ${attempt.category}`);
      }
    }
    // The frozen tie-break takes the alphabetically first eligible canonical URL, so a candidate
    // that sorts BEFORE the selection cannot have lost to it.
    if (!(theirs < mine)) {
      throw new Error(
        `${selected.id} (${theirs}) does not sort before this candidate (${mine}); the frozen ` +
          'tie-break takes the alphabetically first eligible canonical URL, so this record would ' +
          'claim a selection the rule did not make'
      );
    }
  }
  if (attempt.supersedesAttemptId) {
    // Amendment 62. The same two checks the pre-request gate runs, from one implementation.
    const identity = supersedesTargetProblem(log, attempt);
    if (identity) throw new Error(identity);
    const target = log.attempts.find((a) => a.id === attempt.supersedesAttemptId);
    // Amendment 40. A retrieval is not a decision, so there is nothing to reject before resolving
    // it. Its whole purpose is to be read and then settled - excluded from, or promoted - and
    // requiring a rejection first would mean recording a verdict on the page in order to be allowed
    // to record the verdict on the page.
    // Amendment 41. Superseding the evidence you rest on withdraws it from the active record: the
    // exclusion then cites nothing checkable. `c-0504` did exactly that to `c-0503`.
    if (attempt.evidenceFromAttemptId && attempt.supersedesAttemptId === attempt.evidenceFromAttemptId) {
      throw new Error(
        `this attempt cites ${attempt.evidenceFromAttemptId} as its evidence and also supersedes it. ` +
          'A retrieval that is superseded is no longer active evidence; cite it and supersede the ' +
          'decision it replaces instead.'
      );
    }
    if (target.status !== 'retrieved' && target.approval !== APPROVAL.REJECTED) {
      throw new Error(
        `attempt ${target.id} is ${target.approval}, not rejected; only a rejected decision ` +
          'is corrected by superseding it'
      );
    }
    if (isSuperseded(log, target)) {
      throw new Error(`attempt ${target.id} has already been superseded`);
    }
  } else if (attempt.evidenceFromAttemptId) {
    // Amendment 41. A decision written FROM a retrieval of the same page is the second record for
    // that URL by design, and it does not supersede the retrieval - the evidence stays active so
    // the decision can be checked against it. The citation is verified above on agency, category,
    // canonical URL and bytes, which is a stronger test than the duplicate rule performs.
  } else if (attempt.promotedFrom) {
    // Amendment 40. A promotion is the same candidate, the same URL and the same bytes; the
    // duplicate-URL rule exists to stop one page being counted twice, and a promotion counts once.
    // `promotedFrom` is validated above against a real retrieval of this page.
  } else {
    // Amendment 62. ONE implementation of this rule, called here and before the request.
    const problem = duplicateUrlProblem(log, attempt);
    if (problem) throw new Error(problem);
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
  //
  // Amendment 43. A PROMOTION is exempt, because it makes no request: it re-hashes bytes already
  // held and records the decision about them. It also inherits the retrieval's `navigatedAt`, which
  // is when those bytes were actually fetched, so as soon as any later page is retrieved the
  // interval goes NEGATIVE and the promotion is refused - which is what happened to `c-0643` after
  // the other four candidates were retrieved. Pacing is an obligation on traffic; a record that
  // generates none cannot breach it, and holding it to the rule would make the frozen tie-break
  // unexecutable whenever the selected page is not the last one fetched.
  const at = Date.parse(attempt.navigatedAt ?? attempt.capturedAt ?? '');
  const previous = lastNavigation(log);
  // Amendment 64. A record written FROM a retained fetch is exempt for the same reason a promotion
  // is: it generates no traffic. The obligation belongs to the fetch, where it can be honoured by
  // waiting rather than discovered afterwards, and `lastNavigation` now counts fetches so the
  // fetch itself constrains whatever is requested next.
  const generatesNoTraffic = attempt.promotedFrom || attempt.fetchId;
  if (!generatesNoTraffic && !Number.isNaN(at) && previous !== null) {
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
    const budget = remainingBudget(log.attempts, {
      agency: attempt.agency, category: attempt.category, url: attempt.url,
    });
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

  // Amendment 39. A round may not be locked while evidence it retrieved sits unread.
  const unjudged = unjudgedRenderedObservations(log, {
    agency, category, candidateSetVersion: set.version,
  });
  if (unjudged.length) {
    throw new Error(
      `this round has rendered evidence that was never judged:\n  ${unjudged.join('\n  ')}`
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
    // Amendment 39, checked again here for the same reason the round agreement is: a set that
    // reached approval by any route not passing through `lockCandidateSet` would otherwise be
    // approved over unread evidence.
    const unread = unjudgedRenderedObservations(log, {
      agency: set.agency, category: set.category, candidateSetVersion: set.version,
    });
    if (unread.length) {
      throw new Error(
        `this set rests on rendered evidence that was never judged:\n  ${unread.join('\n  ')}`
      );
    }
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
/**
 * How an agency left the scan without contributing a page. Two outcomes, not one.
 *
 * selection-v1.0.23. `EXHAUSTION_REASON` was a single frozen string asserting that all four
 * categories "were searched". For the New Zealand Security Intelligence Service that would have
 * been false: two of its three websites answer every request with an Imperva/Incapsula challenge,
 * so those categories were ATTEMPTED, not searched. Recording it under the searched-in-full reason
 * would have put a completed search into the denominator of every prevalence figure on the
 * strength of requests that returned no agency content - the same collapse that made
 * `no-candidates` wrong for the individual records, one level up.
 *
 * The distinction is derived from the bound evidence and cannot be typed by an operator. A reason
 * an operator can choose is a reason an operator can choose wrongly, and this one decides what the
 * denominator means.
 */
/**
 * selection-v1.0.24. `searched-in-full` was itself an overclaim, and so was the prose defending
 * it. The procedure is BOUNDED: five candidates per category, twenty per agency, four methods, and
 * a robots-disallowed URL is deliberately never retrieved. "Searched in full" says an agency's web
 * presence was exhaustively examined. What was actually completed is a fixed procedure.
 *
 * The robots case is the clearest illustration. Respecting a `Disallow` is part of the planned
 * boundary, so it is not attrition - but what was read there is the robots POLICY, not the target
 * page. Amendment 27 said "both were read" of a 404 and a Disallow; only the first is true.
 */
export const AGENCY_RESOLUTIONS = Object.freeze({
  /** The frozen bounded procedure ran to completion and located no eligible form. */
  BOUNDED_DISCOVERY_COMPLETE: 'bounded-discovery-complete',
  /** Technical barriers stopped the procedure completing, and no eligible form was located. */
  TECHNICAL_ATTRITION: 'technical-discovery-attrition',
});

export const BOUNDED_COMPLETE_REASON =
  'the frozen bounded discovery procedure was completed for all four categories in the priority ' +
  'order, and no eligible form was located';

export const ATTRITION_REASON =
  'technical retrieval barriers prevented the frozen bounded discovery procedure from completing, ' +
  'and no eligible form was located';

/** The one frozen reason each resolution may carry. Nothing else seals. */
export const RESOLUTION_REASONS = Object.freeze({
  [AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE]: BOUNDED_COMPLETE_REASON,
  [AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION]: ATTRITION_REASON,
});

/**
 * The reason strings this scan has used for a completed bounded search, newest first.
 *
 * An exhaustion recorded under an earlier protocol carries the wording frozen then. It is NOT
 * silently accepted as current: `agencyResolutions` reports it as needing re-resolution, and the
 * seal refuses it, so the old wording cannot reach a manifest. This list exists only so the
 * machinery can recognise such a record and say what it is, rather than failing obscurely.
 */
export const SUPERSEDED_COMPLETE_REASONS = Object.freeze([
  'all four categories in the frozen priority order were searched and none yielded an eligible form',
]);

export const SUPERSEDED_ATTRITION_REASONS = Object.freeze([
  'all four categories in the frozen priority order were attempted, but technical retrieval ' +
    'barriers prevented complete discovery and no eligible form was located',
]);

/**
 * Amendment 54. Which conclusion a render may carry, decided by the status the RENDER recorded.
 *
 * `https://www.sia.govt.nz/search/SearchForm?Search=register` returned HTTP 500 - the agency's own
 * themed error page, byte-identical for both terms, while the home page returned 200. The render
 * happened; the SEARCH did not. Judging that page `no-candidates` would assert the search found no
 * registration form, which is the overclaim this study already recorded as a deviation.
 *
 * The rule runs in BOTH directions, and that is the point. A served page must be judged on its
 * content and may not be dismissed as inconclusive - otherwise an inconvenient page could be
 * waved away as a technical failure. A page the server did not serve must be recorded as
 * inconclusive and may not be read for candidates - otherwise an error page's own navigation
 * becomes evidence about forms, which is exactly how a themed 500 could smuggle a site's whole
 * menu into a candidate set.
 *
 * The status is read from the render registry. A conclusion cannot state its own status, because
 * then the record being checked would supply the fact that decides whether it is allowed.
 *
 * Scoped per render PER CATEGORY AND ROUND, not per render: one render of a home page legitimately
 * answers several categories' rounds, and ten active judgements in this log cite an observation
 * from a different category for exactly that reason.
 */
export function renderConclusionProblems(log, attempt) {
  const KINDS = [RECORD_TYPES.JUDGEMENT_ONLY, RECORD_TYPES.TECHNICAL_CONCLUSION];
  if (!KINDS.includes(attempt?.recordType)) return [];
  const problems = [];
  const attempts = log?.attempts ?? [];
  const technical = attempt.recordType === RECORD_TYPES.TECHNICAL_CONCLUSION;

  // The citation identity is enforced on a TECHNICAL CONCLUSION, which is about one retrieval of
  // one page in one round. It is deliberately NOT imposed on content judgements: `d-0309` answers
  // `d-0306`, a plain-retrieval record from before renders existed, and `d-0688` cites a record
  // the Amendment 48 chain superseded. Both are legitimate history, and the render ledger already
  // validates their lineage. What DOES apply to every conclusion is the status rule below - the
  // thing this amendment is for - and the one-conclusion-per-scope rule.
  const obs = attempts.find((a) => a.id === attempt.evidenceFromDiscoveryId);
  if (technical) {
    if (!obs) {
      return [`cites ${JSON.stringify(attempt.evidenceFromDiscoveryId)}, which is not a recorded attempt`];
    }
    if (isDiscoverySuperseded(log, obs.id) && obs.id !== attempt.supersedesDiscoveryId) {
      problems.push(`${obs.id} has been superseded and is no longer the active observation`);
    }
    if (obs.outcome !== 'rendered') {
      problems.push(`${obs.id} records ${JSON.stringify(obs.outcome)}, not a render`);
    }
    // The EXACT render: the one that observation registered, not merely a render of the same page.
    if (!attempt.renderId) problems.push('names no render');
    else if (obs.renderId !== attempt.renderId) {
      problems.push(`${obs.id} registered ${obs.renderId}, not ${attempt.renderId}`);
    }
    if (obs.agency !== attempt.agency) problems.push(`${obs.id} is ${obs.agency}, not ${attempt.agency}`);
    if (obs.category !== attempt.category) {
      problems.push(`${obs.id} is category ${obs.category}, not ${attempt.category}`);
    }
    if (obs.candidateSetVersion !== attempt.candidateSetVersion) {
      problems.push(
        `${obs.id} is round ${obs.candidateSetVersion}, not ${attempt.candidateSetVersion}`
      );
    }
    if (canonicalise(obs.url) !== canonicalise(attempt.url)) {
      problems.push(`${obs.id} is ${obs.url}, not ${attempt.url}`);
    }
  }

  const render = (log?.renders ?? []).find((r) => r.id === attempt.renderId);
  if (!render) {
    if (attempt.renderId) problems.push(`${attempt.renderId} is not in the render registry`);
  } else {
    const status = render.httpStatus;
    if (!isUsableStatus(status)) {
      // Fail closed. "No usable status" must not read as "served": a missing or hand-edited status
      // is the one input that would otherwise choose the rule that suits it.
      problems.push(
        `${render.id} records httpStatus ${JSON.stringify(status)}, which is not a usable status; ` +
          'no conclusion can be drawn about a render whose status is unknown'
      );
    } else if (isServedStatus(status)) {
      if (!JUDGEMENT_OUTCOMES.includes(attempt.outcome)) {
        problems.push(
          `${render.id} was served (HTTP ${status}), so it must be judged on its content ` +
            `(${JUDGEMENT_OUTCOMES.join(' or ')}), not recorded as ` +
            JSON.stringify(attempt.outcome)
        );
      }
    } else if (attempt.outcome !== TECHNICAL_CONCLUSION_OUTCOME) {
      problems.push(
        `${render.id} was NOT served (HTTP ${status}), so nothing on it bears on candidates; it ` +
          `must be recorded as ${TECHNICAL_CONCLUSION_OUTCOME}, not ` +
          JSON.stringify(attempt.outcome)
      );
    }
  }

  // One active conclusion per render per category and round.
  const rival = attempts.find(
    (a) => a.id !== attempt.id && KINDS.includes(a.recordType) &&
      a.renderId === attempt.renderId && a.category === attempt.category &&
      a.candidateSetVersion === attempt.candidateSetVersion &&
      a.id !== attempt.supersedesDiscoveryId && !isDiscoverySuperseded(log, a.id)
  );
  if (rival) {
    problems.push(
      `${rival.id} is already the active conclusion for ${attempt.renderId} in ` +
        `${attempt.category} v${attempt.candidateSetVersion}`
    );
  }
  return problems;
}

/** Every active conclusion in the log, re-checked. Read by the corpus gate. */
export function renderConclusionAudit(log) {
  const problems = [];
  const KINDS = [RECORD_TYPES.JUDGEMENT_ONLY, RECORD_TYPES.TECHNICAL_CONCLUSION];
  for (const a of log.attempts ?? []) {
    if (!KINDS.includes(a.recordType) || isDiscoverySuperseded(log, a.id)) continue;
    for (const p of renderConclusionProblems(log, a)) problems.push(`${a.id}: ${p}`);
  }
  return problems;
}

/**
 * Amendment 53. Does a recorded redirect make a retrieval's page the same page as a decision's URL?
 *
 * Returns the reasons it does NOT, so an empty list is the only thing that permits the citation.
 * Everything it checks is a field the retrieval already recorded: the chain Chromium actually
 * followed, each hop's robots verdict as evaluated at the time, and the final URL reached. Nothing
 * is inferred from the shape of the URLs, because that is exactly the assumption this project
 * refused when the same two Te Ara URLs were deduplicated on the premise that they looked alike.
 *
 * The permission is also bounded to the round's own locked candidates. A retrieval may stand in for
 * another URL only when BOTH are URLs this set undertook to assess - so the rule can settle a
 * duplicate the bound admitted, and can never reach a page the set never locked.
 *
 * No permit and no navigation timestamp is copied: the citation points at the retrieval, which
 * keeps its own. Two decisions resting on one retrieval of one page is the intended outcome; two
 * records claiming one REQUEST of two pages remains impossible.
 */
export function redirectEquivalenceProblems(
  log, { source, decisionUrl, agency, category, candidateSetVersion } = {}
) {
  const problems = [];
  const want = canonicalise(decisionUrl);
  // Same URL needs no equivalence; the ordinary citation rules cover it.
  if (canonicalise(source?.url) === want) return problems;

  if (!source) return ['there is no evidence source to check'];
  if (source.status !== 'retrieved') {
    problems.push(`${source.id} is a ${source.status} attempt, not an assessment-only retrieval`);
  }
  if (source.agency !== agency) problems.push(`${source.id} is ${source.agency}, not ${agency}`);
  if (source.category !== category) {
    problems.push(`${source.id} is category ${source.category}, not ${category}`);
  }
  // The same ROUND. Evidence from an earlier or superseded round describes a different sample.
  if (candidateSetVersion !== undefined &&
      source.candidateSetVersion !== undefined &&
      source.candidateSetVersion !== candidateSetVersion) {
    problems.push(
      `${source.id} belongs to round ${source.candidateSetVersion}, not ${candidateSetVersion}`
    );
  }

  // Both ends must be URLs this set undertook to assess.
  const set = log?.candidateSets?.[setKey(agency, category)];
  const locked = (set?.locked ?? []).map((u) => canonicalise(u));
  if (!locked.includes(canonicalise(source.url))) {
    problems.push(`${source.url} is not a locked candidate of this set`);
  }
  if (!locked.includes(want)) problems.push(`${decisionUrl} is not a locked candidate of this set`);

  // The chain, exactly as recorded: continuous, starting where the request started, ending at the
  // URL being decided, every hop allowed when it was followed.
  const chain = Array.isArray(source.redirectChain) ? source.redirectChain : [];
  if (chain.length === 0) {
    problems.push(`${source.id} records no redirect chain, so nothing links the two URLs`);
  } else {
    if (canonicalise(chain[0].from) !== canonicalise(source.url)) {
      problems.push(`the chain starts at ${chain[0].from}, not at ${source.url}`);
    }
    if (canonicalise(chain[chain.length - 1].to) !== want) {
      problems.push(`the chain ends at ${chain[chain.length - 1].to}, not at ${decisionUrl}`);
    }
    for (let i = 1; i < chain.length; i++) {
      if (canonicalise(chain[i].from) !== canonicalise(chain[i - 1].to)) {
        problems.push(
          `the chain breaks at hop ${i + 1}: ${chain[i - 1].to} then ${chain[i].from}`
        );
      }
    }
    for (const [i, hop] of chain.entries()) {
      if (hop.allowed !== true) {
        problems.push(`hop ${i + 1} to ${hop.to} is not recorded as allowed`);
      }
    }
  }

  // And the page actually reached must BE the page being decided. This is the check an invented
  // `finalUrl` has to pass, so it is made against the recorded value and nothing else.
  if (!source.finalUrl) {
    problems.push(`${source.id} records no finalUrl`);
  } else if (canonicalise(source.finalUrl) !== want) {
    problems.push(
      `${source.id} finally reached ${source.finalUrl}, which is not ${decisionUrl}`
    );
  }
  return problems;
}

/**
 * Every citation in the log whose URL differs from its evidence, re-checked. Read by the corpus
 * gate, so a record written before this rule - or one whose set changed underneath it - cannot
 * sit in a sealed corpus unexamined.
 */
export function redirectEquivalenceAudit(log) {
  const problems = [];
  for (const a of log.attempts ?? []) {
    if (!a.evidenceFromAttemptId || isSuperseded(log, a)) continue;
    const source = (log.attempts ?? []).find((x) => x.id === a.evidenceFromAttemptId);
    if (!source || canonicalise(source.url) === canonicalise(a.url)) continue;
    const found = redirectEquivalenceProblems(log, {
      source, decisionUrl: a.url, agency: a.agency, category: a.category,
      candidateSetVersion: a.candidateSetVersion ?? source.candidateSetVersion,
    });
    for (const p of found) problems.push(`${a.id} cites ${source.id}: ${p}`);
  }
  return problems;
}

/**
 * Which resolution the evidence supports, and the records that support it.
 *
 * Reads the discovery records BOUND to the agency's four locked sets, excluding superseded ones: a
 * withdrawn finding is not evidence, and a record that no set claims is not part of the round the
 * exhaustion rests on. One bound active record of UNRESOLVED attrition is enough - an agency with
 * a page nobody read was not searched in full, and the honest resolution is the weaker of the
 * two. A barrier the headed fallback then cleared is not such a record: see Amendment 50 below.
 */
export function agencyResolution(log, agency) {
  const bound = new Set();
  for (const category of CATEGORY_ORDER) {
    const set = log.candidateSets?.[setKey(agency, category)];
    for (const id of set?.discoveryRecordIds ?? []) bound.add(id);
  }
  const records = log.attempts.filter(
    (a) => bound.has(a.id) && a.status === 'discovery' && !isDiscoverySuperseded(log, a.id)
  );
  const attrition = records.filter((a) => TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome));

  // Amendment 50. Only UNRESOLVED attrition downgrades the resolution.
  //
  // This read every attrition record, so a barrier the headed fallback cleared counted against the
  // agency: an agency whose every page was read - after a WAF barred the headless attempt and the
  // frozen fallback then read it - was labelled `technical-discovery-attrition`, which says its
  // search was incomplete. That is a claim about the SAMPLE, and it was false. The whole Ministry
  // for Culture and Heritage estate bars headless Chromium, so every one of its origins would have
  // produced that verdict while five of six were in fact read in full.
  const unresolvedIds = new Set(barrierAccounting(log, { agency }).unresolvedRecords);
  const unresolved = attrition.filter(
    (a) => a.outcome !== 'retrieval-blocked' || unresolvedIds.has(a.id)
  );
  const recovered = attrition.filter((a) => !unresolved.includes(a));
  const resolution = unresolved.length > 0
    ? AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION
    : AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE;
  const byOutcome = {};
  for (const a of unresolved) byOutcome[a.outcome] = (byOutcome[a.outcome] ?? 0) + 1;
  return {
    resolution,
    reason: RESOLUTION_REASONS[resolution],
    boundRecords: records.length,
    // The ids that DECIDE the resolution, and separately the barriers that cost nothing.
    attritionRecordIds: unresolved.map((a) => a.id).sort(),
    attritionByOutcome: byOutcome,
    recoveredBarrierIds: recovered.map((a) => a.id).sort(),
  };
}

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
      log.attempts.filter((a) => a.agency === target && isTerminalDecision(a)).map((a) => a.url)
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

  // selection-v1.0.23. Derived, never supplied. `exhaustAgency` takes no reason and no resolution
  // from its caller, and the CLI exposes no flag for either: the string an agency leaves under is
  // what its absence from the corpus MEANS, and a scan that lets the operator choose between
  // "searched" and "could not be searched" has no denominator worth publishing.
  const resolved = agencyResolution(log, target);
  // An exhaustion must rest on something. With no bound active record the derivation would return
  // `searched-in-full` by default - vacuously true, and the strongest of the two claims - so an
  // agency whose sets were locked before binding existed could be filed as conclusively searched on
  // no evidence whatever. The absence of attrition is only meaningful where there is evidence in
  // which attrition could have appeared.
  if (resolved.boundRecords === 0) {
    throw new Error(
      `${target} has no discovery records bound to its four sets, so nothing supports either ` +
        'resolution. An exhaustion says how an agency was searched; it cannot rest on no evidence.'
    );
  }
  if (resolved.resolution === AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION &&
      resolved.attritionRecordIds.length === 0) {
    throw new Error(
      `${target} resolves as ${AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION} but names no supporting ` +
        'record; the resolution and its evidence are written together or not at all'
    );
  }

  const record = {
    agency: target,
    exhaustedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    resolution: resolved.resolution,
    reason: resolved.reason,
    categorySetVersions,
    ...(resolved.resolution === AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION
      ? { attritionRecordIds: resolved.attritionRecordIds, attritionByOutcome: resolved.attritionByOutcome }
      : {}),
  };
  (log.exhausted ??= []).push(record);
  return record;
}

/**
 * The two resolutions, counted separately.
 *
 * A legacy record carries no `resolution`. It is read as `searched-in-full`, which is what it
 * asserted, and `resolutionDisagreements` reports any whose stored reason the evidence no longer
 * supports - so an old record cannot go on claiming a completed search after attrition records
 * have been bound into the agency's round.
 */
export function agencyResolutions(log) {
  const counts = { [AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE]: 0, [AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION]: 0 };
  const records = [];
  const disagreements = [];
  for (const raw of log.exhausted ?? []) {
    const agency = typeof raw === 'string' ? raw : raw?.agency;
    const stored = (typeof raw === 'string' ? null : raw?.resolution) ?? AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE;
    const storedReason = typeof raw === 'string' ? null : raw?.reason;
    counts[stored] = (counts[stored] ?? 0) + 1;
    records.push({ agency, resolution: stored, reason: storedReason });
    const derived = agencyResolution(log, agency).resolution;
    if (derived !== stored) {
      disagreements.push(
        `${agency} is recorded as ${stored} but its bound evidence supports ${derived}`
      );
    }
    // selection-v1.0.24. Wording frozen under an earlier protocol is not silently carried forward.
    // The Family Violence and Sexual Violence Executive Board was exhausted under a reason that
    // said all four categories "were searched" - a claim this protocol has withdrawn as an
    // overclaim. Leaving it in place would publish the withdrawn wording; accepting it as
    // equivalent to the new one would make the correction cosmetic. It must be re-resolved.
    if (storedReason !== null && storedReason !== RESOLUTION_REASONS[stored]) {
      const known = SUPERSEDED_COMPLETE_REASONS.includes(storedReason) ||
        SUPERSEDED_ATTRITION_REASONS.includes(storedReason);
      disagreements.push(
        `${agency} carries ${known ? 'wording frozen under an earlier protocol' : 'a reason that is not frozen'}` +
          `; run \`re-resolve\` so the record states the current one`
      );
    }
  }
  return { counts, records, disagreements };
}

/**
 * Re-records an agency's resolution under the protocol now in force, preserving the old record.
 *
 * selection-v1.0.24. Renaming a frozen reason strands every exhaustion already recorded: the seal
 * requires the reason frozen for the resolution, so an older record simply stops sealing. Editing
 * it in place would rewrite what was decided, and accepting the old wording would make the
 * correction cosmetic. So the prior record is archived with the reason it was superseded for, and a
 * freshly DERIVED one replaces it - derived, because a re-resolution is no more an occasion to type
 * a resolution than the first one was.
 */
export function reResolveExhaustion(log, { agency, reason }) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('re-resolving an exhaustion requires a reason for doing so, which is recorded');
  }
  const list = log.exhausted ?? [];
  const index = list.findIndex((e) => (typeof e === 'string' ? e : e?.agency) === agency);
  if (index === -1) throw new Error(`${agency} is not recorded as exhausted`);
  const previous = list[index];
  const resolved = agencyResolution(log, agency);
  if (resolved.boundRecords === 0) {
    throw new Error(
      `${agency} has no discovery records bound to its four sets, so nothing supports either ` +
        'resolution'
    );
  }
  const storedResolution = (typeof previous === 'string' ? null : previous?.resolution) ??
    AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE;
  const storedReason = typeof previous === 'string' ? null : previous?.reason;
  if (storedResolution === resolved.resolution && storedReason === resolved.reason) {
    throw new Error(
      `${agency} already states the current resolution and reason; there is nothing to re-resolve`
    );
  }

  (log.supersededExhaustions ??= []).push({
    ...(typeof previous === 'string' ? { agency: previous } : previous),
    supersededAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    supersededReason: reason,
  });
  const record = {
    agency,
    exhaustedAt: typeof previous === 'string' ? null : previous?.exhaustedAt ?? null,
    // The re-resolution is stamped separately, so the manifest still says when the agency was
    // actually searched rather than when its wording was corrected.
    reResolvedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    resolution: resolved.resolution,
    reason: resolved.reason,
    categorySetVersions: typeof previous === 'string' ? null : previous?.categorySetVersions ?? null,
    ...(resolved.resolution === AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION
      ? { attritionRecordIds: resolved.attritionRecordIds, attritionByOutcome: resolved.attritionByOutcome }
      : {}),
  };
  list[index] = record;
  return { record, previous };
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
    log.attempts.filter((a) => a.agency === agency && isTerminalDecision(a)).map((a) => a.url)
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
      // Amendment 38. The approval time and its stated reason, published with the row they
      // decide. `c-0441`'s inclusion evidence flagged a category question for review, and the
      // note that resolved it - citing the amendment that had already settled the classification
      // before capture - lived only in the ignored log. The tracked audit therefore carried the
      // doubt and not its answer, which reads worse than either alone.
      a.approvedAt ?? '',
      a.approvalNote ?? '',
      // Amendment 42. The evidence provenance, rendered from the VERIFIED structured fields rather
      // than restated in prose. `c-0576` asserted a digest in its free-text reason that nobody had
      // read - the record's own `htmlSha256` was correct and the citation check had verified it, but
      // the prose was a second, unchecked source of truth for the same fact. One source, and it is
      // the one the machinery checks.
      a.htmlBytes ?? '',
      a.evidenceFromAttemptId ?? '',
      // Amendment 44. Which capture won the tie-break, published so an eligible-but-not-selected
      // outcome can be verified from the ledger instead of read out of its prose.
      a.notSelectedInFavourOf ?? '',
      a.promotedFrom ?? '',
      a.supersedesAttemptId ?? '',
    ]
      .map((v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',')
  );
  const header = LEDGER_HEADER.trimEnd() +
    ',approval,approvedAt,approvalNote,htmlBytes,evidenceFromAttemptId,notSelectedInFavourOf,promotedFrom,supersedesAttemptId\n';
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
        log.attempts.filter((a) => a.agency === agency && isTerminalDecision(a)).map((a) => a.url)
      );
      return (set.locked ?? []).every((u) => decided.has(u));
    });
    if (settled) out.push(agency);
  }
  return out;
}

export function deriveDraft(log, { frameSha256, drawOrderSha256, selectionLedgerFile = 'selection-ledger.csv', synthetic = false, frameAgencies = null, capturesRoot = null }) {
  // selection-v1.0.17: one shared list, read by `status` too, so a gate and its report cannot
  // disagree about the same log.
  const blockers = corpusBlockers(log, { capturesRoot });
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
    // selection-v1.0.23. Every record carries an explicit `resolution`. A legacy record has none
    // and is normalised to `searched-in-full`, which is precisely what it asserted; the gate above
    // refuses the draft if that claim no longer matches the agency's bound evidence, so the
    // normalisation cannot quietly promote an attrition round into a completed search.
    exhaustedAgencies: (log.exhausted ?? []).map((e) =>
      typeof e === 'string'
        ? {
            agency: e, exhaustedAt: null, resolution: AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE,
            reason: BOUNDED_COMPLETE_REASON, categorySetVersions: null,
          }
        : { ...e, resolution: e.resolution ?? AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE }
    ),
    supersededExhaustions: (log.supersededExhaustions ?? []).map((e) => ({ ...e })),
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
export function publishProvenance(log, { to, capturesRoot = null }) {
  const ledgerProblems = checkPermitLedger(log);
  if (ledgerProblems.length) {
    throw new Error(
      `the permit ledger is inconsistent and must not be published:\n  ${ledgerProblems.join('\n  ')}`
    );
  }
  // Rendered evidence is verified before its hashes are published. Publishing a digest for a file
  // nobody re-read would put a checkable-looking claim into the audit that had never been checked.
  if ((log.renders ?? []).length > 0) {
    if (!capturesRoot) {
      throw new Error('publishing provenance for a log with renders requires the capture root, so the evidence can be verified');
    }
    const renderProblems = checkRenderLedger(log, join(resolve(capturesRoot), RENDERED_DIR));
    if (renderProblems.length) {
      throw new Error(
        `rendered evidence does not match the log and must not be published:\n  ${renderProblems.join('\n  ')}`
      );
    }
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
      // capture-v1.0.7. `capture-blocked` was omitted here, so the published counts did not add
      // up to the attempts they came from and a page the harness could not retrieve appeared in
      // no column at all. An outcome that exists in the log and nowhere in the audit is an
      // outcome a reader cannot know happened.
      captureBlocked: candidates.filter((a) => a.status === 'capture-blocked').length,
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
      typeof e === 'string'
        ? { agency: e, exhaustedAt: null, resolution: AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE, reason: BOUNDED_COMPLETE_REASON }
        : { ...e, resolution: e.resolution ?? AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE }
    ),
    // selection-v1.0.23. Counted apart, never summed into one "agencies searched" figure. An
    // agency whose discovery was blocked is not evidence that it publishes no such form, and a
    // denominator that merges the two would overstate how much of the frame was actually read.
    agencyResolutions: (() => {
      const { counts, records, disagreements } = agencyResolutions(log);
      return {
        boundedDiscoveryComplete: counts[AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE] ?? 0,
        technicalDiscoveryAttrition: counts[AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION] ?? 0,
        byAgency: records,
        disagreements,
      };
    })(),
    // selection-v1.0.21. Attrition in the discovery METHOD, separated from findings about the
    // agencies. An origin that could not be read is not an agency that publishes no forms, and a
    // prevalence denominator that merges the two would overstate how much of the frame was
    // actually searched.
    //
    // Amendment 50. The block now says what it counts. `records` was the only figure here, and it
    // silently merged three different things: records withdrawn by a later correction, barriers the
    // headed fallback cleared, and attempts that genuinely went unread. A reader quoting it - as
    // 92, when 90 are active and only 40 of those cost coverage - would overstate the gap by more
    // than twice. The coverage reading itself is in `barriers` below; this is the record census.
    technicalAttrition: {
      records: discovery.filter((a) => TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome)).length,
      active: discovery.filter(
        (a) => TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome) && !isDiscoverySuperseded(log, a.id)
      ).length,
      superseded: discovery.filter(
        (a) => TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome) && isDiscoverySuperseded(log, a.id)
      ).length,
      // A census of records, including withdrawn ones. `activeByOutcome` is the one that
      // reconciles with `barriers`.
      byOutcome: discovery.reduce((acc, a) => {
        if (!TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome)) return acc;
        acc[a.outcome] = (acc[a.outcome] ?? 0) + 1;
        return acc;
      }, {}),
      activeByOutcome: discovery.reduce((acc, a) => {
        if (!TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome)) return acc;
        if (isDiscoverySuperseded(log, a.id)) return acc;
        acc[a.outcome] = (acc[a.outcome] ?? 0) + 1;
        return acc;
      }, {}),
      byOrigin: discovery.reduce((acc, a) => {
        if (!TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome)) return acc;
        let origin = '?';
        try { origin = new URL(a.url).origin; } catch { origin = '?'; }
        const key = `${a.agency} ${origin}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    // Amendment 55. The retained plain-read resources, sanitised. Never the body: a sitemap is a
    // third-party document, and the digest plus length is what makes the reading checkable.
    fetches: (log.fetches ?? []).map((f) => ({
      id: f.id, url: f.url, fetchedAt: f.fetchedAt, httpStatus: f.httpStatus,
      contentType: f.contentType ?? null, fetchedBytes: f.fetchedBytes,
      fetchedSha256: f.fetchedSha256, fetchFile: f.fetchFile, permitId: f.permitId,
      locCount: f.locCount ?? null, rootElement: f.rootElement ?? null,
    })),
    // Amendment 50. Published alongside the raw outcome counts, because a count of blocked attempts
    // is not a coverage figure: half of this log's were recovered by the headed fallback. A reader
    // of the audit gets the four figures apart rather than having to infer them.
    barriers: barrierAccounting(log),
    // Deviations from the frozen protocol, published with the evidence they name so a reader does
    // not have to take the prose account on trust.
    deviations: (log.deviations ?? []).map((d) => ({ ...d })),
    // Amendment 38. The robots observations the permits rest on. Every request in this scan is
    // authorised by one of these, and `r-0029` - the 404 that permitted the NZSIS capture - was
    // reachable only as prose inside another record's evidence text. A permission nobody can look
    // up is a permission a reader has to take on trust.
    //
    // Sanitised deliberately. `body` is never published: it is a third-party document, and for a
    // valid text/plain robots file `representation.text` holds that same body a second time. The
    // representation is rebuilt field by field rather than spread, so a future field on the
    // classifier cannot silently start publishing content.
    robotsChecks: (log.robotsChecks ?? []).map((c) => ({
      id: c.id, origin: c.origin ?? null, url: c.url ?? null, fetchedAt: c.fetchedAt ?? null,
      httpStatus: c.httpStatus ?? null, disposition: c.disposition ?? null,
      contentType: c.contentType ?? null, bytes: c.bytes ?? null, sha256: c.sha256 ?? null,
      representation: c.representation
        ? {
            valid: c.representation.valid ?? null,
            reason: c.representation.reason ?? null,
            mediaType: c.representation.mediaType ?? null,
            charset: c.representation.charset ?? null,
            challenge: c.representation.challenge ?? null,
          }
        : null,
    })),
    // The render registry: provenance and digests only. The rendered markup is third-party content
    // and stays in the ignored data tree; nothing here reproduces any of it.
    renders: (log.renders ?? []).map((r) => ({
      id: r.id, url: r.url, finalUrl: r.finalUrl ?? null, navigatedAt: r.navigatedAt,
      permitId: r.permitId ?? null, httpStatus: r.httpStatus ?? null, loadState: r.loadState ?? null,
      renderFile: r.renderFile, renderedSha256: r.renderedSha256, renderedBytes: r.renderedBytes,
      domNodes: r.domNodes ?? null, linkCount: r.linkCount ?? null, formCount: r.formCount ?? null,
      controlCount: r.controlCount ?? null, buttonCount: r.buttonCount ?? null,
      accessBarriers: r.accessBarriers ?? [], submissionProtection: r.submissionProtection ?? [],
      browser: r.browser ?? null, browserMode: r.browserMode ?? null, settleMs: r.settleMs ?? null,
    })),
    renderBacklog: {
      records: renderBacklog(log).length,
      urls: renderBacklogByUrl(log).length,
    },
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
      // Amendment 38. Superseded sets published their approval note from the start; active ones
      // did not, so the reasoning behind a set still in force was the only version a reader
      // could not see.
      approvalNote: set.approvalNote ?? null,
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

  // capture-v1.0.6: a hard failure, not a held draft. An orphaned capture file means the
  // directory contains something the log does not account for.
  const fileProblems = checkCaptureFiles(log, capturesDir);
  if (fileProblems.length) {
    throw new Error(`the captures directory does not match the log:\n  ${fileProblems.join('\n  ')}`);
  }
  let draftPath = null;
  try {
    const draft = deriveDraft(log, { frameSha256, drawOrderSha256, synthetic, capturesRoot: root });
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

/**
 * Would this permit authorise this request? Checked BEFORE the browser opens.
 *
 * selection-v1.0.25. `render-discovery` consumed its permit after the render, so an expired, closed
 * or mismatched permit was discovered only once the request had already been made - which makes the
 * permit a comment on the traffic rather than a precondition of it, the exact defect the permit
 * model was introduced to fix.
 */
export function assertPermitUsable(log, { agency, category, candidateSetVersion, url, permitId }) {
  const permit = (log.discoveryPermits ?? []).find((p) => p.id === permitId);
  if (!permit) throw new Error(`permit ${permitId} does not exist`);
  if (permit.consumedAt) throw new Error(`permit ${permitId} was already consumed at ${permit.consumedAt}`);
  if (permit.closedAt) throw new Error(`permit ${permitId} was closed at ${permit.closedAt} as ${permit.disposition}`);
  if (permit.agency !== agency || permit.category !== category ||
      permit.candidateSetVersion !== candidateSetVersion || permit.url !== url) {
    throw new Error(
      `permit ${permitId} is for ${permit.agency} / ${permit.category} round ` +
        `${permit.candidateSetVersion} ${permit.url}, not this request`
    );
  }
  const issued = Date.parse(permit.issuedAt);
  if (Number.isNaN(issued)) throw new Error(`permit ${permitId} has no usable issuedAt`);
  if (Date.now() - issued > PERMIT_TTL_MS) {
    throw new Error(
      `permit ${permitId} was issued at ${permit.issuedAt} and has expired; re-run ` +
        '`preflight-discovery` before making the request'
    );
  }
  if (issued > Date.now()) {
    throw new Error(`permit ${permitId} is stamped ${permit.issuedAt}, which is in the future`);
  }
  const check = (log.robotsChecks ?? []).find((c) => c.id === permit.robotsCheckId);
  if (!check) throw new Error(`permit ${permitId} names robots check ${permit.robotsCheckId}, which does not exist`);
  const fetched = Date.parse(check.fetchedAt ?? '');
  if (Number.isNaN(fetched)) throw new Error(`robots check ${check.id} has no usable fetchedAt`);
  if (fetched > Date.now()) {
    throw new Error(`robots check ${check.id} is stamped ${check.fetchedAt}, which is in the future`);
  }
  if (!robotsCheckIsFresh(check)) {
    throw new Error(
      `the robots policy behind permit ${permitId} was fetched at ${check.fetchedAt}, more than 24 ` +
        'hours ago; RFC 9309 section 2.4 does not support relying on it'
    );
  }
  // selection-v1.0.26. The policy must be THIS origin's, and must still permit THIS exact path. The
  // check verified only that a policy existed and was fresh, so a permit could rest on another
  // origin's robots file, or on one that had been re-read since and now disallowed the path.
  let parsed = null;
  try { parsed = new URL(url); } catch { throw new Error(`${url} is not a usable URL`); }
  if (check.origin !== parsed.origin) {
    throw new Error(
      `permit ${permitId} rests on the robots policy for ${check.origin}, but the request is to ` +
        `${parsed.origin}`
    );
  }
  const verdict = evaluatePolicy(check, parsed.pathname + parsed.search, 'chromium');
  if (!verdict.allowed) {
    throw new Error(
      `the robots policy for ${parsed.origin} does not permit ${parsed.pathname}${parsed.search}: ` +
        verdict.reason
    );
  }
  return permit;
}

export function consumeDiscoveryPermit(log, { agency, category, candidateSetVersion, url, navigatedAt = null, permitId = null, consumedAt = null }) {
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
  //
  // selection-v1.0.21. The life of a permit governs the NAVIGATION, not the bookkeeping. The
  // previous rule also required the record to be written within the hour, which made nine real
  // navigations - each made seconds after its own permit - impossible to write down once a day
  // had passed, and would have left them permanently unaccounted for. Writing a record late is a
  // disclosure problem, not an authorisation one, so it is disclosed: `permitAudit` derives
  // lateness from `consumedAt` against the recorded navigation time and reports it.
  const issued = Date.parse(permit.issuedAt);
  const now = Date.now();
  if (navigatedAt === null) {
    // Nothing says when the request happened, so consumption time is the only evidence of it and
    // the wall clock governs. This is the path that must stay strict: without a navigation time,
    // a stale permit consumed today is indistinguishable from one used when it was issued.
    if (now - issued > PERMIT_TTL_MS) {
      throw new Error(
        `permit ${permit.id} was issued at ${permit.issuedAt} and has expired. Re-run ` +
          '`preflight-discovery`, or name the navigation time with --navigated-at if the request ' +
          'was genuinely made while the permit was live: a stale permit cannot authorise a ' +
          'request made much later, because the policy may have changed in between.'
      );
    }
  } else {
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
    // A navigation dated after its own consumption is refused too - but by `checkPermitLedger`,
    // which already holds `consumedAt >= navigatedAt` and is run by every gate that matters:
    // `status`, `deriveDraft`, `publishProvenance` and every closure. Duplicating it here would
    // put the same rule in two places with two error messages, and the second copy is the one
    // that drifts.
  }

  // Amendment 67. The caller may supply the instant, so consumption and the request it authorises
  // carry the SAME timestamp. Every time in this log is written to second precision, so taking two
  // clock readings microseconds apart can still land them in different seconds and reinstate the
  // very chronology failure this amendment closes - from a race, not from a real ordering.
  permit.consumedAt = consumedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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
  /**
   * The request was made and the record of it could not be written.
   *
   * selection-v1.0.31. Two renders retrieved their page and then failed inside `appendAttempt`, so
   * the log was never written: the permit stayed open, the bytes stayed on disk, and the request had
   * unarguably happened. `unused` would assert no request was made and `duplicate-request` would
   * assert another record accounts for it; both are false. This says what occurred - real
   * authorised traffic that produced no observation - and names the quarantined bytes as its
   * evidence.
   */
  RECORDING_FAILED: 'recording-failed-after-request',
});

/**
 * Closes an open permit, with an explicit account of what happened under it.
 *
 * Deliberately not called "release": these permits were not unused. Two requests were made for
 * each URL and only one discovery judgement recorded, so calling the remainder released would
 * assert that no request occurred - the opposite of the truth. The two dispositions say which
 * it was, and `duplicate-request` must name the inspection that accounts for the traffic.
 */
export function closeDiscoveryPermit(log, { permitId, disposition, reason, accountedBy = null, quarantinedFile = null, navigationWindow = null }) {
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
  } else if (disposition === PERMIT_DISPOSITIONS.RECORDING_FAILED) {
    if (accountedBy) {
      throw new Error(`a ${disposition} closure names no discovery record: the record is what failed to be written`);
    }
    if (typeof quarantinedFile !== 'string' || quarantinedFile.trim() === '') {
      throw new Error(`a ${disposition} closure must name the quarantined bytes the request produced`);
    }
  } else if (accountedBy) {
    throw new Error('an unused closure names no discovery record: nothing was requested under it');
  }

  const closedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const closureId = `x-${String((log.discoveryPermits ?? []).filter((p) => p.closedAt).length + 1).padStart(4, '0')}`;
  Object.assign(permit, {
    closedAt, disposition, closureReason: reason, accountedBy, closureId,
    ...(quarantinedFile ? { quarantinedFile } : {}),
    // selection-v1.0.31: a WINDOW, not an invented instant. The exact navigation time was lost with
    // the record that failed to be written; what is known is that the request fell between the
    // permit's issuance and the moment its bytes were written to disk. Both ends are observations.
    ...(navigationWindow ? { navigationWindow } : {}),
  });

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

  // selection-v1.0.21. Records written long after the request they describe, DERIVED rather than
  // stored: a stored flag is a claim a writer can omit, whereas consumption time against the
  // navigation time it names cannot be omitted without breaking other checks. Lateness is not a
  // breach - the navigation was authorised when it happened - but a reader comparing timestamps
  // deserves to be told which records were reconstructed rather than written as the scan ran.
  const byId = new Map(log.attempts.map((a) => [a.permitId, a]));
  const lateRecorded = [];
  for (const p of permits) {
    const record = byId.get(p.id);
    const consumed = Date.parse(p.consumedAt ?? '');
    const navigated = Date.parse(record?.navigatedAt ?? '');
    if (Number.isNaN(consumed) || Number.isNaN(navigated)) continue;
    if (consumed - navigated > PERMIT_TTL_MS) {
      lateRecorded.push({
        permitId: p.id, recordId: record.id, url: p.url,
        navigatedAt: record.navigatedAt, recordedAt: p.consumedAt,
        delayMs: consumed - navigated,
      });
    }
  }

  return {
    issued: permits.length,
    consumed: permits.filter((p) => p.consumedAt).length,
    recordedLate: lateRecorded.length,
    lateRecords: lateRecorded,
    closedUnused: closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.UNUSED).length,
    closedRecordingFailed: closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.RECORDING_FAILED).length,
    closedDuplicateRequest: closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.DUPLICATE_REQUEST).length,
    open: openDiscoveryPermits(log).length,
    // A duplicate-request permit covered a real request, so it counts as traffic. It produced no
    // additional inspection, candidate, page or observation, and is counted nowhere else.
    // A recording-failed permit covered a real request too, and produced no observation.
    networkRequestsAuthorised:
      permits.filter((p) => p.consumedAt).length +
      closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.DUPLICATE_REQUEST).length +
      closed.filter((p) => p.disposition === PERMIT_DISPOSITIONS.RECORDING_FAILED).length,
    closures: closed.map((p) => ({
      closureId: p.closureId, permitId: p.id, closedAt: p.closedAt,
      disposition: p.disposition, reason: p.closureReason, accountedBy: p.accountedBy ?? null,
      url: p.url, agency: p.agency, category: p.category, round: p.candidateSetVersion,
    })),
  };
}

/**
 * Candidate sets whose bound evidence has since been superseded.
 *
 * selection-v1.0.26. The approved NZSIS account-registration set still binds `d-0301`, which `d-0308`
 * superseded - so the set rests on a withdrawn finding while its replacement is bound to nothing. The
 * corpus gate did not report it: `supportingRecords` checks that every bound id EXISTS, and a
 * superseded record still exists. An approval is a judgement about particular evidence, and evidence
 * that has been withdrawn since is not that evidence.
 */
export function staleSetBindings(log) {
  const out = [];
  for (const set of Object.values(log.candidateSets ?? {})) {
    const stale = (set.discoveryRecordIds ?? [])
      .map((id) => log.attempts.find((a) => a.id === id))
      .filter((a) => a && isDiscoverySuperseded(log, a.id));
    if (!stale.length) continue;
    out.push({
      agency: set.agency,
      category: set.category,
      version: set.version,
      approval: set.approval,
      stale: stale.map((a) => {
        const replacement = log.attempts.find((r) => r.supersedesDiscoveryId === a.id);
        return { id: a.id, replacedBy: replacement?.id ?? null };
      }),
    });
  }
  return out;
}

/**
 * Re-binds a candidate set onto the records that replaced its superseded evidence.
 *
 * Append-only: the previous binding is archived with the reason and the time, not edited. The set
 * returns to PENDING, because the researcher approved a set standing on particular records and the
 * records have changed - carrying the old approval across would be asserting a judgement nobody made
 * about this evidence. A binding that would still contain a superseded record is refused outright.
 */
export function reResolveCandidateSet(log, { agency, category, reason }) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('re-binding a candidate set requires a reason, which is recorded');
  }
  const set = log.candidateSets?.[setKey(agency, category)];
  if (!set) throw new Error(`no candidate set for ${agency} / ${category}`);
  const bound = set.discoveryRecordIds ?? [];
  const superseded = bound.filter((id) => {
    const record = log.attempts.find((a) => a.id === id);
    return record && isDiscoverySuperseded(log, id);
  });
  if (!superseded.length) {
    throw new Error(`${agency} / ${category} binds no superseded record; there is nothing to re-bind`);
  }

  const substitutions = [];
  const rebound = [];
  for (const id of bound) {
    if (!superseded.includes(id)) { rebound.push(id); continue; }
    // Follow the chain to the end: a correction may itself have been corrected.
    let current = id;
    const walked = new Set([id]);
    for (;;) {
      const next = log.attempts.find((a) => a.supersedesDiscoveryId === current);
      if (!next) break;
      if (walked.has(next.id)) throw new Error(`the supersession chain from ${id} loops at ${next.id}`);
      walked.add(next.id);
      current = next.id;
    }
    if (current === id) throw new Error(`${id} is superseded but no replacement names it`);
    substitutions.push({ from: id, to: current });
    rebound.push(current);
  }

  const deduped = [...new Set(rebound)];
  const stillSuperseded = deduped.filter((id) => isDiscoverySuperseded(log, id));
  if (stillSuperseded.length) {
    throw new Error(
      `the new binding would still contain superseded record(s): ${stillSuperseded.join(', ')}`
    );
  }
  const missing = deduped.filter((id) => !log.attempts.some((a) => a.id === id));
  if (missing.length) throw new Error(`the new binding names missing record(s): ${missing.join(', ')}`);

  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  (set.bindingHistory ??= []).push({
    discoveryRecordIds: [...bound],
    approval: set.approval,
    approvedAt: set.approvedAt ?? null,
    approvalNote: set.approvalNote ?? null,
    reboundAt: at,
    reason,
    substitutions,
  });
  set.discoveryRecordIds = deduped;
  set.discoveryMethods = [...new Set(
    deduped.map((id) => log.attempts.find((a) => a.id === id)?.discoveryKind).filter(Boolean)
  )].sort();
  set.approval = APPROVAL.PENDING;
  set.approvedAt = null;
  set.approvalNote = null;
  set.reboundAt = at;

  // Validated in the state it would be left in, and rolled back entirely if it does not hold.
  assertSetAgreesWithRound(log, set, {
    members: set.locked ?? [],
    declaration: set.candidateDeclaration,
  });
  return { set, substitutions };
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
/**
 * An append-only reconciliation for a permit consumed before the request it authorised.
 *
 * Amendment 67. `read-resource` consumed the permit, then waited out the pacing floor, then made
 * the request, so `consumedAt` preceded the traffic by however long the floor required: `p-0516`
 * records 23:16:36Z for a request made at 23:16:42Z. The code is fixed, but two records already
 * carry the discrepancy and a recorded timestamp is never rewritten.
 *
 * So the correction is a record, not an edit. It cites the retained fetch whose `fetchedAt` IS the
 * request boundary, and it is verified at write time against exactly that: there must be a real
 * discrepancy to reconcile, the cited fetch must be the one the record rests on, and the gap must
 * be consistent with a pacing wait rather than arbitrary. A reconciliation that could explain any
 * discrepancy at all would be a way to make the ledger agree with anything.
 */
export function reconcilePermitConsumption(log, { permitId, recordId, fetchId, note, at = null }) {
  const permits = log.discoveryPermits ?? [];
  const permit = permits.find((x) => x.id === permitId);
  if (!permit) throw new Error(`no permit ${permitId}`);
  const record = (log.attempts ?? []).find((a) => a.id === recordId);
  if (!record) throw new Error(`no recorded attempt ${recordId}`);
  const fetchEntry = (log.fetches ?? []).find((f) => f.id === fetchId);
  if (!fetchEntry) throw new Error(`no retained fetch ${fetchId}`);
  if (typeof note !== 'string' || note.trim().length < 40) {
    throw new Error('a reconciliation must say what it reconciles and why');
  }
  if (record.fetchId !== fetchId) {
    throw new Error(`${recordId} rests on ${record.fetchId ?? 'no fetch'}, not ${fetchId}`);
  }
  if (permit.url !== record.url) {
    throw new Error(`${permitId} authorises ${permit.url}, not ${record.url}`);
  }
  const consumed = Date.parse(permit.consumedAt ?? '');
  const navigated = Date.parse(record.navigatedAt ?? '');
  const fetched = Date.parse(fetchEntry.fetchedAt ?? '');
  if (Number.isNaN(consumed) || Number.isNaN(navigated) || Number.isNaN(fetched)) {
    throw new Error('the permit, the record and the fetch must all carry usable timestamps');
  }
  if (fetched !== navigated) {
    throw new Error(
      `${fetchId} was fetched at ${fetchEntry.fetchedAt} but ${recordId} records ` +
        `${record.navigatedAt}; the retained fetch is the request boundary`
    );
  }
  if (consumed >= navigated) {
    throw new Error(`${permitId} was not consumed before ${recordId} navigated; there is nothing to reconcile`);
  }
  // Consistent with a pacing wait, and nothing wider. The floor plus a second of recording slack is
  // the whole of the discrepancy this defect can produce.
  const gap = navigated - consumed;
  const explainable = POLICY.minDelayBetweenNavigationsMs + 1000;
  if (gap > explainable) {
    throw new Error(
      `${permitId} was consumed ${gap} ms before the request, more than a pacing wait can explain ` +
        `(${explainable} ms); this is not the defect Amendment 67 reconciles`
    );
  }
  const list = log.permitReconciliations ?? (log.permitReconciliations = []);
  if (list.some((x) => x.permitId === permitId)) throw new Error(`${permitId} is already reconciled`);
  const entry = {
    id: `pr-${String(list.length + 1).padStart(4, '0')}`,
    permitId, recordId, fetchId,
    recordedConsumedAt: permit.consumedAt,
    requestedAt: fetchEntry.fetchedAt,
    gapMs: gap,
    note,
    recordedAt: at ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  list.push(entry);
  return entry;
}

/** Every valid reconciliation, keyed by the permit it explains. */
export function permitReconciliations(log) {
  const out = new Map();
  for (const entry of log.permitReconciliations ?? []) out.set(entry.permitId, entry);
  return out;
}

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

    // selection-v1.0.25. A permitless record that navigated is only exempt if it PREDATES the
    // permit model. Treating every permitless record as legacy was a standing bypass: any new
    // record could claim a navigation with no authorisation simply by omitting `permitId`, and
    // `correct-discovery` could mint one. A record cannot backdate its way out of this - the
    // five-second pacing check compares it against the latest navigation in the log.
    const firstPermit = allPermits
      .map((p) => ms(p.issuedAt))
      .filter((t) => t !== null)
      .sort((a, b) => a - b)[0] ?? null;
    if (firstPermit !== null) {
      for (const attempt of log.attempts) {
        if (attempt.status !== 'discovery') continue;
        if (attempt.permitId) continue;
        if (attempt.navigationPerformed === false) continue; // requested nothing
        const at = ms(attempt.navigatedAt);
        if (at === null || at >= firstPermit) {
          problems.push(
            `${attempt.id ?? '(an unidentified record)'} records a navigation at ` +
              `${attempt.navigatedAt ?? 'an unstated time'} with no permit. Only records predating ` +
              'the permit model are exempt, and this one does not predate it.'
          );
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
        // selection-v1.0.31: the bytes the failed request produced are named, so the traffic has
        // evidence rather than only an assertion that it happened.
        if (permit.disposition === PERMIT_DISPOSITIONS.RECORDING_FAILED) {
          if (present(permit.accountedBy)) {
            problems.push(`${where} is closed ${permit.disposition} but names a discovery record; none exists`);
          }
          if (typeof permit.quarantinedFile !== 'string' || permit.quarantinedFile.trim() === '') {
            problems.push(`${where} is closed ${permit.disposition} without naming the quarantined bytes`);
          }
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
        // Amendment 67. An append-only reconciliation citing the retained fetch explains this and
        // is verified at write time; without one it stays a blocker.
        const reconciled = permitReconciliations(log).get(permit.id);
        if (!reconciled || reconciled.recordId !== record.id) {
          problems.push(
            `${where} was consumed at ${permit.consumedAt}, before ${record.id} navigated at ` +
              `${record.navigatedAt}`
          );
        }
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
    if (permit.disposition === PERMIT_DISPOSITIONS.RECORDING_FAILED && permit.accountedBy) {
      problems.push(`${permit.id} is closed ${permit.disposition} but names ${permit.accountedBy}`);
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
 * A deviation from the frozen protocol, recorded as data rather than prose.
 *
 * selection-v1.0.21. The robots breach earlier in the scan was disclosed in a dated note beside
 * the politeness clause, which is honest but not checkable: nothing verified that the record ids
 * it named existed, and nothing would have noticed if a later correction made the note false. A
 * deviation that names its evidence can be validated against the log, published with it, and
 * counted - so a reader is told how many there were rather than having to find them by reading.
 *
 * Append-only, like every other history here. A deviation that turned out to be wrong is
 * superseded by a later one; it is not edited, because the point of it is what was believed and
 * done at the time.
 */
export function recordDeviation(log, deviation) {
  (log.deviations ??= []);
  const record = {
    id: `v-${String(log.deviations.length + 1).padStart(4, '0')}`,
    recordedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...deviation,
  };
  log.deviations.push(record);
  const problems = checkDeviations(log);
  if (problems.length) {
    log.deviations.pop();
    throw new Error(`the deviation would not be consistent with the log:\n  ${problems.join('\n  ')}`);
  }
  return record;
}

/**
 * Every deviation must name evidence that exists and must not contradict it.
 *
 * The failure this prevents is a disclosure that reads as thorough and cites nothing real: a
 * deviation naming `p-0084` when no such permit exists, or asserting that no candidate evidence
 * was obtained while one of the records it names reports `candidates-found`. A disclosure nobody
 * can check is worth less than no disclosure, because it also buys credit.
 */
export function checkDeviations(log) {
  const problems = [];
  const deviations = log.deviations ?? [];
  const seen = new Set();
  const checks = new Set((log.robotsChecks ?? []).map((c) => c.id));
  const permits = new Set((log.discoveryPermits ?? []).map((p) => p.id));
  const attempts = new Map(log.attempts.map((a) => [a.id, a]));

  for (const d of deviations) {
    const where = d.id ?? '(a deviation with no id)';
    if (!d.id) problems.push('a deviation has no id');
    else if (seen.has(d.id)) problems.push(`deviation id ${d.id} appears more than once`);
    seen.add(d.id);
    if (!isoUtcish(d.recordedAt)) {
      problems.push(`${where} has recordedAt ${JSON.stringify(d.recordedAt)}, which is not a UTC timestamp`);
    }
    for (const field of ['kind', 'summary', 'detail']) {
      if (typeof d[field] !== 'string' || d[field].trim() === '') {
        problems.push(`${where} has no ${field}`);
      }
    }
    for (const [field, known, label] of [
      ['robotsCheckIds', checks, 'robots check'],
      ['permitIds', permits, 'permit'],
      ['attemptIds', new Set(attempts.keys()), 'attempt'],
    ]) {
      const ids = d[field];
      if (ids === undefined) continue;
      if (!Array.isArray(ids)) { problems.push(`${where} has ${field} that is not a list`); continue; }
      for (const id of ids) {
        if (!known.has(id)) problems.push(`${where} names ${label} ${id}, which does not exist`);
      }
    }
    if (d.requestsAffected !== undefined &&
        (!Number.isInteger(d.requestsAffected) || d.requestsAffected < 0)) {
      problems.push(`${where} has requestsAffected ${JSON.stringify(d.requestsAffected)}`);
    }
    // The claim most likely to become false as the scan continues, so it is the one checked
    // against the records the deviation itself names.
    if (d.candidateEvidenceObtained === false) {
      const found = (d.attemptIds ?? [])
        .map((id) => attempts.get(id))
        .filter((a) => a?.outcome === 'candidates-found');
      if (found.length) {
        problems.push(
          `${where} states no candidate evidence was obtained, but it names ` +
            `${found.map((a) => a.id).join(', ')}, which report candidates-found`
        );
      }
    }
  }
  return problems;
}

/**
 * The render registry: one observation, cited by as many judgements as it supports.
 *
 * selection-v1.0.25. Rendered evidence lived on the discovery record that produced it, which made
 * one render answer exactly one record - and a page is routinely `no-candidates` for account
 * registration and `candidates-found` for service application. It also let a judgement be supplied
 * before the evidence was read: `render-discovery` required `--outcome` up front, and that is
 * literally how `d-0306` came to say `no-candidates` about a page carrying three name fields.
 *
 * So an observation is its own append-only record, and a judgement is a separate record citing it.
 * The observation says what was retrieved; the judgement says what it means, per category, and can
 * be corrected without re-requesting anything.
 */
export function recordRender(log, render) {
  (log.renders ??= []);
  const record = { ...render, id: `g-${String(log.renders.length + 1).padStart(4, '0')}` };
  log.renders.push(record);
  return record;
}

export function findRender(log, id) {
  return (log.renders ?? []).find((r) => r.id === id) ?? null;
}

/** The most recent render of one canonical URL, whatever category it was made for. */
export function findRenderForUrl(log, url) {
  const wanted = canonicalise(url);
  const all = (log.renders ?? []).filter((r) => canonicalise(r.url) === wanted);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Every recorded render must still be on disk, byte for byte.
 *
 * selection-v1.0.25. The hashes were written and never read. Nothing re-hashed anything under
 * `rendered/`, so a file that was edited, truncated or deleted would leave a convincing
 * hash-shaped claim in the log and every gate would pass - the same defect `checkCaptureFiles`
 * fixed for the corpus captures, in the directory that had just become load-bearing for discovery.
 *
 * One validator, called from classification, from `corpusBlockers`, from provenance publication and
 * from the seal. A rule enforced where a value is written but not where it is trusted is the defect
 * this scan keeps rediscovering.
 */
export function checkRenderLedger(log, renderedDir) {
  const problems = [];
  const root = resolve(renderedDir);
  const attempts = log.attempts.filter((a) => a.status === 'discovery');
  const byId = new Map(log.attempts.map((a) => [a.id, a]));

  /**
   * A render filename must resolve INSIDE the rendered directory.
   *
   * selection-v1.0.26. Both implementations joined the name straight onto the directory, so
   * `../../captures/some-page.html` read a corpus capture and verified happily against its own
   * digest - evidence confinement broken by a string. The name is also required to be a plain
   * basename, because that is all the harness ever writes.
   */
  const confinedPath = (file, where) => {
    if (typeof file !== 'string' || file.trim() === '') {
      problems.push(`${where} names no rendered file`);
      return null;
    }
    if (file !== basename(file)) {
      problems.push(`${where} names ${JSON.stringify(file)}, which is not a plain file name`);
      return null;
    }
    const full = resolve(root, file);
    const rel = relative(root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      problems.push(`${where} names ${JSON.stringify(file)}, which resolves outside ${RENDERED_DIR}/`);
      return null;
    }
    return full;
  };

  const verifyBytes = (where, full, claimedSha, claimedBytes) => {
    let bytes = null;
    try {
      bytes = readFileSync(full);
    } catch (error) {
      problems.push(`${where}: ${basename(full)} could not be read: ${error.message}`);
      return;
    }
    if (claimedBytes !== undefined && claimedBytes !== null && bytes.length !== claimedBytes) {
      problems.push(`${where}: ${basename(full)} is ${bytes.length} bytes, the log records ${claimedBytes}`);
    }
    if (sha256(bytes) !== claimedSha) {
      problems.push(
        `${where}: ${basename(full)} hashes to ${sha256(bytes).slice(0, 12)}, the log records ` +
          `${String(claimedSha).slice(0, 12)}. The evidence on disk is not the evidence that was ` +
          'observed.'
      );
    }
  };

  // selection-v1.0.31. What ELSE is in the directory. `captures/` has had this check since
  // capture-v1.0.6; `rendered/` never got one, and it is now load-bearing for discovery. Two renders
  // wrote their bytes and then failed to record - `appendAttempt` threw and `writeLog` never ran - so
  // two files sat there that no record named, and both ledgers reported zero problems.
  {
    let present = null;
    try { present = readdirSync(root).filter((f) => f.endsWith('.html')); } catch { present = null; }
    if (present) {
      const named = new Set([
        ...(log.renders ?? []).map((r) => r.renderFile),
        ...log.attempts.map((a) => a.renderFile),
      ].filter(Boolean));
      for (const file of present) {
        if (!named.has(file)) {
          problems.push(
            `${file} is in ${RENDERED_DIR}/ but no render or record names it. Rendered bytes nothing ` +
              'accounts for must be quarantined, not left beside the evidence.'
          );
        }
      }
    }
  }

  // The registry itself.
  const seen = new Set();
  for (const render of log.renders ?? []) {
    const where = render.id ?? '(a render with no id)';
    if (!render.id) problems.push('a render has no id');
    else if (seen.has(render.id)) problems.push(`render id ${render.id} appears more than once`);
    seen.add(render.id);
    for (const field of ['url', 'renderedSha256', 'navigatedAt']) {
      if (!render[field]) problems.push(`${where} has no ${field}`);
    }
    if (!/^[0-9a-f]{64}$/.test(render.renderedSha256 ?? '')) {
      problems.push(`${where} has renderedSha256 ${JSON.stringify(render.renderedSha256)}`);
    }
    if (!Number.isInteger(render.renderedBytes) || render.renderedBytes < 0) {
      problems.push(`${where} has renderedBytes ${JSON.stringify(render.renderedBytes)}`);
    }
    const full = confinedPath(render.renderFile, where);
    if (full) verifyBytes(where, full, render.renderedSha256, render.renderedBytes);
  }

  // Exactly one active observation per render. Two would make it ambiguous which record a
  // judgement's `evidenceFromDiscoveryId` is required to name.
  const permits = log.discoveryPermits ?? [];
  for (const render of log.renders ?? []) {
    if (!render.id) continue;
    const observations = attempts.filter(
      (a) => a.renderId === render.id && a.recordType === RECORD_TYPES.OBSERVATION &&
        !isDiscoverySuperseded(log, a.id)
    );
    if (observations.length > 1) {
      problems.push(
        `${render.id} is claimed by ${observations.length} active observations ` +
          `(${observations.map((a) => a.id).join(', ')}); a render is observed once`
      );
    }
    // Amendment 48. Two further ways a render is legitimately owned.
    //
    // A RECLASSIFICATION owns the render carrying its corrected metadata, which is not a second
    // retrieval but the same bytes re-read.
    //
    // And a render whose observation was SUPERSEDED BY a reclassification of itself keeps that
    // observation as its historical owner: `g-0158` was retrieved under `p-0285` by `d-0676`, and
    // that remains the true account of how those bytes arrived. Requiring an ACTIVE observation
    // made the correction orphan the very render it corrected.
    const reclassifications = attempts.filter(
      (a) => a.renderId === render.id && a.recordType === RECORD_TYPES.RECLASSIFICATION &&
        !isDiscoverySuperseded(log, a.id)
    );
    // Followed along the supersession CHAIN, not one link. `g-0158`'s observation `d-0676` was
    // superseded by `d-0684`, which was itself superseded by the reclassification `d-0686` when the
    // record type was repaired. A one-link test would orphan the render again on every later
    // correction, which is the same brittleness that produced this defect.
    const supersededBy = (id) => attempts.filter((r) => r.supersedesDiscoveryId === id);
    const chainReachesActiveReclassification = (startId) => {
      const seen = new Set();
      const queue = [startId];
      while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        for (const next of supersededBy(id)) {
          if (next.recordType === RECORD_TYPES.RECLASSIFICATION && !isDiscoverySuperseded(log, next.id)) {
            return true;
          }
          queue.push(next.id);
        }
      }
      return false;
    };
    const historicalOwner = attempts.some(
      (a) => a.renderId === render.id && a.recordType === RECORD_TYPES.OBSERVATION &&
        chainReachesActiveReclassification(a.id)
    );
    if (observations.length === 0 && reclassifications.length === 0 && !historicalOwner &&
        !render.adoptedFrom) {
      problems.push(`${render.id} has no observation record and was not adopted from one`);
    }

    // selection-v1.0.27. The registry's own permit, checked. A render naming a permit that
    // authorised a different request - or none - would make the traffic behind the evidence
    // unaccounted, and the ledger accepted `p-0001` in place of `p-0093` without comment.
    const permit = permits.find((x) => x.id === render.permitId);
    if (!render.permitId) problems.push(`${render.id} names no permit`);
    else if (!permit) problems.push(`${render.id} names permit ${render.permitId}, which does not exist`);
    else if (!permit.consumedAt) {
      problems.push(`${render.id} names permit ${permit.id}, which is not recorded as consumed`);
    } else if (permit.url !== render.url) {
      problems.push(
        `${render.id} is of ${render.url} but names permit ${permit.id}, which authorised ${permit.url}`
      );
    }
    // And it must be the permit the record that introduced it used, not merely some consumed one.
    const introducer = observations[0] ??
      (render.adoptedFrom ? byId.get(render.adoptedFrom) : null);
    if (introducer && introducer.permitId && render.permitId &&
        introducer.permitId !== render.permitId) {
      problems.push(
        `${render.id} names permit ${render.permitId} but ${introducer.id}, which recorded it, used ` +
          `${introducer.permitId}`
      );
    }
  }

  for (const a of attempts) {
    // selection-v1.0.26. The SEMANTIC checks apply to active records only. A superseded record's
    // judgement has been withdrawn, and its citation withdrawn with it - `d-0308` names the wrong
    // evidence source and `d-0309` corrects it, so holding `d-0308` to the rule would make every
    // correction a permanent publication block, which is the opposite of what append-only
    // correction is for. Its BYTES are still checked below, because the evidence is still evidence.
    const withdrawn = isDiscoverySuperseded(log, a.id);

    // selection-v1.0.27. What each record TYPE is allowed to contain, enforced here and not only at
    // write time. The ledger checked that `recordType` held a recognised word and nothing about
    // whether the record was shaped like one: an active judgement relabelled `observation` with its
    // evidence source deleted still reported `no-candidates`, still claimed no navigation, still
    // answered its record, still cleared the backlog, and passed both validators with zero
    // problems. A rule enforced where a value is written but not where it is trusted is the defect
    // this scan keeps rediscovering, and this is the fourth time it has been this exact defect.
    if (!withdrawn && a.recordType === RECORD_TYPES.OBSERVATION) {
      const where = `${a.id} (observation)`;
      if (!['rendered', 'retrieval-blocked'].includes(a.outcome)) {
        problems.push(`${where} records ${JSON.stringify(a.outcome)}; an observation concludes nothing`);
      }
      if (a.navigationPerformed === false) {
        problems.push(`${where} claims no navigation occurred; an observation IS a retrieval`);
      }
      if (!isoUtcish(a.navigatedAt)) {
        problems.push(`${where} has no navigation timestamp`);
      }
      if (!a.permitId) problems.push(`${where} names no permit`);
      else {
        const permit = permits.find((x) => x.id === a.permitId);
        if (!permit) problems.push(`${where} names permit ${a.permitId}, which does not exist`);
        else if (!permit.consumedAt) problems.push(`${where} names permit ${permit.id}, which is not consumed`);
      }
      if (a.evidenceFromDiscoveryId) {
        problems.push(`${where} names an evidence source; an observation IS the evidence`);
      }
      if (a.answersDiscoveryId) {
        problems.push(`${where} answers ${a.answersDiscoveryId}; an observation concludes nothing, so it answers nothing`);
      }
      if (!a.renderId) problems.push(`${where} cites no render`);
    }
    if (!withdrawn && a.recordType === RECORD_TYPES.JUDGEMENT_ONLY) {
      const where = `${a.id} (judgement)`;
      if (!JUDGEMENT_OUTCOMES.includes(a.outcome)) {
        problems.push(`${where} records ${JSON.stringify(a.outcome)}, not ${JUDGEMENT_OUTCOMES.join(' or ')}`);
      }
      if (a.permitId) {
        problems.push(`${where} names permit ${a.permitId}; a judgement makes no request`);
      }
      if (a.navigationPerformed !== false) {
        problems.push(`${where} does not record navigationPerformed: false`);
      }
      if (!a.renderId) problems.push(`${where} cites no rendered evidence`);
      // selection-v1.0.35. The two links name different ROLES, and in a correction chain they must
      // differ: `answersDiscoveryId` is the plain-retrieval obligation being discharged, and
      // `supersedesDiscoveryId` is the prior JUDGEMENT being corrected. selection-v1.0.27 required
      // them equal, which was written before a judgement carrying an answer could be corrected -
      // and it refused `d-0377`, the repair that restores an answer link, for being exactly what it
      // is. Ambiguity only arises when the superseded record is itself an obligation rather than a
      // judgement, because then two different records are being resolved at once.
      if (a.answersDiscoveryId && a.supersedesDiscoveryId &&
          a.answersDiscoveryId !== a.supersedesDiscoveryId) {
        const superseded = log.attempts.find((x) => x.id === a.supersedesDiscoveryId);
        if (superseded && superseded.recordType !== RECORD_TYPES.JUDGEMENT_ONLY) {
          problems.push(
            `${where} answers ${a.answersDiscoveryId} and supersedes ${a.supersedesDiscoveryId}, which ` +
              'is not a judgement; it is unclear which record it resolved'
          );
        }
      }
    }

    // One authority for the evidence. A record may repeat the registry's file, digest and size for
    // readability, but a copy that DISAGREES with the registry is a second claim about the same
    // bytes, and nothing said which of the two governs.
    if (a.renderId) {
      const render = findRender(log, a.renderId);
      if (render) {
        for (const [field, label] of [['renderFile', 'file'], ['renderedSha256', 'digest'],
          ['renderedBytes', 'byte count']]) {
          if (a[field] !== undefined && a[field] !== null && a[field] !== render[field]) {
            problems.push(
              `${a.id} carries a ${label} of its own (${JSON.stringify(a[field])}) that disagrees ` +
                `with render ${render.id} (${JSON.stringify(render[field])}); the registry is the ` +
                'single authority, so a copy must match it or be absent'
            );
          }
        }
      }
    }

    // A record citing a render must cite one that exists, of the page it judges.
    if (a.renderId && !withdrawn) {
      const render = findRender(log, a.renderId);
      if (!render) {
        problems.push(`${a.id} cites render ${a.renderId}, which does not exist`);
        continue;
      }
      if (canonicalise(render.url) !== canonicalise(a.url)) {
        problems.push(
          `${a.id} is ${a.url} but cites render ${render.id} of ${render.url}; a judgement must ` +
            'rest on evidence of the page it judges'
        );
      }
      // Amendment 48: a reclassification is the third legitimate kind of record resting on a render.
      // Amendment 54 added the fourth type and this list did not follow it, so the render ledger
      // refused every technical conclusion and the provenance publish failed. Named once in
      // `RENDER_BEARING_RECORD_TYPES` rather than retyped here - and deliberately a SUBSET of
      // RECORD_TYPES, because Amendment 57's `policy-reuse` rests on a recorded robots check and
      // on no render at all.
      if (!RENDER_BEARING_RECORD_TYPES.includes(a.recordType)) {
        problems.push(
          `${a.id} cites render ${a.renderId} with recordType ` +
            `${JSON.stringify(a.recordType)}, which is not one of ` +
            `${Object.values(RECORD_TYPES).join(', ')}; a record resting on rendered evidence ` +
            'must say which kind it is'
        );
      }
      // A judgement may not rest on a challenge document.
      if (a.recordType === RECORD_TYPES.JUDGEMENT_ONLY && (render.accessBarriers ?? []).length > 0) {
        problems.push(
          `${a.id} judges ${a.url} on render ${render.id}, which was access-barred ` +
            `(${render.accessBarriers.join(', ')}); a challenge document is not the page`
        );
      }
      // The evidence source must be the observation of that render, not some other record.
      if (a.recordType === RECORD_TYPES.JUDGEMENT_ONLY) {
        const source = byId.get(a.evidenceFromDiscoveryId);
        if (!a.evidenceFromDiscoveryId) {
          problems.push(`${a.id} is a judgement with no evidenceFromDiscoveryId`);
        } else if (!source) {
          problems.push(`${a.id} names evidence source ${a.evidenceFromDiscoveryId}, which does not exist`);
        } else if (source.status !== 'discovery') {
          problems.push(`${a.id} names evidence source ${source.id}, a ${source.status} attempt`);
        } else {
          const introduced = source.renderId === a.renderId || render.adoptedFrom === source.id;
          if (!introduced) {
            problems.push(
              `${a.id} cites render ${a.renderId} but names ${source.id} as its source, and ${source.id} ` +
                'neither recorded that render nor is the record it was adopted from'
            );
          }
        }
      }
    }

    // An answered record must be the same work: same agency, category, round and page.
    if (a.answersDiscoveryId && !withdrawn) {
      const target = byId.get(a.answersDiscoveryId);
      const where = `${a.id} answers ${a.answersDiscoveryId}`;
      if (!target) {
        problems.push(`${where}, which does not exist`);
      } else if (target.status !== 'discovery') {
        problems.push(`${where}, a ${target.status} attempt`);
      } else {
        if (!a.renderId) problems.push(`${where} without citing rendered evidence`);
        for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
          ['candidateSetVersion', 'round']]) {
          if (target[field] !== a[field]) {
            problems.push(
              `${where}, but that record is ${label} ${JSON.stringify(target[field])} and this one is ` +
                `${JSON.stringify(a[field])}`
            );
          }
        }
        if (canonicalise(target.url) !== canonicalise(a.url)) {
          problems.push(`${where}, which is ${target.url}, not ${a.url}`);
        }
      }
    }

    // selection-v1.0.35. The chain's answer link, and at most one active judgement per obligation.
    if (a.recordType === RECORD_TYPES.JUDGEMENT_ONLY && !withdrawn) {
      const inherited = answerChain(log, a);
      if (inherited.conflict) {
        problems.push(
          `${a.id}'s correction chain answers more than one record (${inherited.answers.join(', ')}); ` +
            'a chain of corrections resolves one obligation'
        );
      } else if (inherited.stable && a.answersDiscoveryId !== inherited.stable) {
        problems.push(
          `${a.id} is the active end of a chain that answers ${inherited.stable}, but names ` +
            `${a.answersDiscoveryId ? a.answersDiscoveryId : 'none'}; the obligation it discharged would reopen`
        );
      }
    }

    // selection-v1.0.29. The flag that discharges a backlog obligation, validated where it is
    // trusted. Checked for every record carrying it, superseded or not: a withdrawn record discharges
    // nothing, but a malformed claim is still worth naming.
    if (a.renderRefused !== undefined) {
      if (a.renderRefused !== true) {
        problems.push(`${a.id} has renderRefused ${JSON.stringify(a.renderRefused)}; it is true or absent`);
      } else {
        for (const problem of renderRefusalProblems(log, a)) problems.push(problem);
      }
    }
    // selection-v1.0.33: a headed observation, successful or not, must justify its second navigation.
    if (a.recordType === RECORD_TYPES.OBSERVATION && !withdrawn) {
      const own = findRender(log, a.renderId);
      if (own?.browserMode === 'headed') {
        for (const problem of headedObservationProblems(log, a)) problems.push(problem);
      } else if (own && a.followsDiscoveryId) {
        problems.push(
          `${a.id} is a ${own.browserMode} observation claiming to follow ${a.followsDiscoveryId}; only a ` +
            'headed retry follows a barred attempt'
        );
      }
    }
    if (a.renderBarred !== undefined) {
      if (a.renderBarred !== true) {
        problems.push(`${a.id} has renderBarred ${JSON.stringify(a.renderBarred)}; it is true or absent`);
      } else {
        for (const problem of renderBarredProblems(log, a)) problems.push(problem);
      }
    }

    // A record carrying a digest but no registry entry is checked directly against disk. Two such
    // records exist - written before the registry did - and a hash nobody re-reads is decoration
    // whether or not a registry happens to hold it.
    if (!a.renderId && a.renderFile) {
      const full = confinedPath(a.renderFile, a.id);
      if (full) verifyBytes(a.id, full, a.renderedSha256, a.renderedBytes);
    }
  }
  // selection-v1.0.35. One active judgement per obligation. Two were accepted, and they were free to
  // contradict each other: nothing said which of them answered the record.
  {
    const byAnswer = new Map();
    for (const a of attempts) {
      if (a.recordType !== RECORD_TYPES.JUDGEMENT_ONLY) continue;
      if (!a.answersDiscoveryId) continue;
      if (isDiscoverySuperseded(log, a.id)) continue;
      if (!byAnswer.has(a.answersDiscoveryId)) byAnswer.set(a.answersDiscoveryId, []);
      byAnswer.get(a.answersDiscoveryId).push(a);
    }
    for (const [answered, judgements] of byAnswer) {
      if (judgements.length > 1) {
        problems.push(
          `${answered} is answered by ${judgements.length} active judgements ` +
            `(${judgements.map((j) => `${j.id}:${j.outcome}`).join(', ')}); one obligation, one judgement`
        );
      }
    }
  }

  return problems;
}

/**
 * Registers a render that was recorded before the registry existed.
 *
 * selection-v1.0.25. `d-0306` and `d-0307` carry a rendered file and its digest on the attempt
 * record itself, because that is where rendered evidence lived when they were written. Adopting them
 * verifies the file against the recorded digest first: a migration that trusted the log would carry
 * an unverified claim into the registry and call it evidence.
 */
export function adoptRender(log, { fromAttemptId, capturesRoot }) {
  const source = log.attempts.find((a) => a.id === fromAttemptId);
  if (!source) throw new Error(`${fromAttemptId} matches no recorded attempt`);
  if (!source.renderFile) throw new Error(`${fromAttemptId} carries no rendered file`);
  if (findRenderForUrl(log, source.url)) {
    throw new Error(`a render of ${source.url} is already registered; adoption would duplicate it`);
  }
  const file = join(resolve(capturesRoot), RENDERED_DIR, source.renderFile);
  const bytes = readFileSync(file);
  if (bytes.length !== source.renderedBytes) {
    throw new Error(`${source.renderFile} is ${bytes.length} bytes, but ${fromAttemptId} records ${source.renderedBytes}`);
  }
  const actual = sha256(bytes);
  if (actual !== source.renderedSha256) {
    throw new Error(
      `${source.renderFile} hashes to ${actual} but ${fromAttemptId} records ${source.renderedSha256}`
    );
  }
  return recordRender(log, {
    url: source.url, finalUrl: source.finalUrl ?? null, navigatedAt: source.navigatedAt,
    permitId: source.permitId ?? null,
    renderFile: source.renderFile, renderedSha256: source.renderedSha256,
    renderedBytes: source.renderedBytes, httpStatus: source.httpStatus ?? null,
    loadState: source.loadState ?? null, domNodes: source.domNodes ?? null,
    linkCount: source.linkCount ?? null, formCount: source.formCount ?? null,
    controlCount: source.controlCount ?? null, buttonCount: source.buttonCount ?? null,
    accessBarriers: source.accessBarriers ?? [], submissionProtection: source.submissionProtection ?? [],
    authenticationSignals: source.authenticationSignals ?? [],
    browser: source.browser ?? null, browserMode: source.politeness?.browserMode ?? null,
    userAgent: source.politeness?.userAgent ?? null, settleMs: source.politeness?.settleMs ?? null,
    adoptedFrom: fromAttemptId,
    adoptedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

/**
 * One render's evidence, re-verified before anything is concluded from it.
 *
 * selection-v1.0.25. The shared validator, called from classification, from correction, and - as
 * `checkRenderLedger` over the whole registry - from the corpus gate, from provenance publication
 * and from the seal. Reading a digest out of the log and trusting it is what made the hashes
 * decorative.
 */
export function assertRenderEvidenceUsable(log, { renderId, capturesRoot }) {
  const problems = [];
  const render = findRender(log, renderId);
  if (!render) return [`render ${renderId} does not exist`];
  if (!capturesRoot) return ['no capture root was supplied, so the rendered file could not be verified'];
  const file = join(resolve(capturesRoot), RENDERED_DIR, render.renderFile ?? '');
  if (!render.renderFile) problems.push(`${render.id} names no rendered file`);
  else if (!existsSync(file)) problems.push(`${render.id} names ${render.renderFile}, which is not on disk`);
  else {
    const bytes = readFileSync(file);
    if (bytes.length !== render.renderedBytes) {
      problems.push(`${render.id}: ${render.renderFile} is ${bytes.length} bytes, the log records ${render.renderedBytes}`);
    }
    const actual = sha256(bytes);
    if (actual !== render.renderedSha256) {
      problems.push(
        `${render.id}: ${render.renderFile} hashes to ${actual.slice(0, 12)}, the log records ` +
          `${String(render.renderedSha256).slice(0, 12)}`
      );
    }
  }
  if (render.accessBarriers?.length) {
    problems.push(
      `${render.id} was access-barred (${render.accessBarriers.join(', ')}); a judgement about a ` +
        'page cannot rest on a challenge document'
    );
  }
  return problems;
}

/** Where rendered evidence lives, relative to the capture root. Never beside the corpus captures. */
export const RENDERED_DIR = 'rendered';

/** Where a plainly-read resource's bytes are retained. */
export const FETCHED_DIR = 'fetched';

/**
 * Amendment 55. A plainly-read resource retains its bytes, like a render does.
 *
 * The sitemap method reads a resource outside the browser, and until now the harness kept nothing:
 * `discovery` recorded an outcome the operator supplied and the bytes were gone. So a sitemap
 * judgement rested on a reading no reader could check, and the log could not distinguish a document
 * that was read from one that was described. That is how `d-0276` came to state what a child
 * sitemap listed when no child sitemap was ever retrieved - recorded as deviation `v-0003`.
 *
 * The registry mirrors the render registry deliberately: same shape, same verification, so the
 * ledger checks and the sealer's mirror are the same argument applied to a different kind of
 * evidence.
 */
/**
 * Amendment 57. Does this policy-reuse record rest on a policy that actually governed it?
 *
 * Returns the reasons it does not, so an empty list is the only thing that permits the record. The
 * point of the kind is to document reuse WITHOUT a request, so the one thing it must prove is that
 * the policy it names was really in force: the same origin, and still fresh when the record was
 * written. A stale or foreign policy documented as a round's authority would be worse than the
 * refetch it replaces, because it would look like provenance while being none.
 */
export function policyReuseProblems(log, attempt) {
  if (attempt?.recordType !== RECORD_TYPES.POLICY_REUSE) return [];
  const problems = [];
  const check = (log?.robotsChecks ?? []).find((c) => c.id === attempt.robotsCheckId);
  if (!check) {
    return [`names robots check ${JSON.stringify(attempt.robotsCheckId)}, which is not recorded`];
  }
  // Amendment 58. The record must be OF the policy file, not merely of the same origin. A record
  // whose url was `/contact` passed every check: it named a real, fresh policy for the right
  // origin, and claimed to be a robots-method record about a page. The URL is compared exactly to
  // the check's own, and the website is required to belong to that origin, so a reuse record
  // cannot document one origin's policy while pointing at another's page.
  if (canonicalise(attempt.url) !== canonicalise(check.url)) {
    problems.push(`${check.id} is the policy at ${check.url}, and this record is of ${attempt.url}`);
  }
  let origin = null;
  try { origin = new URL(attempt.url).origin; } catch { problems.push(`${attempt.url} is not a usable URL`); }
  if (origin && check.origin !== origin) {
    problems.push(`${check.id} is the policy for ${check.origin}, not ${origin}`);
  }
  let site = null;
  try { site = new URL(attempt.website).origin; } catch { problems.push(`${attempt.website} is not a usable website`); }
  if (site && site !== check.origin) {
    problems.push(`this record's website is ${site}, which is not ${check.origin}`);
  }

  // Amendment 58. The window is TWO-SIDED: check.fetchedAt <= examinedAt < fetchedAt + 24h.
  //
  // It was one-sided, so a policy fetched AFTER the record it supposedly governed passed every
  // check - the record resting on evidence that did not yet exist. Amendment 57's own test asserted
  // that this was permitted, under a title saying it was refused, which is worse than no test: it
  // read as coverage in the suite while asserting the opposite.
  const at = Date.parse(attempt.examinedAt ?? '');
  const fetched = Date.parse(check.fetchedAt ?? '');
  if (Number.isNaN(at)) problems.push('records no usable examinedAt, so its policy cannot be dated');
  else if (Number.isNaN(fetched)) problems.push(`${check.id} records no usable fetchedAt`);
  else if (at < fetched) {
    problems.push(
      `${check.id} was fetched at ${check.fetchedAt}, AFTER this record at ${attempt.examinedAt}; ` +
        'a record cannot rest on a policy that did not yet exist'
    );
  } else if (at - fetched >= ROBOTS_MAX_AGE_MS) {
    problems.push(
      `${check.id} was fetched at ${check.fetchedAt}, more than 24 hours before this record at ` +
        `${attempt.examinedAt}; a stale policy did not govern this round`
    );
  }
  if (check.disposition === 'unestablished') {
    problems.push(`${check.id} is unestablished, so no policy was in force to reuse`);
  }
  return problems;
}

/**
 * Amendment 59. Records written on or after this instant must carry a structural report.
 *
 * An explicit boundary, because the version marker alone cannot distinguish "no report was ever
 * taken" from "the page had no name field" for the 348 attempts and 319 renders that predate the
 * repair. Grandfathering by a stated timestamp is auditable; inferring it from the marker's absence
 * would be circular.
 */
export const STRUCTURAL_REPORT_REQUIRED_FROM = Date.parse('2026-10-04T02:00:00Z');

/**
 * Amendment 61. The DEFINED offline reanalysis: a pure derivation over retained markup.
 *
 * The sealer must be able to reproduce an offline report and compare it, and the sealer is
 * dependency-free - it cannot launch a browser. So the offline derivation is defined over the
 * markup alone, with no layout and no scripting, and both implementations compute it independently
 * from the retained file.
 *
 * That makes its limits explicit rather than implied. A markup derivation cannot know what was
 * VISIBLE: it has no stylesheets, so it cannot distinguish a control the live page showed from one
 * it hid. An offline report therefore establishes that a name-collecting control exists in the
 * retained markup, and never that it was visible without entering data or submitting - which is
 * criterion four, and why a candidate cannot be selected on an offline report.
 *
 * Deterministic by construction: no clock, no network, no browser. Given the same bytes it returns
 * the same report in both packages, which is what makes comparison meaningful.
 */
export function offlineStructuralReport(html) {
  const text = Buffer.isBuffer(html) ? html.toString('utf8') : String(html ?? '');
  const attr = (tag, name) => {
    const m = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return m ? (m[2] ?? m[3] ?? '') : '';
  };
  const labelFor = (id) => {
    if (!id) return '';
    const m = new RegExp(`<label[^>]*\\bfor=("${id}"|'${id}')[^>]*>([\\s\\S]*?)</label>`, 'i').exec(text);
    return (m?.[2] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const forms = [...text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const nameFields = [];
  for (const [, formAttrs, body] of forms) {
    const formAction = attr(formAttrs, 'action');
    const formRole = attr(formAttrs, 'role');
    const formId = attr(formAttrs, 'id');
    const formClass = attr(formAttrs, 'class');
    const submitLabels = [...body.matchAll(/<input\b[^>]*>|<button\b[^>]*>([\s\S]*?)<\/button>/gi)]
      .map((x) => {
        if (x[0].startsWith('<button')) return (x[1] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const type = attr(x[0], 'type').toLowerCase();
        return ['submit', 'button'].includes(type) ? attr(x[0], 'value') : '';
      })
      .filter((v) => v !== '');
    for (const input of body.matchAll(/<input\b[^>]*>/gi)) {
      const tag = input[0];
      const type = (attr(tag, 'type') || 'text').toLowerCase();
      if (!['text', 'email', 'tel', 'url', 'number', 'search'].includes(type)) continue;
      const name = attr(tag, 'name');
      const id = attr(tag, 'id');
      const aria = attr(tag, 'aria-label');
      const label = labelFor(id);
      if (!NAME_FIELD_HINT.test(`${name} ${id} ${label} ${aria}`)) continue;
      nameFields.push(classifyNameField({
        name, id, label, ariaLabel: aria, formAction, formRole, formId, formClass, submitLabels,
      }));
    }
  }
  // Affordances, from the markup's own anchors and buttons. Visibility is unknown here, which is
  // why the source marker matters.
  const affordances = [];
  for (const el of text.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>|<button\b[^>]*>[\s\S]*?<\/button>/gi)) {
    const tag = el[0];
    const inner = tag.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const aria = attr(tag, 'aria-label');
    const matched = REGISTER_LABEL.test(inner) ? inner : (REGISTER_LABEL.test(aria) ? aria : null);
    if (!matched) continue;
    affordances.push({
      label: matched.slice(0, 80),
      element: tag.startsWith('<a') ? 'a' : 'button',
      target: tag.startsWith('<a') ? (attr(tag, 'href') || null) : null,
    });
  }
  return {
    structuralReportVersion: STRUCTURAL_REPORT_VERSION,
    structuralReportSource: 'offline-reanalysis',
    registrationAffordances: affordances.slice(0, 10),
    nameFields,
    collectedNameFields: nameFields.filter((f) => f.role === 'collection').length,
    searchKeyNameFields: nameFields.filter((f) => f.role === 'query').length,
  };
}

/**
 * Amendment 61. Does this record already carry a complete, current, live structural report?
 *
 * The question that decides whether an offline reanalysis is permitted at all. If the answer is
 * yes, there is a live report to copy and re-deriving one offline could only lose information -
 * `nameFields` depends on visibility, which retained markup cannot establish.
 */
export function hasCompleteCurrentReport(record) {
  if (!record) return false;
  if (record.structuralReportVersion !== STRUCTURAL_REPORT_VERSION) return false;
  if (record.structuralReportSource !== 'live') return false;
  return Array.isArray(record.registrationAffordances) && Array.isArray(record.nameFields) &&
    Number.isInteger(record.collectedNameFields) && Number.isInteger(record.searchKeyNameFields);
}

/**
 * Did this record obtain a document for `detectBlocking` to run on, and does it OWN that document?
 *
 * One report per document, on the record that owns the bytes. A discovery observation names the
 * render it registered through `renderId`, and the report lives on that registry entry: demanding
 * one of the observation too would duplicate a finding and invite the two copies to disagree.
 */
export function bearsDocument(record) {
  if (!record) return false;
  if (record.refused === true) return false;
  // A record that defers to a render in the registry is not the owner of those bytes.
  if (record.renderId && record.status === 'discovery') return false;
  return /^[0-9a-f]{64}$/.test(record.htmlSha256 ?? '') ||
    /^[0-9a-f]{64}$/.test(record.renderedSha256 ?? '');
}

/**
 * Amendment 59. Is this record's structural report present, well formed and self-consistent?
 *
 * `detectBlocking` computed four fields and both writers dropped them, so across the whole log the
 * name-field report was persisted nowhere and the affordance report survived on one hand-populated
 * render. Presence is therefore the first thing checked - but only the first. A report whose counts
 * disagree with its own `nameFields` would be worse than none, because a reader takes the counts as
 * the finding; and a report copied onto a record for a different page would attribute one
 * document's structure to another.
 */
export function structuralReportProblems(record, { citedFrom = null, capturesRoot = null } = {}) {
  const problems = [];
  if (!record) return ['there is no record to check'];
  const FIELDS = ['registrationAffordances', 'nameFields', 'collectedNameFields', 'searchKeyNameFields'];
  // Amendment 61. The record's OWN time decides whether it must carry a report.
  //
  // This read `capturedAt` first, so a decision written today inherited the capture time of the
  // evidence it rests on and appeared grandfathered. A promotion of `c-1016`, captured at 01:16Z
  // before the 02:00Z boundary, would have passed with no report at all. Grandfathering belongs to
  // the historical evidence record, never to a decision made now, so `examinedAt` - the time this
  // record was written - comes first.
  const at = Date.parse(record.examinedAt ?? record.capturedAt ?? record.navigatedAt ?? '');
  const required = bearsDocument(record) && !Number.isNaN(at) && at >= STRUCTURAL_REPORT_REQUIRED_FROM;
  const present = FIELDS.some((f) => record[f] !== undefined) || record.structuralReportVersion !== undefined;

  if (!bearsDocument(record) && present) {
    return ['carries a structural report although it obtained no document; there was nothing to inspect'];
  }
  if (required && !present) {
    return [
      'obtained a document but carries no structural report; Amendments 46 and 51 require one, and ' +
        'it was computed and discarded for the whole log before Amendment 59',
    ];
  }
  if (!present) return problems;

  // A record from before the boundary may carry a PARTIAL report and must not be failed for it.
  // `g-0163`'s `registrationAffordances` was populated by hand during the Amendment 46
  // reclassification: it is real evidence, derived from the retained bytes, and materially
  // different from a report that never existed. What it must not do is pass as a current one, and
  // the absent version marker is exactly what says so.
  const current = required;
  if (current && record.structuralReportVersion !== STRUCTURAL_REPORT_VERSION) {
    problems.push(
      `records structuralReportVersion ${JSON.stringify(record.structuralReportVersion)}, not ` +
        `${STRUCTURAL_REPORT_VERSION}; an unversioned or older report must not pass as a current one`
    );
  }
  if (!current && record.structuralReportVersion !== undefined &&
      record.structuralReportVersion !== STRUCTURAL_REPORT_VERSION) {
    problems.push(
      `records structuralReportVersion ${JSON.stringify(record.structuralReportVersion)}, which is ` +
        'not a version this protocol has issued'
    );
  }
  for (const f of ['registrationAffordances', 'nameFields']) {
    if (record[f] === undefined && !current) continue;
    if (!Array.isArray(record[f])) problems.push(`${f} is ${JSON.stringify(record[f])}, not an array`);
  }
  for (const f of ['collectedNameFields', 'searchKeyNameFields']) {
    if (record[f] === undefined && !current) continue;
    if (!Number.isInteger(record[f]) || record[f] < 0) {
      problems.push(`${f} is ${JSON.stringify(record[f])}, not a count`);
    }
  }
  if (Array.isArray(record.nameFields)) {
    for (const [i, f] of record.nameFields.entries()) {
      if (!f || typeof f !== 'object') { problems.push(`nameFields[${i}] is not an object`); continue; }
      if (!['collection', 'query'].includes(f.role)) {
        problems.push(`nameFields[${i}].role is ${JSON.stringify(f.role)}, not collection or query`);
      }
      if (!Array.isArray(f.basis)) problems.push(`nameFields[${i}].basis is not an array`);
    }
    const collected = record.nameFields.filter((f) => f?.role === 'collection').length;
    const query = record.nameFields.filter((f) => f?.role === 'query').length;
    if (Number.isInteger(record.collectedNameFields) && record.collectedNameFields !== collected) {
      problems.push(`collectedNameFields is ${record.collectedNameFields}, but nameFields holds ${collected}`);
    }
    if (Number.isInteger(record.searchKeyNameFields) && record.searchKeyNameFields !== query) {
      problems.push(`searchKeyNameFields is ${record.searchKeyNameFields}, but nameFields holds ${query}`);
    }
  }

  // Amendment 60. How the report was obtained, declared.
  const source = record.structuralReportSource;
  if (current && !STRUCTURAL_REPORT_SOURCES.includes(source)) {
    problems.push(
      `records structuralReportSource ${JSON.stringify(source)}, not one of ` +
        STRUCTURAL_REPORT_SOURCES.join(' or ')
    );
  }
  if (!current && source !== undefined && !STRUCTURAL_REPORT_SOURCES.includes(source)) {
    problems.push(`records an unknown structuralReportSource ${JSON.stringify(source)}`);
  }

  if (citedFrom) {
    if (canonicalise(citedFrom.url) !== canonicalise(record.url)) {
      problems.push(
        `carries a structural report while citing ${citedFrom.id}, which is ${citedFrom.url}, not ${record.url}`
      );
    }
    // Amendment 60. Equality is the rule for a COPY of a live report. A report re-derived from
    // retained bytes is not a copy, and Amendment 59 refused it: the `c-0976` repair needed exactly
    // that - a report for evidence captured before any report existed. A reanalysis must instead
    // declare itself, name bytes that exist, and be of the same page.
    // Amendment 61. The restrictions below bind the record that PERFORMS the reanalysis. A decision
    // that inherits such a report from a reanalysis record is a copy, and is held to equality like
    // any other copy - otherwise an exclusion resting on reanalysed evidence would be read as
    // re-deriving a report for a record obtained after the boundary, which is the reanalysis
    // record itself.
    const performsReanalysis = record.recordType === RECORD_TYPES.STRUCTURAL_REANALYSIS;
    if (source === 'offline-reanalysis' && performsReanalysis) {
      // Amendment 61. The label is evidence-only, and wearing it does not exempt a decision from
      // copy-equality. A reanalysis concludes nothing: an exclusion that called itself one took
      // the branch below and skipped equality with the evidence it rests on altogether.
      if (record.status !== 'retrieved' || record.approval !== APPROVAL.NOT_APPLICABLE) {
        problems.push(
          `is recorded as ${RECORD_TYPES.STRUCTURAL_REANALYSIS} with status ` +
            `${JSON.stringify(record.status)} and approval ${JSON.stringify(record.approval)}; a ` +
            'reanalysis is evidence-only, and a decision must copy the report it rests on'
        );
      }
      if (record.fails !== undefined) {
        problems.push('is recorded as a reanalysis but carries a criterion conclusion');
      }
      // Amendment 61. A reanalysis is permitted ONLY where there is no live report to copy.
      //
      // Amendment 60 skipped equality for every offline claim, which made it a laundering route: a
      // decision could cite evidence carrying a live report that found one collected name field,
      // replace the report with an empty one, declare `offline-reanalysis`, and pass both
      // validators with zero problems. The exception exists for evidence captured before any
      // report was taken, and for nothing else.
      if (!bearsDocument(citedFrom)) {
        problems.push(`is an offline reanalysis citing ${citedFrom.id}, which holds no document to re-read`);
      }
      if (hasCompleteCurrentReport(citedFrom)) {
        problems.push(
          `is an offline reanalysis, but ${citedFrom.id} already carries a complete live report; ` +
            'a live report must be copied exactly, never re-derived offline'
        );
      }
      const citedAt = Date.parse(citedFrom.capturedAt ?? citedFrom.navigatedAt ?? citedFrom.examinedAt ?? '');
      if (!Number.isNaN(citedAt) && citedAt >= STRUCTURAL_REPORT_REQUIRED_FROM) {
        problems.push(
          `is an offline reanalysis of ${citedFrom.id}, which was obtained after the boundary and ` +
            'must therefore carry its own live report'
        );
      }
      // Amendment 61. RECOMPUTED from the retained bytes, not accepted as stated. A derivation
      // nobody re-runs is an assertion wearing a derivation's provenance - the shape of the defect
      // this whole sequence began with.
      // Amendment 61. No file, no re-reading - so no reanalysis. This guard read
      // `capturesRoot && citedFrom.file` and simply skipped recomputation when either was absent,
      // which let a fabricated empty report pass for any evidence that named no retained file.
      // The writer already refuses such a target; the trust points did not, and a record already
      // in the log is only ever seen by the trust points.
      if (!citedFrom.file) {
        problems.push(
          `is an offline reanalysis citing ${citedFrom.id}, which names no retained file, so the ` +
            'derivation cannot be re-run'
        );
      }
      if (capturesRoot && citedFrom.file) {
        const path = join(resolve(capturesRoot), 'captures', citedFrom.file);
        if (!existsSync(path)) {
          problems.push(`cites ${citedFrom.id}, whose file ${citedFrom.file} is not on disk to re-read`);
        } else {
          const bytes = readFileSync(path);
          if (createHash('sha256').update(bytes).digest('hex') !== citedFrom.htmlSha256) {
            problems.push(`cites ${citedFrom.id}, whose bytes on disk no longer match its digest`);
          } else {
            const recomputed = offlineStructuralReport(bytes);
            for (const f of FIELDS) {
              if (JSON.stringify(record[f]) !== JSON.stringify(recomputed[f])) {
                problems.push(
                  `${f} is not what re-reading ${citedFrom.file} produces; an offline report is ` +
                    'recomputed, never asserted'
                );
              }
            }
          }
        }
      }
    } else {
      for (const f of FIELDS) {
        if (record[f] === undefined && citedFrom[f] === undefined) continue;
        if (JSON.stringify(record[f]) !== JSON.stringify(citedFrom[f])) {
          problems.push(`${f} differs from ${citedFrom.id}, the evidence it rests on`);
        }
      }
      if (record.structuralReportVersion !== citedFrom.structuralReportVersion) {
        problems.push(`structuralReportVersion differs from ${citedFrom.id}`);
      }
      // A copy carries the source it copied, so an inherited reanalysis stays marked as one.
      if (record.structuralReportSource !== citedFrom.structuralReportSource) {
        problems.push(`structuralReportSource differs from ${citedFrom.id}`);
      }
    }
  } else if (source === 'offline-reanalysis') {
    problems.push('is an offline reanalysis but cites no evidence whose bytes it re-read');
  }
  return problems;
}

/** Every record and render, checked. Read by the corpus gate. */
export function structuralReportAudit(log, { capturesRoot = null } = {}) {
  const problems = [];
  // Amendment 61. An offline report is recomputed, never asserted - so the audit cannot pass one
  // without the bytes to recompute it from. Omitting the root would otherwise skip every
  // recomputation silently, which is how a fabricated report would pass.
  if (!capturesRoot && (log.attempts ?? []).some((a) =>
    a.structuralReportSource === 'offline-reanalysis' && !isSuperseded(log, a) &&
    !isDiscoverySuperseded(log, a.id))) {
    problems.push(
      'the log holds offline structural reanalyses, but no captures root was supplied to re-read ' +
        'their bytes; they cannot be checked and must not pass'
    );
  }
  const byId = new Map((log.attempts ?? []).map((a) => [a.id, a]));
  for (const a of log.attempts ?? []) {
    if (isSuperseded(log, a) || isDiscoverySuperseded(log, a.id)) continue;
    const source = a.promotedFrom ? byId.get(a.promotedFrom)
      : (a.evidenceFromAttemptId ? byId.get(a.evidenceFromAttemptId) : null);
    const carries = a.registrationAffordances !== undefined || a.nameFields !== undefined ||
      a.structuralReportVersion !== undefined;
    for (const p of structuralReportProblems(a, { citedFrom: carries ? source : null, capturesRoot })) {
      problems.push(`${a.id}: ${p}`);
    }
  }
  for (const g of log.renders ?? []) {
    for (const p of structuralReportProblems(g)) problems.push(`${g.id}: ${p}`);
  }
  return problems;
}

/**
 * Amendment 58. Does each round's policy documentation agree with the policy it actually acted on?
 *
 * A reuse record could cite `r-0083` while every permit in the round rested on `r-0084`: both real,
 * both fresh, both for the right origin, and the published account of the round would name a policy
 * nothing was decided under. So for each origin in a round, the set of checks named by the
 * reuse records must EQUAL the set of checks the round's robots-grounded decisions used.
 *
 * Equality, not containment, and that is what makes a refreshed policy representable. If a long
 * round spans a refresh, its permits cite two checks and the round must carry two reuse records -
 * one per governing interval - rather than one record pretending a single check governed
 * everything. The invariant then holds by construction instead of by hoping the round was short.
 */
export function policyAgreementProblems(log) {
  const problems = [];
  const attempts = log?.attempts ?? [];
  const permits = log?.discoveryPermits ?? [];
  const active = (a) => !isDiscoverySuperseded(log, a.id);
  const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
  const checkById = new Map((log?.robotsChecks ?? []).map((c) => [c.id, c]));

  // Every round that documents a policy at all, keyed by agency, category, version and origin.
  const scopes = new Map();
  const touch = (key) => scopes.get(key) ?? scopes.set(key, { documented: new Set(), used: new Set() }).get(key);
  const keyFor = (a, origin) => `${a.agency}\u0000${a.category}\u0000${a.candidateSetVersion}\u0000${origin}`;

  for (const a of attempts) {
    if (a.recordType !== RECORD_TYPES.POLICY_REUSE || !active(a)) continue;
    const origin = originOf(a.url);
    const check = checkById.get(a.robotsCheckId);
    if (!origin || !check) continue;
    touch(keyFor(a, origin)).documented.add(a.robotsCheckId);
  }
  if (scopes.size === 0) return problems;

  // What the round actually acted on: the permits it consumed, and any robots-grounded record.
  for (const p of permits) {
    const origin = originOf(p.url);
    if (!origin || !p.robotsCheckId) continue;
    const key = `${p.agency}\u0000${p.category}\u0000${p.candidateSetVersion}\u0000${origin}`;
    if (scopes.has(key)) scopes.get(key).used.add(p.robotsCheckId);
  }
  for (const a of attempts) {
    if (!a.robotsCheckId || !active(a)) continue;
    if (a.recordType === RECORD_TYPES.POLICY_REUSE) continue;
    const origin = originOf(a.url);
    if (!origin) continue;
    const key = keyFor(a, origin);
    if (scopes.has(key)) scopes.get(key).used.add(a.robotsCheckId);
  }

  for (const [key, { documented, used }] of scopes) {
    const [agency, category, version, origin] = key.split('\u0000');
    const where = `${agency} / ${category} v${version}, ${origin}`;
    for (const id of used) {
      if (!documented.has(id)) {
        problems.push(
          `${where} acted under robots check ${id}, which no policy-reuse record documents. If the ` +
            'policy was refreshed mid-round, each governing interval needs its own record.'
        );
      }
    }
    for (const id of documented) {
      if (used.size > 0 && !used.has(id)) {
        problems.push(
          `${where} documents robots check ${id}, but the round acted under ` +
            `${[...used].join(', ')}; the published policy is not the one it decided under`
        );
      }
    }
  }
  return problems;
}

/** Every active policy-reuse record, re-checked. Read by the corpus gate. */
export function policyReuseAudit(log) {
  const problems = [];
  for (const a of log.attempts ?? []) {
    if (a.recordType !== RECORD_TYPES.POLICY_REUSE || isDiscoverySuperseded(log, a.id)) continue;
    for (const p of policyReuseProblems(log, a)) problems.push(`${a.id}: ${p}`);
  }
  return problems;
}

/**
 * Amendment 56. What the retained bytes ACTUALLY are, re-derived from the bytes every time.
 *
 * `rootElement` and `locCount` were recorded once and then trusted. Changing them in the log to
 * `urlset` and `999` produced zero problems in either implementation, because nothing ever read the
 * document again - so the fields describing the evidence could drift from the evidence while every
 * gate reported clean. A digest proves the bytes are the bytes; it says nothing about whether the
 * log describes them correctly.
 */
export function parseRetained(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes ?? '');
  // The first element name, ignoring the XML declaration, doctype, comments and processing
  // instructions - whatever the document actually opens with.
  const stripped = text
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, ' ');
  const rootElement = (/<\s*([A-Za-z][\w:.-]*)/.exec(stripped) ?? [])[1] ?? null;
  const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((x) => x[1]);
  return { rootElement, locs, locCount: locs.length, text };
}

/** The root elements a sitemap may legitimately have, per the sitemaps.org schema. */
export const SITEMAP_ROOT_ELEMENTS = Object.freeze(['sitemapindex', 'urlset']);

/**
 * Amendment 56. Is this retained resource a sitemap at all?
 *
 * A served HTTP 200 `text/html` challenge page - "Just a moment..." - was accepted as support for a
 * sitemap `no-candidates` judgement by both implementations. The digest matched, the file was on
 * disk, the permit was accounted for, and the document was not a sitemap. So a judgement that the
 * sitemap method found nothing rested on a document that never listed anything.
 *
 * Returns the reasons it is NOT a valid served sitemap representation, so an empty list is the only
 * thing that permits a sitemap content judgement.
 */
export function sitemapRepresentationProblems(entry, bytes) {
  const problems = [];
  if (!entry) return ['there is no retained resource to check'];
  if (!isServedStatus(entry.httpStatus)) {
    problems.push(`HTTP ${entry.httpStatus} is not a served status, so this is no representation of a sitemap`);
  }
  const type = String(entry.contentType ?? '').toLowerCase().split(';')[0].trim();
  if (!(type === 'application/xml' || type === 'text/xml' || type.endsWith('+xml'))) {
    problems.push(`content type ${JSON.stringify(entry.contentType ?? null)} is not XML`);
  }
  const { rootElement, locs } = parseRetained(bytes);
  if (!SITEMAP_ROOT_ELEMENTS.includes(String(rootElement ?? '').toLowerCase())) {
    problems.push(
      `the document opens with <${rootElement ?? '?'}>, not one of ${SITEMAP_ROOT_ELEMENTS.join(' or ')}`
    );
  }
  // Every `loc` must be an absolute http(s) URL; a sitemap of nonsense is not a sitemap.
  for (const l of locs.slice(0, 50)) {
    if (!/^https?:\/\//i.test(l)) problems.push(`a loc entry is not an absolute http(s) URL: ${l}`);
  }
  return problems;
}

export function recordFetch(log, fetched) {
  (log.fetches ??= []);
  const record = { ...fetched, id: `f-${String(log.fetches.length + 1).padStart(4, '0')}` };
  log.fetches.push(record);
  return record;
}

export function findFetch(log, id) {
  return (log.fetches ?? []).find((f) => f.id === id) ?? null;
}

/**
 * The retained bytes, re-verified against the registry: the file is where it says, inside
 * `fetched/`, and its digest and length are what was recorded. Same failure direction as the render
 * check - evidence that cannot be re-verified is not evidence.
 */
export function assertFetchEvidenceUsable(log, { fetchId, capturesRoot }) {
  const problems = [];
  const entry = findFetch(log, fetchId);
  if (!entry) return [`${fetchId} is not in the fetch registry`];
  const file = entry.fetchFile;
  if (!file || typeof file !== 'string') return [`${entry.id} names no fetchFile`];
  if (basename(file) !== file) {
    problems.push(`${entry.id} names ${JSON.stringify(file)}, which is not a plain file name`);
  }
  if (!capturesRoot) return [...problems, `${entry.id} cannot be verified: no capture root was supplied`];
  const path = join(resolve(capturesRoot), FETCHED_DIR, file);
  if (!existsSync(path)) {
    problems.push(`${entry.id} names ${file}, which is not on disk in ${FETCHED_DIR}/`);
    return problems;
  }
  const bytes = readFileSync(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (entry.fetchedSha256 !== digest) {
    problems.push(`${entry.id} records digest ${entry.fetchedSha256}, but ${file} hashes to ${digest}`);
  }
  if (entry.fetchedBytes !== bytes.length) {
    problems.push(`${entry.id} records ${entry.fetchedBytes} bytes, but ${file} is ${bytes.length}`);
  }
  // Amendment 56. The DESCRIPTION of the bytes, re-derived from the bytes. A digest proves the
  // bytes have not changed; it does not stop the log describing them wrongly.
  const parsed = parseRetained(bytes);
  if (entry.rootElement !== undefined && entry.rootElement !== parsed.rootElement) {
    problems.push(
      `${entry.id} records rootElement ${JSON.stringify(entry.rootElement)}, but ${file} opens ` +
        `with ${JSON.stringify(parsed.rootElement)}`
    );
  }
  if (entry.locCount !== undefined && entry.locCount !== parsed.locCount) {
    problems.push(
      `${entry.id} records ${entry.locCount} loc entries, but ${file} declares ${parsed.locCount}`
    );
  }
  return problems;
}

/**
 * Every request in the log, audited against the floor it was made under.
 *
 * Amendment 65. Amendment 64 moved this check to where the traffic is and left three holes in it,
 * each reproduced before being closed:
 *
 *   1. Equal timestamps passed. The search for the preceding request used `t < at`, so two
 *      requests recorded in the SAME second had no predecessor and were never compared - and
 *      simultaneous requests are worse than one second apart, not better. The comparison is now
 *      `t <= at` with the request's own entry excluded by identity, so a tie is caught and a
 *      request is never measured against itself.
 *   2. Crawl-delay was not audited at all. A policy asking for ten seconds was satisfied by six,
 *      because only the five-second floor was enforced. The required gap is now the greater of the
 *      study's floor and whatever the governing recorded policy asks for.
 *   3. The boundary stood at 09:30:00Z while the freeze commit was created at 09:09:56Z, leaving a
 *      twenty-minute window after the freeze unverified. It now begins at 09:04:00Z - before the
 *      freeze, and after the two sitemap fetches at 09:03 that stay grandfathered and disclosed.
 *
 * A robots.txt fetch is audited too. It is a request to the host like any other, and the 3000 ms
 * between `r-0088` and `r-0089` was invisible for exactly the reason a plain-resource fetch was
 * invisible before Amendment 64: nothing counted it. The floor is deliberately GLOBAL rather than
 * per-origin, because that is what this study publishes in `provenance.json`; two consecutive
 * requests to different hosts are still two requests under that commitment.
 */
export function pacingProblems(log) {
  const problems = [];
  const fetches = log.fetches ?? [];
  const attempts = log.attempts ?? [];
  const robots = log.robotsChecks ?? [];

  // Amendment 66. Every request is both a SUBJECT of the audit and a PREDECESSOR for the next one.
  //
  // Navigation entries carried no `url`, and the loop below skipped any entry without one, so a
  // page navigation was only ever a predecessor and never audited itself: a robots fetch followed
  // one second later by a navigation passed both implementations with zero problems. Each entry now
  // carries the URL that was requested, and nothing is exempt from being measured.
  const requests = [
    ...attempts
      .filter((a) => a.navigationPerformed !== false && !a.promotedFrom && !a.fetchId)
      .map((a) => ({
        key: `attempt:${a.id}`, at: Date.parse(a.navigatedAt ?? a.capturedAt ?? ''),
        url: a.finalUrl ?? a.url, what: a.id, kind: 'navigation',
      })),
    ...fetches.map((f) => ({
      key: `fetch:${f.id}`, at: Date.parse(f.fetchedAt ?? ''), url: f.url, what: f.id, kind: 'fetch',
    })),
    ...robots.map((c) => ({
      key: `robots:${c.id}`, at: Date.parse(c.fetchedAt ?? ''), url: c.url, what: c.id,
      kind: 'robots', checkId: c.id,
    })),
  ].filter((e) => !Number.isNaN(e.at));

  /**
   * The crawl-delay the policy governing this origin asked for, as KNOWN BEFORE this request.
   *
   * Amendment 66. This used `<= at`, so a robots refresh governed itself: a refresh fetched six
   * seconds into a ten-second crawl-delay was audited against the policy it had just brought back,
   * and a refreshed file that dropped the delay therefore excused the request that fetched it.
   * The delay a request must honour is the one in force when it was made, which cannot be the one
   * it is about to learn. A check is excluded from governing its own retrieval, and so is any
   * check recorded at the same instant.
   */
  const requiredGap = (at, url, selfCheckId = null) => {
    let origin = null;
    try { origin = new URL(url).origin; } catch { origin = null; }
    const governing = robots
      .filter((c) => c.origin === origin && !Number.isNaN(Date.parse(c.fetchedAt ?? '')))
      .filter((c) => (selfCheckId ? c.id !== selfCheckId && Date.parse(c.fetchedAt) < at : Date.parse(c.fetchedAt) <= at))
      .sort((x, y) => Date.parse(x.fetchedAt) - Date.parse(y.fetchedAt))
      .pop();
    const delays = (governing?.policy?.groups ?? [])
      .map((g) => g?.crawlDelay)
      .filter((d) => typeof d === 'number' && d > 0);
    const asked = delays.length ? Math.max(...delays) * 1000 : 0;
    return Math.max(POLICY.minDelayBetweenNavigationsMs, asked);
  };

  for (const entry of requests) {
    if (entry.at < FETCH_PACING_REQUIRED_FROM) continue;
    if (typeof entry.url !== 'string' || !/^https?:\/\//.test(entry.url)) {
      problems.push(`${entry.what} records no usable URL, so its request cannot be audited for pacing`);
      continue;
    }
    // `<=`, and never against itself: a tie is a breach, not an absence of a predecessor.
    const previous = requests
      .filter((other) => other.key !== entry.key && other.at <= entry.at)
      .map((other) => other.at)
      .sort((x, y) => x - y)
      .pop();
    if (previous === undefined) continue;
    const gap = entry.at - previous;
    const required = requiredGap(entry.at, entry.url, entry.checkId ?? null);
    if (gap < required) {
      const why = required > POLICY.minDelayBetweenNavigationsMs
        ? `the governing policy asks for at least ${required} ms between requests`
        : `the policy requires at least ${required} ms between requests`;
      problems.push(`${entry.what} (${entry.url}) was fetched ${gap} ms after the previous request; ${why}`);
    }
  }
  return problems;
}

/**
 * Every retained fetch and every record citing one, checked together. Read by the corpus gate and
 * mirrored in the sealer.
 */
export function checkFetchLedger(log, fetchedDir) {
  const problems = [];
  const root = fetchedDir ? resolve(fetchedDir) : null;
  const fetches = log.fetches ?? [];
  const attempts = log.attempts ?? [];
  const seen = new Set();
  problems.push(...pacingProblems(log));
  for (const f of fetches) {
    const where = `${f.id} (${f.url})`;
    if (seen.has(f.id)) problems.push(`${f.id} appears more than once in the fetch registry`);
    seen.add(f.id);
    for (const [field, test] of [
      ['url', (v) => typeof v === 'string' && /^https?:\/\//.test(v)],
      ['fetchFile', (v) => typeof v === 'string' && v.length > 0],
      ['fetchedSha256', (v) => /^[0-9a-f]{64}$/.test(v ?? '')],
      ['fetchedBytes', (v) => Number.isInteger(v) && v >= 0],
      ['fetchedAt', (v) => typeof v === 'string' && /Z$/.test(v)],
      ['httpStatus', (v) => Number.isInteger(v)],
    ]) {
      if (!test(f[field])) problems.push(`${where} records no usable ${field}`);
    }
    // `contentType` may legitimately be absent on a non-2xx response, where there is no body.
    if (f.httpStatus >= 200 && f.httpStatus <= 299 && typeof f.contentType !== 'string') {
      problems.push(`${where} was served but records no contentType`);
    }
    // The permit that authorised the request, as the render registry requires of a render.
    const permit = (log.discoveryPermits ?? []).find((x) => x.id === f.permitId);
    if (!f.permitId) problems.push(`${where} names no permit`);
    else if (!permit) problems.push(`${where} names permit ${f.permitId}, which does not exist`);
    else if (permit.url !== f.url) {
      problems.push(`${where} names permit ${permit.id}, which authorised ${permit.url}`);
    }
    if (root) for (const p of assertFetchEvidenceUsable(log, { fetchId: f.id, capturesRoot: dirname(root) })) {
      problems.push(p);
    }
    // A registry entry no record cites is evidence from nowhere, exactly as for a render.
    if (!attempts.some((a) => a.fetchId === f.id)) {
      problems.push(`${where} has no record citing it`);
    }
  }
  // Amendment 56. Bytes in the retained tree that no registry entry names. An extra
  // `fetched/orphan.bin` produced zero problems in either implementation: retained bytes nothing
  // accounts for are either evidence from nowhere or traffic nobody recorded, and the rendered
  // tree has been checked for exactly this since selection-v1.0.26.
  if (root && existsSync(root)) {
    const named = new Set(fetches.map((f) => f.fetchFile));
    for (const file of readdirSync(root)) {
      if (!named.has(file)) {
        problems.push(
          `${file} is in ${FETCHED_DIR}/ but no retained resource names it. Bytes nothing ` +
            'accounts for are either evidence from nowhere or a request nobody recorded'
        );
      }
    }
  }

  // And the converse: a record citing a fetch that is not registered.
  for (const a of attempts) {
    if (!a.fetchId) continue;
    const entry = findFetch(log, a.fetchId);
    if (!entry) { problems.push(`${a.id} cites ${a.fetchId}, which is not in the fetch registry`); continue; }
    // Amendment 56. A sitemap CONTENT judgement requires a valid served sitemap representation.
    // A served HTML challenge page was accepted as support for `no-candidates`, so a judgement
    // that the method found nothing rested on a document that never listed anything.
    if (['candidates-found', 'no-candidates'].includes(a.outcome) && a.discoveryKind === 'sitemap') {
      const path = root ? join(root, entry.fetchFile ?? '') : null;
      const bytes = path && entry.fetchFile && basename(entry.fetchFile) === entry.fetchFile &&
        existsSync(path) ? readFileSync(path) : null;
      if (bytes === null) {
        problems.push(`${a.id} judges sitemap content, but ${entry.id}'s bytes are not readable here`);
      } else {
        for (const p of sitemapRepresentationProblems(entry, bytes)) {
          problems.push(`${a.id} records ${a.outcome} from ${entry.id}, which is not a sitemap: ${p}`);
        }
      }
    }
    if (canonicalise(entry.url) !== canonicalise(a.url)) {
      problems.push(`${a.id} cites ${entry.id}, which is of ${entry.url}, not ${a.url}`);
    }
    for (const [field, label] of [['fetchedSha256', 'digest'], ['fetchedBytes', 'byte length'],
      ['contentType', 'content type']]) {
      if (a[field] !== undefined && a[field] !== entry[field]) {
        problems.push(
          `${a.id} records ${label} ${JSON.stringify(a[field])} but cites ${entry.id}, whose ` +
            `${label} is ${JSON.stringify(entry[field])}`
        );
      }
    }
  }
  return problems;
}

/**
 * Navigation and internal-search records whose evidence is a plain fetch, not a rendered DOM.
 *
 * selection-v1.0.24. The backlog is DERIVED rather than written down, because a list I counted by
 * hand is a list that goes stale the moment a record is added. A record satisfies the rule either
 * by carrying rendered evidence itself or by having a rendered follow-up that names it through
 * `rendersDiscoveryId` - the original is preserved, never edited, so both forms must count.
 *
 * Only HTML pages are in scope. A PDF or a DOCX has no DOM to render, and a plain fetch is the
 * right evidence for it.
 */
const NON_HTML = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|xml|json|zip|jpe?g|png|gif|svg)$/i;

/**
 * The outcomes that are judgements about a page's CONTENT, and so rest on the DOM.
 *
 * `unavailable` and `disallowed` are not among them, and neither are the two attrition outcomes
 * that describe a refusal. Plain retrieval is the authoritative evidence for a status code and for
 * a robots decision - there is no DOM behind a 404, and a `Disallow` means there must not be one.
 * `retrieval-inconclusive` IS here: it says this method could not read the page, which is precisely
 * the claim a rendered DOM settles.
 */
const CONTENT_OUTCOMES = Object.freeze(['candidates-found', 'no-candidates', 'retrieval-inconclusive']);

/**
 * A judgement made on rendered evidence, keyed by the page and the category it judges.
 *
 * selection-v1.0.25. The backlog used to clear a record the moment any later record NAMED it. That
 * is how `d-0301` left the backlog while still reading `retrieval-inconclusive`: the render named
 * it, and no account-registration judgement was ever made about it. Naming is not answering. A
 * record is answered only by a judgement, for its own category, resting on a render of its page.
 */
function renderedJudgements(log) {
  const answered = new Set();
  const byId = new Map(log.attempts.map((a) => [a.id, a]));
  for (const a of log.attempts) {
    if (a.status !== 'discovery') continue;
    if (!a.renderId) continue;
    if (!JUDGEMENT_OUTCOMES.includes(a.outcome)) continue;
    if (isDiscoverySuperseded(log, a.id)) continue;
    // selection-v1.0.26. The EXACT record, named. Keying by canonical URL and category alone meant
    // a judgement about a shared third-party form under one agency cleared another agency's
    // backlog entry for the same page - and the two agencies' rounds are different work with
    // different provenance. A judgement answers the record it names, and only if it is the same
    // agency, category, round and page.
    const target = byId.get(a.answersDiscoveryId);
    if (!target) continue;
    if (target.agency !== a.agency || target.category !== a.category) continue;
    if (target.candidateSetVersion !== a.candidateSetVersion) continue;
    if (canonicalise(target.url) !== canonicalise(a.url)) continue;
    answered.add(target.id);
  }
  return answered;
}

/**
 * The discovery record ids bound to a CURRENT candidate set.
 *
 * selection-v1.0.26. The backlog counted records bound only to SUPERSEDED sets - rounds that were
 * rejected and redone, whose evidence the corpus no longer rests on. Thirty-four of the ninety-eight
 * were withdrawn work, so the obligation was overstated by a third and would have sent the scan back
 * to re-render pages nothing depends on.
 */
function boundToCurrentSet(log) {
  const ids = new Set();
  for (const set of Object.values(log.candidateSets ?? {})) {
    for (const id of set.discoveryRecordIds ?? []) ids.add(id);
  }
  return ids;
}

/**
 * URLs a render attempt found to be unreachable within the robots policy.
 *
 * selection-v1.0.28. Without this the obligation would be unsatisfiable: a page that redirects to a
 * disallowed target can never be rendered, so demanding its render would withhold the corpus draft
 * for ever. A recorded refusal discharges the obligation as ATTRITION rather than as a judgement -
 * the page was not read, and the record says why and where it stopped.
 *
 * Keyed on the explicit `renderRefused` flag rather than inferred from an outcome, so an ordinary
 * `disallowed` record cannot quietly excuse a page nobody tried to render.
 */
/**
 * Is this `renderRefused` record actually the record of a guarded retrieval?
 *
 * selection-v1.0.29. The flag was trusted. Adding `renderRefused: true` to an ordinary record -
 * `d-0018`, one line, no chain, no permit, no navigation - removed it from the backlog, and both
 * ledgers reported zero problems. A boolean that discharges an obligation has to carry the evidence
 * that the obligation was discharged, or it is just a way of saying "skip this".
 */
export function renderRefusalProblems(log, attempt) {
  const problems = [];
  const where = attempt.id ?? '(an unidentified record)';
  const chain = attempt.redirectChain;
  if (!Array.isArray(chain) || chain.length === 0) {
    problems.push(`${where} claims renderRefused with no redirect chain`);
  }
  if (attempt.navigationPerformed === false) {
    problems.push(`${where} claims renderRefused but records that no navigation occurred`);
  }
  if (!isoUtcish(attempt.navigatedAt)) {
    problems.push(`${where} claims renderRefused with no navigation timestamp`);
  }
  if (!attempt.permitId) {
    problems.push(`${where} claims renderRefused with no permit; the original URL was requested`);
  } else {
    const permit = (log.discoveryPermits ?? []).find((p) => p.id === attempt.permitId);
    if (!permit) problems.push(`${where} names permit ${attempt.permitId}, which does not exist`);
    else {
      if (!permit.consumedAt) problems.push(`${where} names permit ${permit.id}, which is not consumed`);
      for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
        ['candidateSetVersion', 'round']]) {
        if (permit[field] !== attempt[field]) {
          problems.push(
            `${where} names permit ${permit.id}, which covers ${label} ` +
              `${JSON.stringify(permit[field])}, not ${JSON.stringify(attempt[field])}`
          );
        }
      }
      if (permit.url !== attempt.url) {
        problems.push(`${where} names permit ${permit.id}, which authorised ${permit.url}`);
      }
    }
  }
  if (Array.isArray(chain) && chain.length > 0) {
    // Continuous: the first hop leaves the record's own URL, and each later hop leaves where the
    // previous one arrived. A chain that does not join up describes no single navigation.
    if (canonicalise(chain[0].from ?? '') !== canonicalise(attempt.url)) {
      problems.push(`${where}'s chain starts at ${chain[0].from}, not at ${attempt.url}`);
    }
    for (let i = 1; i < chain.length; i++) {
      if (canonicalise(chain[i].from ?? '') !== canonicalise(chain[i - 1].to ?? '')) {
        problems.push(
          `${where}'s chain is not continuous: hop ${i + 1} leaves ${chain[i].from}, but hop ${i} ` +
            `arrived at ${chain[i - 1].to}`
        );
      }
    }
    const final = chain[chain.length - 1];
    if (final.allowed !== false) {
      problems.push(`${where} claims renderRefused but its last hop was allowed`);
    }
    for (const [i, hop] of chain.slice(0, -1).entries()) {
      if (hop.allowed !== true) {
        problems.push(`${where}'s hop ${i + 1} was refused, so the chain should have stopped there`);
      }
    }
  }
  return problems;
}

/**
 * Is this `renderBarred` record the record of both modes being barred?
 *
 * selection-v1.0.32. The terminal case: a page that bars headless AND headed retrieval cannot be read
 * by this instrument, so its render obligation can never be discharged by a judgement. That makes it
 * the second flag able to retire a backlog entry, and the lesson from the first one - a bare boolean
 * removed a record from the backlog with both ledgers silent - applies before it is used, not after.
 *
 * It requires TWO navigations: a headless observation that was barred, and this headed one, each with
 * its own consumed permit. One permit cannot evidence two requests, and a single barred attempt is
 * not a terminal finding - it is what the fallback exists to answer.
 */
export function renderBarredProblems(log, attempt) {
  const problems = [];
  const where = attempt.id ?? '(an unidentified record)';
  if (attempt.outcome !== 'retrieval-blocked') {
    problems.push(`${where} claims renderBarred but records ${JSON.stringify(attempt.outcome)}`);
  }
  // selection-v1.0.33: derived from the two REGISTERED renders, not read off `attemptedModes`. A
  // terminal claim resting on a summary could be made true by editing the summary.
  const ownRender = findRender(log, attempt.renderId);
  const priorRender = findRender(log, log.attempts.find((a) => a.id === attempt.followsDiscoveryId)?.renderId);
  if (!ownRender || !priorRender) {
    problems.push(`${where} claims renderBarred without two registered renders behind it`);
  } else {
    if (priorRender.browserMode !== 'headless' || ownRender.browserMode !== 'headed') {
      problems.push(
        `${where} claims renderBarred from a ${priorRender.browserMode} and a ${ownRender.browserMode} ` +
          'render; the two modes must be headless then headed'
      );
    }
    for (const [render, label] of [[priorRender, 'headless'], [ownRender, 'headed']]) {
      if ((render.accessBarriers ?? []).length === 0) {
        problems.push(`${where} claims renderBarred but its ${label} render recorded no access barrier`);
      }
    }
  }
  if (Array.isArray(attempt.attemptedModes) && attempt.attemptedModes.some((m) => m.error)) {
    problems.push(
      `${where} claims renderBarred, but one attempt failed to launch. An environment failure is not ` +
        'evidence that the site blocked access.'
    );
  }
  const earlier = log.attempts.find((a) => a.id === attempt.followsDiscoveryId);
  if (!attempt.followsDiscoveryId) {
    problems.push(`${where} claims renderBarred without naming the headless observation it follows`);
  } else if (!earlier) {
    problems.push(`${where} follows ${attempt.followsDiscoveryId}, which does not exist`);
  } else {
    if (earlier.outcome !== 'retrieval-blocked') {
      problems.push(`${where} follows ${earlier.id}, which was not access-barred`);
    }
    if (canonicalise(earlier.url) !== canonicalise(attempt.url)) {
      problems.push(`${where} follows ${earlier.id}, which is a different page`);
    }
    if (!earlier.permitId || !attempt.permitId || earlier.permitId === attempt.permitId) {
      problems.push(
        `${where} and ${earlier.id} must each name their own consumed permit; two requests are not ` +
          'authorised by one'
      );
    }
    for (const id of [earlier.permitId, attempt.permitId]) {
      const permit = (log.discoveryPermits ?? []).find((p) => p.id === id);
      if (!permit) problems.push(`${where} rests on permit ${id}, which does not exist`);
      else if (!permit.consumedAt) problems.push(`${where} rests on permit ${id}, which is not consumed`);
    }
  }
  return problems;
}

/**
 * The answer link a correction chain carries, recovered from the whole chain.
 *
 * selection-v1.0.35. `correct-discovery` copied nothing: superseding `d-0373` to give it a proper
 * note produced `d-0374` with no `answersDiscoveryId`, and `d-0018`'s obligation silently reopened.
 * It failed safe that once - the backlog grew rather than shrinking - but the rule cannot be "copy
 * from the immediate target" either, because a chain three links long would lose the link at the
 * second correction.
 *
 * So the link is a property of the CHAIN. It is recovered by walking every supersession backwards,
 * and the active record must carry exactly the one the chain established. A chain that never had one
 * - the NZSIS `d-0301` -> `d-0308` -> `d-0309` chain, written before judgements carried answers -
 * stays valid, because there is nothing for it to have lost.
 */
export function answerChain(log, attempt) {
  const chain = [];
  const answers = new Set();
  const seen = new Set();
  let current = attempt;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current.id);
    if (current.answersDiscoveryId) answers.add(current.answersDiscoveryId);
    current = current.supersedesDiscoveryId
      ? log.attempts.find((a) => a.id === current.supersedesDiscoveryId)
      : null;
  }
  // Amendment 48. Answers in ONE supersession lineage are one obligation, not several.
  //
  // When the answered record is itself withdrawn and replaced, a later correction resolves its link
  // forward: `d-0685` and `d-0687` answer `d-0684`, and `d-0688` answers `d-0686`, which supersedes
  // it. Counting the two names as a conflict reported that a chain resolving a single obligation
  // resolved two. The obligation is identified by the HEAD of its own lineage, so the links collapse
  // to one; genuinely unrelated answers still conflict.
  // Followed through EVIDENCE successors only - an observation or a reclassification - never a
  // judgement. A judgement may both answer and supersede the same plain record, which is the role
  // distinction selection-v1.0.27 drew, so walking forward indiscriminately lands on the answering
  // record itself and reports that a chain answers its own conclusion.
  const headOf = (id) => {
    const walked = new Set();
    let current = id;
    for (;;) {
      if (!current || walked.has(current)) return current;
      walked.add(current);
      const next = log.attempts.find(
        (a) => a.supersedesDiscoveryId === current &&
          [RECORD_TYPES.OBSERVATION, RECORD_TYPES.RECLASSIFICATION].includes(a.recordType)
      );
      if (!next) return current;
      current = next.id;
    }
  };
  const obligations = new Set([...answers].map(headOf));
  return {
    chain,
    answers: [...answers],
    // The link a further correction must inherit is the one in force: the head of the lineage.
    stable: obligations.size === 1 ? [...obligations][0] : null,
    conflict: obligations.size > 1,
  };
}

/**
 * Every headed observation must have exactly one valid headless predecessor./**
 * Every headed observation must have exactly one valid headless predecessor.
 *
 * selection-v1.0.33. The fallback relationship was checked only where it was WRITTEN, and once more
 * when `renderBarred` made it terminal. A SUCCESSFUL headed render was trusted: deleting
 * `followsDiscoveryId` from `d-0367`, pointing it at `d-0350` - a different page, category and round -
 * or deleting `attemptedModes` each left both validators reporting zero problems. A second navigation
 * of the same page is justified only by the barred first one, so the justification has to be checked
 * wherever the record is relied on.
 *
 * `attemptedModes` is DERIVED here rather than believed. It is a summary of the two renders, and a
 * summary that can disagree with what it summarises is a second source of truth.
 */
export function headedObservationProblems(log, attempt) {
  const problems = [];
  const where = attempt.id ?? '(an unidentified record)';
  const render = findRender(log, attempt.renderId);
  if (!render) return problems; // reported elsewhere

  const predecessor = log.attempts.find((a) => a.id === attempt.followsDiscoveryId);
  if (!attempt.followsDiscoveryId) {
    problems.push(
      `${where} is a headed observation with no headless predecessor; a second navigation of one page ` +
        'is justified only by the barred first one'
    );
    return problems;
  }
  if (!predecessor) {
    problems.push(`${where} follows ${attempt.followsDiscoveryId}, which does not exist`);
    return problems;
  }
  if (predecessor.recordType !== RECORD_TYPES.OBSERVATION) {
    problems.push(`${where} follows ${predecessor.id}, which is not an observation`);
  }
  if (predecessor.outcome !== 'retrieval-blocked') {
    problems.push(`${where} follows ${predecessor.id}, which was not access-barred; there was nothing to retry`);
  }
  if (isDiscoverySuperseded(log, predecessor.id)) {
    problems.push(`${where} follows ${predecessor.id}, which has been superseded`);
  }
  for (const [field, label] of [['agency', 'agency'], ['category', 'category'],
    ['candidateSetVersion', 'round']]) {
    if (predecessor[field] !== attempt[field]) {
      problems.push(
        `${where} follows ${predecessor.id}, which is ${label} ${JSON.stringify(predecessor[field])}, ` +
          `not ${JSON.stringify(attempt[field])}`
      );
    }
  }
  if (canonicalise(predecessor.url ?? '') !== canonicalise(attempt.url)) {
    problems.push(`${where} follows ${predecessor.id}, which is ${predecessor.url}, not ${attempt.url}`);
  }

  // Exactly one follower. Two headed attempts after one bar would be a second retry.
  const followers = log.attempts.filter(
    (a) => a.followsDiscoveryId === predecessor.id && !isDiscoverySuperseded(log, a.id)
  );
  if (followers.length > 1) {
    problems.push(
      `${predecessor.id} is followed by ${followers.length} active records ` +
        `(${followers.map((a) => a.id).join(', ')}); one barred attempt gets one retry`
    );
  }

  const earlierRender = findRender(log, predecessor.renderId);
  if (!earlierRender) {
    problems.push(`${where} follows ${predecessor.id}, which cites no registered render`);
  } else {
    if (earlierRender.browserMode !== 'headless') {
      problems.push(`${where} follows a render in ${JSON.stringify(earlierRender.browserMode)} mode, not headless`);
    }
    // The bar must be an AUTOMATION barrier. A sign-in wall is a finding about what the public can
    // read, and retrying it in a visible window would not change that.
    if (!needsHeadedFallback(earlierRender)) {
      problems.push(
        `${where} follows ${predecessor.id}, whose barriers ` +
          `(${(earlierRender.accessBarriers ?? []).join(', ') || 'none'}) do not warrant a headed retry`
      );
    }
  }
  if (render.browserMode !== 'headed') {
    problems.push(`${where} claims to be a headed observation but its render is ${JSON.stringify(render.browserMode)}`);
  }

  // Two navigations, two permits, in order.
  if (!predecessor.permitId || !attempt.permitId || predecessor.permitId === attempt.permitId) {
    problems.push(`${where} and ${predecessor.id} must each name their own permit; two requests are not authorised by one`);
  } else {
    const permits = log.discoveryPermits ?? [];
    const earlierPermit = permits.find((p) => p.id === predecessor.permitId);
    const thisPermit = permits.find((p) => p.id === attempt.permitId);
    for (const [permit, id] of [[earlierPermit, predecessor.permitId], [thisPermit, attempt.permitId]]) {
      if (!permit) problems.push(`${where} rests on permit ${id}, which does not exist`);
      else if (!permit.consumedAt) problems.push(`${where} rests on permit ${id}, which is not consumed`);
    }
    // The headless attempt is consumed and recorded BEFORE the headed permit is issued.
    const ms = (v) => { const t = Date.parse(v ?? ''); return Number.isNaN(t) ? null : t; };
    const earlierConsumed = ms(earlierPermit?.consumedAt);
    const thisIssued = ms(thisPermit?.issuedAt);
    if (earlierConsumed !== null && thisIssued !== null && thisIssued < earlierConsumed) {
      problems.push(
        `${where}'s permit was issued at ${thisPermit.issuedAt}, before ${predecessor.id}'s was ` +
          `consumed at ${earlierPermit.consumedAt}; the first attempt is recorded before the second is authorised`
      );
    }
    const earlierNav = ms(predecessor.navigatedAt);
    const thisNav = ms(attempt.navigatedAt);
    if (earlierNav !== null && thisNav !== null && thisNav <= earlierNav) {
      problems.push(`${where} navigated at ${attempt.navigatedAt}, not after ${predecessor.id} at ${predecessor.navigatedAt}`);
    }
  }

  // `attemptedModes` is a summary of the two renders. It may match them or be absent; it may not
  // disagree, because then nothing says which of the two governs.
  if (attempt.attemptedModes === undefined) {
    problems.push(
      `${where} records no attemptedModes. A headed observation carries the summary of both attempts, ` +
        'so a reader can see the pair without reconstructing it.'
    );
  }
  if (attempt.attemptedModes !== undefined && earlierRender) {
    const derived = [
      { browserMode: 'headless', httpStatus: earlierRender.httpStatus ?? null, accessBarriers: earlierRender.accessBarriers ?? [] },
      { browserMode: 'headed', httpStatus: render.httpStatus ?? null, accessBarriers: render.accessBarriers ?? [] },
    ];
    const stored = attempt.attemptedModes;
    if (!Array.isArray(stored) || stored.length !== derived.length) {
      problems.push(`${where} records ${Array.isArray(stored) ? stored.length : 'no'} attempted mode(s); the two renders describe ${derived.length}`);
    } else {
      for (const [i, want] of derived.entries()) {
        const got = stored[i] ?? {};
        if (got.browserMode !== want.browserMode) {
          problems.push(`${where}'s attempted mode ${i + 1} is ${JSON.stringify(got.browserMode)}, but its render was ${want.browserMode}`);
        }
        if ((got.httpStatus ?? null) !== want.httpStatus) {
          problems.push(`${where}'s attempted mode ${i + 1} records HTTP ${got.httpStatus}, but its render recorded ${want.httpStatus}`);
        }
        if (JSON.stringify(got.accessBarriers ?? []) !== JSON.stringify(want.accessBarriers)) {
          problems.push(`${where}'s attempted mode ${i + 1} disagrees with its render about the access barriers`);
        }
      }
    }
  }
  return problems;
}

/** URLs both browser modes were barred from, so no judgement can ever rest on them. */
function renderBarredUrls(log) {
  const urls = new Set();
  for (const a of log.attempts) {
    if (a.status !== 'discovery' || a.renderBarred !== true) continue;
    if (isDiscoverySuperseded(log, a.id)) continue;
    if (renderBarredProblems(log, a).length > 0) continue;
    urls.add(canonicalise(a.url));
  }
  return urls;
}

/**
 * Conditions under which a refusal can never be retried, whatever any policy later says.
 *
 * A loop and an unusable target are properties of the redirect itself. Everything else depends on a
 * policy, and a policy can be read again.
 */
const TERMINAL_REFUSAL = /more than \d+ redirects|not a usable URL/;

/**
 * URLs a render attempt found unreachable within the robots policy, and permanently so.
 *
 * selection-v1.0.29. A refusal for a MISSING policy used to discharge the URL for good: recording a
 * fresh policy that permitted the destination did not bring it back. Missing, stale and
 * unestablished are not terminal - they are reasons to fetch a policy and try again - so the final
 * hop is re-evaluated against the policy in force NOW. Only a confirmed disallow under a fresh
 * policy, a loop, or an unusable target discharges the obligation.
 */
function renderRefusedUrls(log) {
  const urls = new Set();
  for (const a of log.attempts) {
    if (a.status !== 'discovery' || a.renderRefused !== true) continue;
    if (isDiscoverySuperseded(log, a.id)) continue;
    if (renderRefusalProblems(log, a).length > 0) continue; // an unevidenced flag discharges nothing
    const chain = a.redirectChain;
    const final = chain[chain.length - 1];
    if (TERMINAL_REFUSAL.test(final.reason ?? '')) { urls.add(canonicalise(a.url)); continue; }

    let target = null;
    try { target = new URL(final.to); } catch { urls.add(canonicalise(a.url)); continue; }
    const check = findRobotsCheck(log, target.origin);
    // No policy, or one too old to rely on: the page is not unreachable, it is unchecked.
    if (!check || !robotsCheckIsFresh(check)) continue;
    const verdict = evaluatePolicy(check, target.pathname + target.search, 'chromium');
    // `unestablished` says we could not read a policy, not that the host refused us.
    if (verdict.unestablished === true) continue;
    // And a policy that now permits the destination means the render should be retried.
    if (verdict.allowed) continue;
    urls.add(canonicalise(a.url));
  }
  return urls;
}

/**
 * Every rendered observation in a round must carry exactly one judgement of its own.
 *
 * Amendment 39. `renderBacklog` covers the RETROSPECTIVE obligation - plain-retrieval records that
 * predate the registry - and nothing covered the forward one. A `render-discovery` writes an
 * observation whose outcome is `rendered`, which concludes nothing by design; the conclusion is a
 * separate `classify-render` record. Nothing required that second record to exist. In the NZDF
 * account-registration round sixteen rendered observations sat in the log while `status` reported
 * the set as the only outstanding work, so a set could be locked and approved over evidence that
 * had been retrieved and never read - the precise failure `d-0306` is remembered for, except
 * silent.
 *
 * Scoped to one agency, category and round, and matched on the whole binding rather than on the
 * answer link alone: a judgement that names the right record but the wrong render, URL or round is
 * not a judgement of this observation. `retrieval-blocked` needs no judgement - nothing was read,
 * so there is nothing to conclude - while a headed fallback that SUCCEEDED records `rendered` like
 * any other retrieval and is held to the same rule.
 */
export function unjudgedRenderedObservations(log, { agency, category, candidateSetVersion } = {}) {
  const problems = [];
  const inScope = (a) =>
    (agency === undefined || a.agency === agency) &&
    (category === undefined || a.category === category) &&
    (candidateSetVersion === undefined || a.candidateSetVersion === candidateSetVersion);

  const observations = log.attempts.filter(
    (a) => a.status === 'discovery' && a.outcome === 'rendered' && inScope(a) &&
      !isDiscoverySuperseded(log, a.id)
  );

  for (const o of observations) {
    // Linked by EITHER role, because the two say different things. `answersDiscoveryId` names the
    // obligation a judgement discharges; `evidenceFromDiscoveryId` names the observation it read.
    // A fresh render answers its own observation, so both point at it. The retrospective pass does
    // not: those judgements answer the original plain-retrieval record - `d-0377` answers `d-0018`
    // - while citing the observation as their evidence. Testing the answer link alone declared all
    // fifty-seven retrospective observations unread, which is the opposite of what the log shows.
    //
    // Amendment 54. A TECHNICAL CONCLUSION discharges the obligation too. The obligation is that
    // every render be accounted for, not that every render yield a verdict about candidates: a
    // page the server never served has no such verdict to give, and demanding one is what would
    // force the overclaim.
    const answering = log.attempts.filter(
      (j) => [RECORD_TYPES.JUDGEMENT_ONLY, RECORD_TYPES.TECHNICAL_CONCLUSION].includes(j.recordType) &&
        (j.answersDiscoveryId === o.id || j.evidenceFromDiscoveryId === o.id) &&
        !isDiscoverySuperseded(log, j.id)
    );
    const where = `${o.id} (${o.agency} / ${o.category} v${o.candidateSetVersion}, ${o.url})`;

    // Uniqueness is per CATEGORY and round, not per observation. One render legitimately supports
    // a judgement in each category it was examined under - `d-0315` carries three, for account
    // registration, enquiry and service application - and that is the case the registry exists to
    // express. What must never happen is two live judgements for the SAME category about the same
    // retrieval, because then the round has two answers and no way to say which it acted on.
    const sameRound = answering.filter(
      (j) => j.category === o.category && j.candidateSetVersion === o.candidateSetVersion
    );
    if (sameRound.length === 0) {
      problems.push(
        answering.length
          ? `${where} is cited only by judgements in other categories or rounds ` +
            `(${answering.map((j) => `${j.id}:${j.category} v${j.candidateSetVersion}`).join(', ')}); ` +
            'none concludes this observation\'s own round'
          : `${where} was rendered but never judged; run \`classify-render --render ${o.renderId} ` +
            `--answers ${o.id}\` before this round is locked or approved`
      );
      continue;
    }
    if (sameRound.length > 1) {
      problems.push(
        `${where} has ${sameRound.length} active judgements for its own category ` +
          `(${sameRound.map((j) => j.id).join(', ')}); exactly one must be active`
      );
      continue;
    }
    const [j] = sameRound;
    for (const [field, label] of [
      ['renderId', 'render'], ['url', 'URL'], ['agency', 'agency'],
      ['category', 'category'], ['candidateSetVersion', 'round'],
    ]) {
      if (j[field] !== o[field]) {
        problems.push(
          `${where} is judged by ${j.id}, whose ${label} is ${JSON.stringify(j[field])} ` +
            `and not ${JSON.stringify(o[field])}`
        );
      }
    }
  }
  return problems;
}

/**
 * Barrier accounting: how many blocked attempts were RECOVERED, and what remains unread.
 *
 * Amendment 50. Every reader of the log counted raw `retrieval-blocked` outcomes, so a headless
 * attempt barred by a WAF and then read successfully in headed Chromium was counted as an unread
 * page. The Ministry for Culture and Heritage packet made the error visible by stating the opposite
 * of the truth about a zero-candidate round - "nothing here establishes whether this agency
 * publishes such a form" - when sixteen content URLs across five of six origins had in fact been
 * read in full and found to publish none. Study-wide the distortion is exactly half: 80 active
 * blocked attempts are 40 recovered events and 40 unresolved records over 30 scoped URLs.
 *
 * Recovery is deliberately STRICT. A barrier is recovered only by an explicit `followsDiscoveryId`
 * chain from the barred attempt to an unbarred `rendered` observation of the same agency, category,
 * round and canonical URL, which itself carries the judgement the protocol requires of it. An
 * unrelated later render of the same URL does not clear it: that would let a navigation in another
 * round, or a render nobody read, retire a barrier it has nothing to do with.
 */
export function barrierAccounting(log, { agency, category, candidateSetVersion } = {}) {
  const inScope = (a) =>
    (agency === undefined || a.agency === agency) &&
    (category === undefined || a.category === category) &&
    (candidateSetVersion === undefined || a.candidateSetVersion === candidateSetVersion);
  const active = (a) => !isDiscoverySuperseded(log, a.id);
  const scopedKey = (a) =>
    `${a.agency}\u0000${a.category}\u0000${a.candidateSetVersion}\u0000${canonicalise(a.url)}`;

  const attempts = log.attempts.filter(
    (a) => a.status === 'discovery' && a.outcome === 'retrieval-blocked' && inScope(a) && active(a)
  );

  const recoveredBy = (barred) => {
    const follower = log.attempts.find(
      (a) => a.followsDiscoveryId === barred.id && active(a) && a.outcome === 'rendered' &&
        a.agency === barred.agency && a.category === barred.category &&
        a.candidateSetVersion === barred.candidateSetVersion &&
        canonicalise(a.url) === canonicalise(barred.url)
    );
    if (!follower) return null;
    // The successful read must itself have been READ: an unjudged render recovers nothing.
    const judged = log.attempts.some(
      (j) => j.recordType === RECORD_TYPES.JUDGEMENT_ONLY && active(j) &&
        (j.answersDiscoveryId === follower.id || j.evidenceFromDiscoveryId === follower.id) &&
        j.category === follower.category && j.candidateSetVersion === follower.candidateSetVersion
    );
    return judged ? follower : null;
  };

  const recovered = [];
  const unresolved = [];
  for (const a of attempts) (recoveredBy(a) ? recovered : unresolved).push(a);

  const robotsUnestablished = log.attempts.filter(
    (a) => a.status === 'discovery' && a.outcome === 'robots-unestablished' && inScope(a) && active(a)
  );
  const inconclusive = log.attempts.filter(
    (a) => a.status === 'discovery' && a.outcome === 'retrieval-inconclusive' && inScope(a) && active(a)
  );

  return {
    barrierAttempts: attempts.length,
    recovered: recovered.length,
    unresolved: unresolved.length,
    unresolvedUrls: new Set(unresolved.map(scopedKey)).size,
    unresolvedRecords: unresolved.map((a) => a.id),
    robotsUnestablished: robotsUnestablished.length,
    retrievalInconclusive: inconclusive.length,
    // What a reader should treat as coverage lost, as opposed to events logged.
    unreadUrls: new Set([...unresolved, ...robotsUnestablished, ...inconclusive].map(scopedKey)).size,
  };
}

/**
 * The content URLs a round actually read and concluded on, which is what a zero-candidate result
 * rests on. Amendment 50. The robots record is excluded: it is a policy observation, not a page.
 */
export function readContentUrls(log, { agency, category, candidateSetVersion } = {}) {
  const active = (a) => !isDiscoverySuperseded(log, a.id);
  const judged = log.attempts.filter(
    (a) => a.status === 'discovery' && active(a) && a.discoveryKind !== 'robots' &&
      ['candidates-found', 'no-candidates'].includes(a.outcome) &&
      (agency === undefined || a.agency === agency) &&
      (category === undefined || a.category === category) &&
      (candidateSetVersion === undefined || a.candidateSetVersion === candidateSetVersion)
  );
  return {
    records: judged.length,
    urls: new Set(judged.map((a) => canonicalise(a.url))).size,
    origins: new Set(judged.map((a) => { try { return new URL(a.url).origin; } catch { return a.url; } })).size,
  };
}

export function renderBacklog(log) {
  const answered = renderedJudgements(log);
  const current = boundToCurrentSet(log);
  const unreachable = renderRefusedUrls(log);
  const barred = renderBarredUrls(log);
  return log.attempts.filter((a) => {
    // Only evidence a CURRENT set stands on. A record belonging solely to a superseded round is
    // history, and re-rendering it would be traffic spent on a finding already withdrawn.
    if (!current.has(a.id)) return false;
    if (a.status !== 'discovery') return false;
    if (!RENDERED_METHODS.includes(a.discoveryKind)) return false;
    if (isDiscoverySuperseded(log, a.id)) return false;
    if (a.evidence === DISCOVERY_EVIDENCE.RENDERED_DOM) return false;
    if (!CONTENT_OUTCOMES.includes(a.outcome)) return false;
    // A record that never navigated has no DOM to have rendered.
    if (a.navigationPerformed === false) return false;
    let url = null;
    try { url = new URL(a.url); } catch { return false; }
    // Answered by a judgement that NAMES this record, not one that merely shares its page.
    if (answered.has(a.id)) return false;
    // Or discharged as attrition, because a render attempt found the page unreachable within policy.
    if (unreachable.has(canonicalise(a.url))) return false;
    // Or because both browser modes were barred, so no judgement can ever rest on this page.
    if (barred.has(canonicalise(a.url))) return false;
    if (NON_HTML.test(url.pathname)) return false;
    // And the request must not be FORBIDDEN by the policy in force now. Without this the gate would
    // demand renders that politeness forbids - an obligation meetable only by breaching robots,
    // which is worse than the bias it was added to remove. Six `disallowed` and two
    // Incapsula-blocked records were in the first version of this list for exactly that reason.
    //
    // An origin with no RECORDED policy is a different case and must not be quietly dropped: the
    // early rounds predate the recorded-policy model, so most of the backlog has none. Needing a
    // robots check first is a prerequisite, not an exemption - excluding those records would have
    // shrunk the obligation from 101 to 32 by losing the ones nobody had checked.
    const check = findRobotsCheck(log, url.origin);
    if (check && !evaluatePolicy(check, url.pathname + url.search, 'chromium').allowed) return false;
    return true;
  });
}

/** Why a backlog entry cannot be rendered yet, or null if it can. */
export function renderPrerequisite(log, attempt) {
  let url = null;
  try { url = new URL(attempt.url); } catch { return 'the url does not parse'; }
  const check = findRobotsCheck(log, url.origin);
  if (!check) return `no recorded robots policy for ${url.origin}; run \`recheck-robots\` first`;
  if (!robotsCheckIsFresh(check)) return `the robots policy for ${url.origin} is more than 24 hours old`;
  const verdict = evaluatePolicy(check, url.pathname + url.search, 'chromium');
  return verdict.allowed ? null : verdict.reason;
}

/** Backlog entries grouped by URL: one render answers every record naming that page. */
export function renderBacklogByUrl(log) {
  const groups = new Map();
  for (const a of renderBacklog(log)) {
    const key = a.url;
    if (!groups.has(key)) groups.set(key, { url: key, agency: a.agency, records: [] });
    groups.get(key).records.push(a.id);
  }
  return [...groups.values()];
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
export function corpusBlockers(log, { capturesRoot = null } = {}) {
  const blockers = [];
  const add = (kind, summary, items = []) => blockers.push({ kind, summary, items });

  const pending = log.attempts.filter((a) => a.approval === APPROVAL.PENDING && !isEvidenceOnly(a));
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
    (a) => a.status !== 'discovery' && !isEvidenceOnly(a) &&
      a.approval === APPROVAL.REJECTED && !isSuperseded(log, a)
  );
  if (dangling.length) {
    add('unsuperseded-rejections', `${dangling.length} rejected attempt(s) have not been superseded by a correction`,
      dangling.map((a) => `${a.id} ${a.url}`));
  }

  // The check `status` was missing entirely.
  // Amendment 41. TERMINAL decisions, and exactly one each. This read `status !== 'discovery'` and
  // so accepted an evidence-only retrieval as an outcome: with the exclusion deleted and the
  // retrieval marked approved, it reported nothing while a locked candidate was undecided.
  const supersededAttempts = new Set(
    log.attempts.map((a) => a.supersedesAttemptId).filter((id) => id !== undefined && id !== null)
  );
  const unassessed = [];
  const contested = [];
  for (const set of Object.values(log.candidateSets ?? {})) {
    for (const url of set.locked ?? []) {
      const decisions = terminalDecisionsFor(log.attempts, {
        agency: set.agency, url, supersededIds: supersededAttempts,
      });
      if (decisions.length === 0) {
        const held = log.attempts.find(
          (a) => isEvidenceOnly(a) && a.agency === set.agency && canonicalise(a.url) === canonicalise(url)
        );
        unassessed.push(
          `${set.agency} / ${set.category}: ${url}` +
            (held ? ` - ${held.id} holds its bytes, but a retrieval decides nothing` : '')
        );
      } else if (decisions.length > 1) {
        contested.push(`${set.agency} / ${set.category}: ${url} - ${decisions.map((d) => d.id).join(', ')}`);
      }
    }
  }
  if (unassessed.length) {
    add('unassessed-candidates', `${unassessed.length} locked candidate(s) with no terminal decision`, unassessed);
  }

  // Amendment 44. An eligible-but-not-selected record asserts that something else was chosen.
  // Checked here as well as at write time, because the capture it names could be rejected later.
  const tieBreak = [];
  for (const a of log.attempts) {
    if (a.status !== 'eligible-not-selected' || supersededAttempts.has(a.id)) continue;
    const selected = log.attempts.find((x) => x.id === a.notSelectedInFavourOf);
    if (!selected || selected.status !== 'captured') {
      tieBreak.push(`${a.id} names ${a.notSelectedInFavourOf}, which is not a captured attempt`);
      continue;
    }
    if (selected.approval === APPROVAL.REJECTED) {
      tieBreak.push(
        `${a.id} rests on the selection ${selected.id}, which has been REJECTED; the tie-break ` +
          'must be decided again before this record stands'
      );
    }
    if (!(canonicalise(selected.url) < canonicalise(a.url))) {
      tieBreak.push(`${a.id} names ${selected.id}, which does not sort before it`);
    }
  }
  if (tieBreak.length) {
    add('tie-break-unsound', `${tieBreak.length} eligible-not-selected record(s) rest on an unsound selection`, tieBreak);
  }
  if (contested.length) {
    add('contested-candidates',
      `${contested.length} locked candidate(s) have more than one active terminal decision`, contested);
  }

  // Amendment 39. Log-wide here, not per round: the corpus is built from every round at once,
  // and an unread render in any of them is evidence the draft would rest on unseen.
  const unread = unjudgedRenderedObservations(log);
  if (unread.length) {
    add('unjudged-renders', `${unread.length} rendered observation(s) have no matching judgement`, unread);
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

  const deviations = checkDeviations(log);
  if (deviations.length) {
    add('deviations', `the recorded deviations do not match the log: ${deviations.length} problem(s)`, deviations);
  }

  // selection-v1.0.23. An exhaustion whose stored resolution the bound evidence no longer
  // supports. It cannot arise from `exhaustAgency`, which derives it - but a round corrected after
  // the exhaustion was written could turn a searched-in-full claim into a false one, and the
  // resolution is what the prevalence denominator means.
  const { disagreements } = agencyResolutions(log);
  if (disagreements.length) {
    add('resolution-disagreements',
      `${disagreements.length} exhaustion(s) claim a resolution their evidence does not support`,
      disagreements);
  }

  // selection-v1.0.24. Plain-fetch evidence for a page whose authoritative evidence is now the
  // rendered DOM. A gate rather than a note: the whole point is that a script-inserted form was
  // undiscoverable, so leaving the backlog optional would leave the bias in the corpus.
  // Fail-closed: if renders exist and nobody told this gate where they live, the check could not be
  // performed, and "could not check" must not read as "checked and fine".
  if ((log.renders ?? []).length > 0 && !capturesRoot) {
    add('render-evidence', 'rendered evidence could not be verified: no capture root was supplied', []);
  } else if ((log.renders ?? []).length > 0) {
    const renderProblems = checkRenderLedger(log, join(resolve(capturesRoot), RENDERED_DIR));
    if (renderProblems.length) {
      add('render-evidence', `rendered evidence does not match the log: ${renderProblems.length} problem(s)`,
        renderProblems);
    }
  }

  // Amendment 57. Policy-reuse records re-checked: a stale or foreign policy documented as a
  // round's authority would look like provenance while being none.
  const reuse = policyReuseAudit(log);
  if (reuse.length) {
    add('policy-reuse', `${reuse.length} policy-reuse record(s) do not rest on a policy that governed them`, reuse);
  }
  // Amendment 59. The structural report must be present, well formed and self-consistent.
  const structural = structuralReportAudit(log, { capturesRoot });
  if (structural.length) {
    add('structural-report', `${structural.length} record(s) have a missing or inconsistent structural report`, structural);
  }

  // Amendment 58. And the documented policy must be the one the round decided under.
  const agreement = policyAgreementProblems(log);
  if (agreement.length) {
    add('policy-agreement', `${agreement.length} round(s) document a policy they did not act under`, agreement);
  }

  // Amendment 55. Retained plain-read bytes, verified like rendered ones. Fail-closed on a
  // missing capture root for the same reason: "could not check" must not read as "checked".
  if ((log.fetches ?? []).length > 0 && !capturesRoot) {
    add('fetch-evidence', 'retained fetch evidence could not be verified: no capture root was supplied', []);
  } else if ((log.fetches ?? []).length > 0) {
    const fetchProblems = checkFetchLedger(log, join(resolve(capturesRoot), FETCHED_DIR));
    if (fetchProblems.length) {
      add('fetch-evidence', `retained fetch evidence does not match the log: ${fetchProblems.length} problem(s)`, fetchProblems);
    }
  }

  // Amendment 54. Every active conclusion re-checked against its render's status, because the
  // status lives in the registry and a render can be re-registered after a conclusion was written.
  const conclusions = renderConclusionAudit(log);
  if (conclusions.length) {
    add('render-conclusion', `${conclusions.length} conclusion(s) do not match their render's HTTP status`, conclusions);
  }

  // Amendment 53. Citations that stand in for another URL are re-verified here, not trusted to
  // the write-time check alone: a set can be reopened and relocked after a decision is recorded,
  // and an equivalence that rested on both URLs being locked would then be resting on nothing.
  const equivalence = redirectEquivalenceAudit(log);
  if (equivalence.length) {
    add('redirect-equivalence', `${equivalence.length} citation(s) stand in for a URL the recorded redirects do not support`, equivalence);
  }

  const stale = staleSetBindings(log);
  if (stale.length) {
    add('stale-set-bindings',
      `${stale.length} candidate set(s) bind a superseded discovery record`,
      stale.map((s) => `${s.agency} / ${s.category} v${s.version} (${s.approval ?? 'pending'}): ` +
        s.stale.map((r) => `${r.id} -> ${r.replacedBy ?? 'no replacement'}`).join(', ')));
  }

  const backlog = renderBacklog(log);
  if (backlog.length) {
    add('render-backlog',
      `${backlog.length} navigation/internal-search record(s) rest on plain retrieval, not a rendered DOM`,
      backlog.map((a) => `${a.id} ${a.agency} / ${a.category}: ${a.url}`));
  }

  const awaiting = agenciesAwaitingExhaustion(log);
  if (awaiting.length) {
    add('awaiting-exhaustion', `${awaiting.length} agency(ies) awaiting an exhaustion record`, awaiting);
  }

  return blockers;
}

/**
 * Official capture files and logged captures must correspond one to one.
 *
 * capture-v1.0.6. A blocked response left a Cloudflare interstitial in the captures directory
 * that no attempt record owned. The seal hashes only files the draft names, so it would not have
 * been sealed - but an orphan in that directory looks like corpus material, and nothing detected
 * it. The reverse is equally wrong: a `captured` attempt whose file is missing.
 */
export function checkCaptureFiles(log, capturesDir) {
  const problems = [];
  const root = resolve(capturesDir);
  let present;
  try {
    present = readdirSync(root).filter((f) => f.endsWith('.html'));
  } catch {
    return problems; // no captures directory yet
  }
  const owned = new Map();
  for (const a of log.attempts) {
    // Amendment 40. A retrieved attempt owns its bytes too. Promotion reuses the SAME file rather
    // than fetching the page again, so one file may be named by a retrieval and by the capture
    // promoted from it; only two CAPTURED records naming one file is a double-count.
    if (!['captured', 'retrieved'].includes(a.status) || !a.file) continue;
    if (owned.has(a.file) && owned.get(a.file).status === 'captured' && a.status === 'captured') {
      problems.push(`two captured attempts name ${a.file}`);
    }
    if (!owned.has(a.file) || a.status === 'captured') owned.set(a.file, a);
  }
  for (const file of present) {
    if (!owned.has(file)) {
      problems.push(
        `${file} is in the captures directory but no captured attempt owns it. A file that looks ` +
          'like corpus material and is not must be quarantined, not left beside the real captures.'
      );
    }
  }
  for (const [file, attempt] of owned) {
    if (!present.includes(file)) {
      problems.push(`${attempt.id} is recorded as captured but ${file} is not on disk`);
      continue;
    }
    // capture-v1.0.7. The bytes, not merely the filename. Correspondence by name established that
    // a file with the right name existed; it established nothing about its contents, so a capture
    // edited, truncated or replaced after the fact would have passed every gate and been sealed
    // under a hash it no longer had. The seal hashes the file at sealing time, which means a
    // silent substitution before then would produce a corpus whose manifest was internally
    // consistent and whose page was not the page that was captured and approved.
    let actual = null;
    try {
      actual = sha256(readFileSync(join(root, file), 'utf8'));
    } catch (error) {
      problems.push(`${attempt.id} names ${file}, which could not be read: ${error.message}`);
      continue;
    }
    if (attempt.htmlSha256 && actual !== attempt.htmlSha256) {
      problems.push(
        `${file} hashes to ${actual.slice(0, 12)} but ${attempt.id} records ` +
          `${String(attempt.htmlSha256).slice(0, 12)}. The file on disk is not the markup that ` +
          'was captured, so it must not be sealed as though it were.'
      );
    }
  }
  return problems;
}

/**
 * Moves an artefact out of its directory, preserving it. Used for captures and for renders.
 *
 * capture-v1.0.7. The harness wrote the markup as soon as the page was readable, and every
 * refusal AFTER that point left the file behind with no attempt owning it. HTTP 429 was the clear
 * case: the policy stops the run, the process exited, and the file stayed in the captures
 * directory looking exactly like corpus material. `checkCaptureFiles` would then refuse every
 * later build until somebody worked out by hand what the stray file was.
 *
 * Quarantined rather than deleted, for the same reason the Cloudflare interstitial was: it is
 * evidence of what the server returned, and destroying it to tidy the directory would destroy the
 * record of the refusal along with it.
 */
export function quarantineArtefact(fromDir, file, { reason }) {
  const from = join(resolve(fromDir), file);
  if (!existsSync(from)) return null;
  const dir = join(resolve(fromDir), '..', 'quarantine');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const to = join(dir, `${stamp}-${file}`);
  renameSync(from, to);
  writeFileSync(`${to}.reason.txt`, `${reason}\n`, 'utf8');
  return to;
}
