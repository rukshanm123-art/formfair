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
import { DISCOVERY_KINDS, remainingBudget, MAX_CANDIDATES_PER_CATEGORY, MAX_CANDIDATES_PER_AGENCY } from './selection.mjs';

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

export function emptyLog() {
  return { schema: LOG_SCHEMA, politeness: { ...POLICY }, attempts: [] };
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
  if (attempt.status === 'discovery' && !DISCOVERY_KINDS.includes(attempt.discoveryKind)) {
    problems.push(`a discovery record needs discoveryKind from ${DISCOVERY_KINDS.join(', ')}`);
  }
  if (attempt.status !== 'discovery') {
    for (const c of ELIGIBILITY_CRITERIA) {
      const v = attempt.eligibility?.[c];
      if (v !== true && v !== false && v !== null) {
        problems.push(`eligibility.${c} must be true, false or null`);
      }
    }
  }
  if (attempt.status === 'captured') {
    if (!attempt.pageId) problems.push('a captured attempt needs a pageId');
    if (!attempt.file) problems.push('a captured attempt needs a file');
    if (!attempt.htmlSha256) problems.push('a captured attempt needs htmlSha256');
    if (!attempt.category || !CATEGORIES.includes(attempt.category)) {
      problems.push(`a captured attempt needs a category from ${CATEGORIES.join(', ')}`);
    }
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
  if (log.attempts.some((a) => a.url === attempt.url)) {
    throw new Error(`url ${attempt.url} is already recorded`);
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
  log.attempts.push({ approval: APPROVAL.PENDING, ...attempt });
  return log;
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
      a.status === 'captured' ? a.inclusionEvidence : a.status === 'discovery' ? `discovery: ${a.discoveryKind}` : a.exclusionReason,
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
export function deriveDraft(log, { frameSha256, drawOrderSha256, selectionLedgerFile = 'selection-ledger.csv', synthetic = false }) {
  const pending = log.attempts.filter((a) => a.approval === APPROVAL.PENDING);
  if (pending.length) {
    throw new Error(
      `${pending.length} attempt(s) still pending researcher approval; the corpus cannot be built until every inclusion and exclusion is approved`
    );
  }
  const pages = log.attempts
    .filter((a) => a.status === 'captured' && a.approval === APPROVAL.APPROVED)
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
    }));
  return {
    schema: 'formfair/solo-corpus-draft@1',
    synthetic,
    frameSha256,
    drawOrderSha256,
    selectionLedgerFile,
    pages,
  };
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
