#!/usr/bin/env node
/**
 * The capture command.
 *
 * Every path through this file records an attempt. A capture, an exclusion and a failure
 * all append to `capture-log.json`, from which the selection ledger and the corpus draft
 * are derived, so a page cannot be captured without appearing in the ledger and a ledger
 * row cannot name a page the draft does not have.
 *
 *   capture   attempt one URL and record the outcome, whatever it is
 *   exclude   record a URL examined and not captured, with its reason
 *   approve   the researcher confirms one attempt (or rejects it with a reason)
 *   status    what has been captured, what is pending approval, what is left
 *   build     rewrite the derived ledger and draft from the log
 *
 * Nothing here analyses markup. FormFair is not imported and must not be run while
 * selecting or capturing.
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { chromium } from 'playwright';
import {
  capturePage, validateUrl, validatePageId, CATEGORIES, captureDisposition, needsHeadedFallback,
} from './capture.mjs';
import { renderDiscoveryPage, RENDERED_METHODS } from './render-discovery.mjs';
import { POLICY, createPacer } from './politeness.mjs';
import {
  readLog, writeLog, appendAttempt, writeDerived, ELIGIBILITY_CRITERIA, APPROVAL,
  recordCandidates, lockCandidateSet, categorySettled, approveCandidateSet,
  supersedeCandidateSet, publishProvenance, exhaustAgency,
  agenciesAwaitingExhaustion, findRobotsCheck, recordRobotsCheck, checkCaptureFiles,
  issueDiscoveryPermit, consumeDiscoveryPermit, findOpenPermit,
  unresolvedDiscoveryRounds, openDiscoveryPermits, robotsCheckIsFresh, isDiscoverySuperseded,
  reopenCandidateSet, closeDiscoveryPermit, permitAudit, PERMIT_DISPOSITIONS, corpusBlockers,
  quarantineCapture, recordDeviation, agencyResolutions, agencyResolution, reResolveExhaustion,
  renderBacklog, renderBacklogByUrl, renderPrerequisite, recordRender, findRender,
  findRenderForUrl, assertRenderEvidenceUsable, assertPermitUsable, adoptRender,
} from './run.mjs';
import { fetchRobotsPolicy, evaluatePolicy, DISPOSITION } from './robots-policy.mjs';
import {
  DISCOVERY_KINDS, DISCOVERY_METHODS, DISCOVERY_OUTCOMES, remainingBudget, canonicalise,
  SEARCH_TERMS, parseDrawOrder, nextWork, isSuperseded, MAX_QUALIFIED_AGENCIES,
  TECHNICAL_ATTRITION_OUTCOMES, JUDGEMENT_OUTCOMES,
} from './selection.mjs';
import { readFileSync as readFile } from 'node:fs';
import { buildPacket, renderPacket } from './packet.mjs';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? null;
};
const has = (name) => args.includes(`--${name}`);

const USAGE = `usage:
  cli-capture.mjs capture --out <dir> --agency <name> --website <url> --url <url>
                          --page-id <id> --category <${CATEGORIES.join('|')}>
                          --evidence "<why this page qualifies>" [--settle-ms <n>]
                          [--supersedes-attempt-id <c-NNNN>]
  cli-capture.mjs exclude --out <dir> --agency <name> --website <url> --url <url>
                          --reason "<why it was not captured>" --category <c>
                          [--fails <eligibility criterion>]
                          [--supersedes-attempt-id <c-NNNN>]
  cli-capture.mjs preflight-discovery --out <dir> --agency <name> --website <url> --url <url>
                          --category <c> --set-version <n> [--method <m>] [--recheck-robots]
                          (checks robots BEFORE navigating: issues a single-use permit, or
                           records the disallowed outcome without any request to the target)
  cli-capture.mjs discovery --out <dir> --agency <name> --website <url> --url <url>
                          --permit-id <p-NNNN>
                          [--supersedes-discovery-id <d-NNNN>]
                          --method <${DISCOVERY_METHODS.join('|')}>
                          --outcome <${DISCOVERY_OUTCOMES.join('|')}>
                          --category <c> --set-version <n> --navigated-at <ISO8601Z>
                          [--note "<e.g. method unavailable and why>"]
  cli-capture.mjs candidates --out <dir> --agency <name> --category <c>
                          (--add <url>[,<url>...] | --none)
                          (--none records a round that found nothing, which is lockable)
  cli-capture.mjs lock    --out <dir> --agency <name> --category <c>
  cli-capture.mjs reopen-set --out <dir> --agency <name> --category <c> --reason "<why>"
                          (reopens a locked but UNAPPROVED set so a correction can be bound;
                           the previous lock is preserved in lockHistory)
  cli-capture.mjs approve-set --out <dir> --agency <name> --category <c>
                          [--reject] [--note "<why>"]
  cli-capture.mjs supersede-set --out <dir> --agency <name> --category <c>
                          --reason "<why the rejected set is being redone>"
  cli-capture.mjs publish --out <dir> --to <tracked dir>
  cli-capture.mjs packet  --out <dir> --agency <name> --category <c>
  cli-capture.mjs exhaust --out <dir> [--agency <name, checked against the draw order>]
                          (records the next agency as searched in full with no eligible form;
                           the agency is derived from the draw order, never supplied)
  cli-capture.mjs close-permit --out <dir> --permit-id <p-NNNN> --reason "<why>"
                          --disposition <unused|duplicate-request>
                          [--accounted-by <d-NNNN>]   (required for duplicate-request)
  cli-capture.mjs next    --out <dir>
  cli-capture.mjs budget  --out <dir> --agency <name> [--category <c>]
  cli-capture.mjs approve --out <dir> (--id <c-NNNN> | --url <url>)
                          [--reject --reason "<why>"]
                          (--url is refused once a URL has more than one attempt)
  cli-capture.mjs status  --out <dir>
  cli-capture.mjs build   --out <dir> --frame-sha256 <hex> --draw-order-sha256 <hex>

Politeness policy (not overridable): one capture at a time, >=${POLICY.minDelayBetweenNavigationsMs / 1000}s between
navigations, robots.txt honoured, stop on 429, one retry, no bypassing of
authentication, CAPTCHA, blocking or consent controls.`;

const die = (message) => {
  console.error(message);
  process.exit(1);
};

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const logPathFor = (dir) => join(resolve(dir), 'capture-log.json');
const require_ = (name) => flag(name) ?? die(`--${name} is required\n\n${USAGE}`);

const pacer = createPacer();

async function doCapture() {
  const dir = require_('out');
  const agency = require_('agency');
  const website = require_('website');
  const url = require_('url');
  const pageId = require_('page-id');
  const category = require_('category');
  const evidence = require_('evidence');
  const settleMs = Number(flag('settle-ms') ?? POLICY.postLoadSettleMs);

  const parsed = validateUrl(url);
  validatePageId(pageId);
  if (!CATEGORIES.includes(category)) die(`--category must be one of ${CATEGORIES.join(', ')}`);

  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const capturesDir = join(resolve(dir), 'captures');
  mkdirSync(capturesDir, { recursive: true });

  // `supersedesAttemptId` rides on `base` so that every exit below - robots exclusion,
  // failure, blocking exclusion, capture - carries the correction it is making. A rerun
  // that superseded a rejected decision only when it happened to succeed would leave the
  // rejected one unresolved exactly when the rerun also failed.
  const supersedesAttemptId = flag('supersedes-attempt-id');
  const base = {
    examinedAt: now(), agency, website, url,
    ...(supersedesAttemptId ? { supersedesAttemptId } : {}),
  };

  // robots.txt decides before anything is fetched from the site itself.
  //
  // capture-v1.0.7. Through the RECORDED policy, not a per-process cache of its own. The capture
  // path kept its own `robotsFor`, which re-requested robots.txt on every invocation without
  // writing a record of it, treated an unreachable file as absent and therefore permissive, and
  // read a 200 as a policy whatever it contained. Discovery had all three defects fixed in turn
  // while capture still had every one of them - the same rule, enforced in one place and not the
  // other, which is how this scan keeps rediscovering the same class of hole.
  const cachedCheck = findRobotsCheck(log, parsed.origin);
  let check = robotsCheckIsFresh(cachedCheck) ? cachedCheck : null;
  if (!check) {
    check = recordRobotsCheck(log, await fetchRobotsPolicy(parsed.origin));
    writeLog(logPath, log); // the request happened, so its record survives whatever follows
  }
  const verdict = evaluatePolicy(check, parsed.pathname + parsed.search, 'chromium');
  if (!verdict.allowed) {
    // An unestablished policy is not a refusal by the host, so the reason must not say it was.
    const attempt = {
      ...base, status: 'excluded', category,
      exclusionReason: verdict.unestablished
        ? `not retrieved: ${verdict.reason}`
        : `robots.txt disallows this path (${verdict.reason})`,
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
      politeness: { robots: verdict.reason },
      robotsCheckId: check.id,
    };
    appendAttempt(log, attempt);
    writeLog(logPath, log);
    writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
    console.log(
      verdict.unestablished
        ? `excluded without retrieving: no robots policy established for ${parsed.origin}`
        : `excluded: robots.txt disallows ${url}`
    );
    console.log(`reason: ${verdict.reason}`);
    return;
  }

  await pacer.beforeNavigation(verdict.crawlDelay ?? null);

  // capture-v1.0.6. One fixed fallback: if headless Chromium is access-barred, the same page is
  // attempted once with headed Chromium in a fresh context. This is not a bypass - it is the same
  // browser with no persistent profile, no imported cookies, no custom user agent, no stealth or
  // fingerprint modification, and no interaction with any challenge. A challenge that never
  // appears is not a challenge that was answered. If headed is barred too, the outcome is
  // `capture-blocked`, and no further workaround is attempted.
  const attemptedModes = [];
  let record = null;
  let lastError = null;
  for (let attemptNo = 1; attemptNo <= 1 + POLICY.transientRetries; attemptNo++) {
    try {
      record = await capturePage({
        browserFactory: () => chromium.launch({ headless: true }),
        url, agency, website, pageId, category, outDir: capturesDir, settleMs,
        browserMode: 'headless',
      });
      break;
    } catch (error) {
      lastError = error;
      if (/refusing to overwrite/.test(error.message)) break;
      if (attemptNo <= POLICY.transientRetries) {
        console.error(`transient failure, retrying once: ${error.message}`);
        await pacer.beforeNavigation(null);
      }
    }
  }

  if (!record) {
    appendAttempt(log, {
      ...base, status: 'failed', category,
      exclusionReason: `capture failed: ${lastError?.message ?? 'unknown error'}`,
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
    });
    writeLog(logPath, log);
    writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
    die(`failed and recorded: ${lastError?.message}`);
  }

  if (record) {
    attemptedModes.push({
      browserMode: record.browserMode, httpStatus: record.httpStatus,
      userAgent: record.userAgent, accessBarriers: record.accessBarriers,
    });
  }

  // Two kinds of access barrier, which mean different things.
  //
  //   a sign-in wall        the public cannot read the form without an account. A genuine
  //                         eligibility failure under criterion one.
  //   a challenge or 4xx    may be bot management rather than a public barrier. Retried once in
  //                         headed Chromium; if still barred, `capture-blocked`.
  //
  // Collapsing them is what produced an eligibility claim the evidence did not support.
  // The headed fallback is attempted for an AUTOMATION barrier only. A sign-in wall is a finding
  // about the page, and retrying it in a visible window would not change what the public sees.
  if (needsHeadedFallback(record)) {
    console.error(
      `headless Chromium was access-barred (${record.accessBarriers.join(', ')}); ` +
        'retrying once with headed Chromium in a fresh context'
    );
    await pacer.beforeNavigation(verdict.crawlDelay ?? null);
    try {
      const headed = await capturePage({
        browserFactory: () => chromium.launch({ headless: false }),
        url, agency, website, pageId, category, outDir: capturesDir, settleMs,
        browserMode: 'headed',
      });
      attemptedModes.push({
        browserMode: headed.browserMode, httpStatus: headed.httpStatus,
        userAgent: headed.userAgent, accessBarriers: headed.accessBarriers,
      });
      record = headed;
    } catch (error) {
      attemptedModes.push({ browserMode: 'headed', error: error.message.split('\n')[0] });
    }
  }

  // capture-v1.0.7. Classified from the FINAL record, after the fallback, and once.
  //
  // The previous order decided what the barriers meant from the headless attempt and then ran the
  // fallback, so the classification described a page that had since been fetched again. A headed
  // attempt that got past a challenge and revealed a sign-in wall fell through every branch: the
  // sign-in exclusion was already behind it, `capture-blocked` tests for a non-auth barrier and
  // there was none left, and the run reached the captured branch with a record carrying a barrier,
  // no file and no hash - where it died inside validation. A page whose eligibility the harness
  // had in fact established could not be recorded at all, and the failure looked like a bug in
  // the log rather than in the order of these checks.
  const disposition = captureDisposition(record);
  const { authBarriers } = disposition;

  // Before anything else: a 429 stops the run by policy, and the markup for this page is already
  // on disk. Every exit from here on must leave the captures directory owning nothing it cannot
  // account for, so the file is quarantined rather than left behind or deleted.
  if (disposition.kind === 'rate-limited') {
    const reason =
      `HTTP 429 for ${url} at ${record.capturedAt ?? now()}. The run stops here by policy, so this ` +
      'markup was never adopted as a capture. Preserved as evidence of the response.';
    const moved = record.file ? quarantineCapture(capturesDir, record.file, { reason }) : null;
    appendAttempt(log, {
      ...base, status: 'failed', category, finalUrl: record.finalUrl,
      exclusionReason:
        'HTTP 429: the server asked for a slower rate and the run stops by policy. No judgement ' +
        'was made about this page.',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
      attemptedModes,
      quarantinedFile: moved ? relative(resolve(dir), moved) : null,
      politeness: { robots: verdict.reason, userAgent: record.userAgent },
    });
    writeLog(logPath, log);
    writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
    if (moved) console.error(`quarantined ${record.file} -> ${moved}`);
    die('HTTP 429 received. The run stops here by policy. Respect Retry-After before resuming.');
  }

  if (disposition.kind === 'excluded-sign-in') {
    appendAttempt(log, {
      ...base, status: 'excluded', category, finalUrl: record.finalUrl,
      exclusionReason: `not publicly reachable: ${authBarriers.join(', ')}`,
      eligibility: { ...Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
        publiclyReachableWithoutSigningIn: false },
      attemptedModes,
      politeness: { robots: verdict.reason, userAgent: record.userAgent },
    });
    writeLog(logPath, log);
    writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
    console.log(`excluded: ${authBarriers.join(', ')}`);
    return;
  }

  // Both modes barred: the harness could not retrieve the page. That is recorded as its own
  // outcome, with every eligibility criterion left unknown, because nothing here establishes
  // whether the public can reach it.
  if (disposition.kind === 'capture-blocked') {
    appendAttempt(log, {
      ...base, status: 'capture-blocked', category, finalUrl: record.finalUrl,
      exclusionReason:
        `the capture harness could not retrieve the page: ${record.accessBarriers.join(', ')}. ` +
        'Attempted in headless and headed Chromium, both access-barred. This records automated ' +
        'retrievability only and makes no claim about public eligibility.',
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
      attemptedModes,
      politeness: { robots: verdict.reason, userAgent: record.userAgent },
    });
    writeLog(logPath, log);
    writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
    die(`capture-blocked: ${record.accessBarriers.join(', ')} in ${attemptedModes.length} browser mode(s)`);
  }

  try {
    appendAttempt(log, {
      ...base, ...record, status: 'captured',
      inclusionEvidence: evidence,
      eligibility: {
        // Mechanically established by this run.
        publiclyReachableWithoutSigningIn: record.accessBarriers.length === 0,
        nameFieldVisibleWithoutEnteringDataOrSubmitting: true,
        normalHtmlOrBrowserRenderedNotPdfOrNative: true,
        // Proposed by the operator and confirmed at approval, per the frozen criteria.
        reachedFromFrameWebsiteForThatAgency: true,
        asksForTheNameOfANaturalPerson: true,
      },
      attemptedModes,
      politeness: { robots: verdict.reason, userAgent: record.userAgent, settleMs },
    });
  } catch (error) {
    // capture-v1.0.7. Any refusal after the markup is written must take the file with it. A
    // validation failure used to leave an unowned capture in the directory, which then blocked
    // every later build with a complaint about an orphan whose origin nothing recorded.
    const moved = record.file
      ? quarantineCapture(capturesDir, record.file, { reason: `not adopted: ${error.message}` })
      : null;
    if (moved) console.error(`quarantined ${record.file} -> ${moved}`);
    throw error;
  }
  writeLog(logPath, log);
  const { ledgerPath, draftHeld } = writeDerived({
    log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'),
    synthetic: has('synthetic'),
  });
  console.log(`captured ${pageId} (${record.htmlSha256.slice(0, 12)})`);
  console.log(`ledger: ${ledgerPath}`);
  console.log(draftHeld ? `draft held: ${draftHeld}` : 'draft written');
}

function doExclude() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  // Which criterion the exclusion turns on, recorded structurally rather than left to prose.
  // An exclusion whose reason is only a sentence cannot be counted: a study that reports how
  // many candidates failed criterion five has to be able to compute that from the log, and
  // `doCapture` already records `publiclyReachableWithoutSigningIn: false` for the same reason.
  const fails = flag('fails');
  if (fails !== null && !ELIGIBILITY_CRITERIA.includes(fails)) {
    die(`--fails must be one of:\n  ${ELIGIBILITY_CRITERIA.join('\n  ')}`);
  }
  const eligibility = Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));
  if (fails) eligibility[fails] = false;

  appendAttempt(log, {
    examinedAt: now(),
    agency: require_('agency'), website: require_('website'), url: require_('url'),
    status: 'excluded', exclusionReason: require_('reason'), category: flag('category') ?? undefined,
    eligibility,
    ...(flag('supersedes-attempt-id') ? { supersedesAttemptId: flag('supersedes-attempt-id') } : {}),
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log('recorded exclusion');
}

function doApprove() {
  const dir = require_('out');
  const id = flag('id');
  const url = id ? flag('url') : require_('url');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);

  let attempt;
  if (id) {
    attempt = log.attempts.find((a) => a.id === id);
    if (!attempt) die(`no recorded attempt with id ${id}`);
    if (url && attempt.url !== url) die(`attempt ${id} is ${attempt.url}, not ${url}`);
  } else {
    // capture-v1.0.3. Approving by URL identifies a decision only while a URL has one
    // attempt. Once a page has been attempted, rejected and re-attempted, `--url` would
    // silently approve whichever came first - which is the rejected one. Refuse, and make
    // the researcher name the attempt.
    const matches = log.attempts.filter((a) => a.url === url && a.status !== 'discovery');
    if (matches.length === 0) die(`no recorded attempt for ${url}`);
    if (matches.length > 1) {
      die(
        `${matches.length} attempts recorded for ${url}; approve by id instead:\n` +
          matches.map((a) => `  --id ${a.id}   ${a.status}, ${a.approval}, ${a.examinedAt}`).join('\n')
      );
    }
    attempt = matches[0];
  }
  if (has('reject')) {
    attempt.approval = APPROVAL.REJECTED;
    attempt.approvalNote = require_('reason');
  } else {
    attempt.approval = APPROVAL.APPROVED;
    if (flag('reason')) attempt.approvalNote = flag('reason');
  }
  attempt.approvedAt = now();
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log(`${attempt.approval}: ${attempt.id} ${attempt.url}`);
}

function doStatus() {
  const log = readLog(logPathFor(require_('out')));
  const by = (p) => log.attempts.filter(p).length;

  console.log(`attempts        ${log.attempts.length}`);
  console.log(`  captured      ${by((a) => a.status === 'captured')}`);
  console.log(`  excluded      ${by((a) => a.status === 'excluded')}`);
  console.log(`  failed        ${by((a) => a.status === 'failed')}`);
  // capture-v1.0.7. Both statuses were missing, so the four printed lines did not sum to the
  // total above them and a `capture-blocked` page appeared nowhere in the report at all.
  console.log(`  blocked       ${by((a) => a.status === 'capture-blocked')}`);
  console.log(`  discovery     ${by((a) => a.status === 'discovery')}`);

  const approvedCaptures = by((a) => a.status === 'captured' && a.approval === APPROVAL.APPROVED);
  console.log(`approved captures ${approvedCaptures} of a target of ${MAX_QUALIFIED_AGENCIES}`);

  const audit = permitAudit(log);
  if (audit.issued) {
    console.log(
      `permits issued ${audit.issued}: ${audit.consumed} consumed, ` +
        `${audit.closedDuplicateRequest} closed duplicate-request, ${audit.closedUnused} closed unused, ` +
        `${audit.open} open`
    );
    if (audit.recordedLate) {
      console.log(`  ${audit.recordedLate} record(s) written more than an hour after the navigation`);
    }
  }
  const attrition = log.attempts.filter(
    (a) => a.status === 'discovery' && TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome)
  );
  if (attrition.length) {
    console.log(`technical discovery attrition: ${attrition.length} record(s)`);
    const byOutcome = {};
    for (const a of attrition) byOutcome[a.outcome] = (byOutcome[a.outcome] ?? 0) + 1;
    for (const [outcome, n] of Object.entries(byOutcome)) console.log(`  ${outcome}: ${n}`);
  }
  const backlog = renderBacklog(log);
  if (backlog.length) {
    const byUrl = renderBacklogByUrl(log);
    const ready = byUrl.filter((g) => renderPrerequisite(log, backlog.find((a) => a.url === g.url)) === null);
    console.log(
      `render backlog: ${backlog.length} record(s) across ${byUrl.length} URL(s) rest on plain ` +
        `retrieval; ${ready.length} renderable now`
    );
  }
  const res = agencyResolutions(log);
  if (res.records.length) {
    console.log(
      `agencies resolved: ${res.counts['bounded-discovery-complete'] ?? 0} bounded discovery complete, ` +
        `${res.counts['technical-discovery-attrition'] ?? 0} technical discovery attrition`
    );
    for (const r of res.records) console.log(`  ${r.resolution.padEnd(30)} ${r.agency}`);
  }
  if ((log.deviations ?? []).length) {
    console.log(`recorded deviations: ${log.deviations.length}`);
    for (const d of log.deviations) console.log(`  ${d.id} ${d.kind}: ${d.summary}`);
  }

  // selection-v1.0.17. The same list the corpus gate reads. Computing it separately here is how
  // `status` came to report "nothing outstanding" while `next` named four unassessed candidates
  // and the draft refused for exactly that reason - three commands, three states, one log.
  const blockers = corpusBlockers(log, { capturesRoot: resolve(require_('out')) });
  for (const b of blockers) {
    console.log(b.summary);
    for (const item of b.items.slice(0, 6)) console.log(`  - ${item}`);
    if (b.items.length > 6) console.log(`  ... and ${b.items.length - 6} more`);
  }

  console.log(
    blockers.length === 0
      ? 'nothing outstanding; the corpus draft is not withheld'
      : `${blockers.length} kind(s) of unfinished work; the corpus draft is withheld until each is resolved`
  );
}

function doBuild() {
  const dir = require_('out');
  const log = readLog(logPathFor(dir));
  const r = writeDerived({
    log, dir, frameSha256: require_('frame-sha256'), drawOrderSha256: require_('draw-order-sha256'),
    synthetic: has('synthetic'),
  });
  console.log(`ledger: ${r.ledgerPath}`);
  console.log(r.draftHeld ? `draft held: ${r.draftHeld}` : `draft:  ${r.draftPath}`);
}

async function doDiscovery() {
  const dir = require_('out');
  const kind = flag('method') ?? require_('kind');
  if (!DISCOVERY_METHODS.includes(kind)) die(`--method must be one of ${DISCOVERY_METHODS.join(', ')}`);
  const outcome = require_('outcome');
  if (!DISCOVERY_OUTCOMES.includes(outcome)) die(`--outcome must be one of ${DISCOVERY_OUTCOMES.join(', ')}`);
  const category = require_('category');
  const setVersion = Number(require_('set-version'));
  if (!Number.isInteger(setVersion) || setVersion < 1) die('--set-version must be a positive integer');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const url = require_('url');

  // selection-v1.0.11. The permit is consumed here; the robots check happened BEFORE the
  // navigation, in `preflight-discovery`. Checking at record time could refuse the record but not
  // the request, so it documented a breach instead of preventing one.
  validateUrl(url);
  const permit = consumeDiscoveryPermit(log, {
    agency: require_('agency'), category, candidateSetVersion: setVersion, url,
    navigatedAt: flag('navigated-at'), permitId: require_('permit-id'),
  });

  appendAttempt(log, {
    permitId: permit.id,
    ...(flag('supersedes-discovery-id') ? { supersedesDiscoveryId: flag('supersedes-discovery-id') } : {}),
    examinedAt: now(), agency: require_('agency'), website: require_('website'),
    url, status: 'discovery', discoveryKind: kind,
    outcome, category, candidateSetVersion: setVersion,
    // Discovery browsing happens outside the capture harness, so its navigation time is
    // recorded and checked against the previous one rather than paced by the pacer.
    navigatedAt: require_('navigated-at'),
    ...(flag('note') ? { note: flag('note') } : {}),
    approval: APPROVAL.APPROVED, // a page inspected to find links is not a judgement to approve
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log(`recorded discovery: ${kind} / ${outcome} (${category} v${setVersion})`);
}

function doApproveSet() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const set = approveCandidateSet(log, {
    agency: require_('agency'), category: require_('category'),
    approved: !has('reject'), note: flag('note'),
  });
  writeLog(logPath, log);
  console.log(`candidate set ${set.approval} for ${set.agency} / ${set.category} at ${set.approvedAt}`);
  if (set.approval === APPROVAL.APPROVED) {
    console.log(`${set.locked.length} candidate(s) may now be assessed.`);
  } else {
    console.log('Nothing in this set may be assessed. Re-run discovery for this category.');
  }
}

function doSupersedeSet() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const archived = supersedeCandidateSet(log, {
    agency: require_('agency'), category: require_('category'), reason: require_('reason'),
  });
  writeLog(logPath, log);
  console.log(`archived version ${archived.version} of ${archived.agency} / ${archived.category}`);
  console.log(`reason: ${archived.supersededReason}`);
  console.log('a new version may now be built by recording candidates again');
}

function doPublish() {
  const dir = require_('out');
  const log = readLog(logPathFor(dir));
  const r = publishProvenance(log, { to: require_('to'), capturesRoot: resolve(dir) });
  console.log(`ledger:     ${r.ledgerPath}`);
  console.log(`provenance: ${r.provenancePath}`);
  console.log('These carry no markup and are safe to track.');
}

function doPacket() {
  const log = readLog(logPathFor(require_('out')));
  console.log(renderPacket(buildPacket(log, { agency: require_('agency'), category: require_('category') })));
}

function doBudget() {
  const log = readLog(logPathFor(require_('out')));
  const agency = require_('agency');
  const category = flag('category');
  const b = remainingBudget(log.attempts, { agency, category });
  console.log(`agency  ${agency}`);
  console.log(`  candidates remaining for the agency:  ${Math.max(0, b.agencyRemaining)}`);
  if (category) console.log(`  candidates remaining for ${category}: ${Math.max(0, b.categoryRemaining)}`);
  console.log(b.exhausted ? '  BOUND EXHAUSTED' : '  within the bound');
  if (category && SEARCH_TERMS[category]) console.log(`  terms: ${SEARCH_TERMS[category].join(', ')}`);
}

function drawOrder() {
  const path = new URL('../evaluation/frame/draw-order.csv', import.meta.url);
  return parseDrawOrder(readFile(path, 'utf8'));
}

function doCandidates() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);

  // "This round found nothing" is a finding about the agency, and one of the commonest:
  // most agencies publish no form at all in most categories. It needs to be sayable
  // deliberately. It used to be expressible only as `--add ""`, which relied on an empty
  // string being filtered away to leave an empty set - undiscoverable, and indistinguishable
  // in the log from a mistyped URL that happened to vanish.
  const none = has('none');
  const add = flag('add');
  if (none && add) die('--none records an empty set; it cannot be combined with --add');
  if (!none && add === null) die(`--add is required, or --none for a round that found nothing\n\n${USAGE}`);

  const urls = none ? [] : add.split(',').map((u) => u.trim()).filter(Boolean);
  if (!none && urls.length === 0) {
    die('--add named no usable URL. For a round that genuinely found nothing, use --none.');
  }

  const set = recordCandidates(log, {
    agency: require_('agency'), category: require_('category'), urls,
    declaration: none ? 'none' : null,
  });
  writeLog(logPath, log);
  console.log(
    none
      ? `nil result declared at ${set.declaredAt}; the set may be locked empty`
      : `${set.discovered.length} candidate URL(s) recorded; the set is still open`
  );
}

function doLock() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const set = lockCandidateSet(log, { agency: require_('agency'), category: require_('category') });
  writeLog(logPath, log);
  console.log(`locked ${set.locked.length} of ${set.ordered.length} canonical candidates at ${set.lockedAt}`);
  set.locked.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  if (set.droppedBeyondBound.length) {
    console.log(`  beyond the bound, not assessed: ${set.droppedBeyondBound.length}`);
  }
}

function doNext() {
  const log = readLog(logPathFor(require_('out')));
  const work = nextWork(log, drawOrder());
  if (work.done) return console.log(`nothing further: ${work.reason}`);
  if (work.exhaustedAgency) {
    // selection-v1.0.23. `next` says WHICH resolution will be recorded, because the two mean
    // different things and the operator should see it before running `exhaust` rather than after.
    const r = agencyResolution(log, work.agency);
    if (r.resolution === 'technical-discovery-attrition') {
      console.log(`${work.agency}: every category was attempted, but ${r.attritionRecordIds.length} bound record(s) could not be read.`);
      for (const [outcome, n] of Object.entries(r.attritionByOutcome)) console.log(`  ${outcome}: ${n}`);
      console.log('Recording it as exhausted will resolve it as technical-discovery-attrition,');
      console.log('NOT as an agency searched in full with no eligible form.');
      return;
    }
    return console.log(`${work.agency}: the frozen bounded procedure is complete for every category with no eligible form. Record it as exhausted (bounded-discovery-complete).`);
  }
  console.log(`agency:   ${work.agency}`);
  console.log(`category: ${work.category}`);
  if (work.blocked) {
    console.log(`next:     resolve ${work.blocked.length} outcome(s) before any further work`);
    work.blocked.forEach((b) => console.log(`  - ${b.approval}: ${b.url}`));
    console.log(`reason:   ${work.reason}`);
    return;
  }
  if (work.needsSetApproval) {
    console.log(`next:     the researcher approves the locked candidate set`);
    console.log(`reason:   ${work.reason}`);
    (work.locked ?? []).forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
    console.log(`command:  npm --prefix capture run approve-set -- --out <dir> \\`);
    console.log(`            --agency ${JSON.stringify(work.agency)} --category ${work.category}`);
    return;
  }
  if (work.needsLock) {
    console.log('next:     record discovered candidates, then lock the set');
    console.log(`terms:    ${(SEARCH_TERMS[work.category] ?? []).join(', ')}`);
    return;
  }
  console.log(`next:     assess ${work.pending.length} locked candidate(s) still without an outcome`);
  work.pending.forEach((u) => console.log(`  - ${u}`));
}

/**
 * Records the next agency in the frozen order as exhausted.
 *
 * `--agency` is a check, not an argument: the agency comes from the draw order, and naming a
 * different one is refused rather than honoured, because exhausting out of turn would break the
 * sampling claim the draw order makes.
 */
function doExhaust() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const drawOrder = parseDrawOrder(
    readFile(new URL('../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
  );
  // selection-v1.0.23. Neither the reason nor the resolution may be supplied. They were never
  // accepted, but an omission is not a rule: refusing the flags outright says so, and says it at
  // the point where an operator would try.
  for (const forbidden of ['reason', 'resolution']) {
    if (flag(forbidden) !== null) {
      die(
        `--${forbidden} cannot be given. The agency resolution is derived from the discovery ` +
          'records bound to its four sets, because it decides what the agency\'s absence from the ' +
          'corpus means. Correct the records if it is wrong.'
      );
    }
  }
  const record = exhaustAgency(log, drawOrder, { agency: flag('agency') });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log(`exhausted: ${record.agency} at ${record.exhaustedAt}`);
  console.log(`resolution: ${record.resolution}`);
  console.log(`reason:    ${record.reason}`);
  if (record.attritionRecordIds?.length) {
    console.log(`supported by ${record.attritionRecordIds.length} attrition record(s): ${record.attritionRecordIds.join(', ')}`);
    for (const [outcome, n] of Object.entries(record.attritionByOutcome ?? {})) {
      console.log(`  ${outcome}: ${n}`);
    }
  }
  for (const [category, version] of Object.entries(record.categorySetVersions)) {
    console.log(`  ${category.padEnd(28)} set v${version}`);
  }
}

/**
 * Checks the robots policy BEFORE anything is navigated.
 *
 * For a permitted URL it writes a single-use permit that `discovery` will consume. For a forbidden
 * one it writes the `disallowed` record itself, marked `navigationPerformed: false` with a
 * `checkedAt` rather than a `navigatedAt`, and no request is ever made to the target.
 *
 * The policy is fetched once per origin and kept in the log, so running this repeatedly does not
 * generate a stream of unrecorded robots requests.
 */
async function doPreflightDiscovery() {
  const dir = require_('out');
  const agency = require_('agency');
  const website = require_('website');
  const url = require_('url');
  const category = require_('category');
  const setVersion = Number(require_('set-version'));
  const method = flag('method') ?? 'navigation';
  if (!DISCOVERY_METHODS.includes(method)) die(`--method must be one of ${DISCOVERY_METHODS.join(', ')}`);
  if (!CATEGORIES.includes(category)) die(`--category must be one of ${CATEGORIES.join(', ')}`);
  if (!Number.isInteger(setVersion) || setVersion < 1) die('--set-version must be a positive integer');

  const parsed = validateUrl(url);
  const logPath = logPathFor(dir);
  const log = readLog(logPath);

  // selection-v1.0.12: the round exists from its first inspection. Previously a candidate set
  // was created only when candidates were recorded, so a round could accumulate discovery
  // records that no gate could see - every gate keyed off the set.
  const openedSet = recordCandidates(log, { agency, category, urls: [] });
  if (openedSet.version !== setVersion) {
    die(
      `the active round for ${agency} / ${category} is version ${openedSet.version}, not ` +
        `${setVersion}. Supersede the set before starting a new round.`
    );
  }

  // RFC 9309 section 2.4: cached robots content should generally not be used beyond 24 hours. A
  // permanently cached policy could authorise a path that has since become disallowed.
  // Checked before any network request, including the robots fetch: a refusal must not itself
  // generate traffic.
  const alreadyOpen = findOpenPermit(log, { agency, category, candidateSetVersion: setVersion, url });
  if (alreadyOpen) {
    die(
      `permit ${alreadyOpen.id} is already open for ${url}, issued at ${alreadyOpen.issuedAt}.\n` +
        'Use it, or close it with `close-permit` before issuing another. No request was made.'
    );
  }

  const cached = findRobotsCheck(log, parsed.origin);
  let check = has('recheck-robots') || !robotsCheckIsFresh(cached) ? null : cached;
  let fetched = false;
  if (!check) {
    check = recordRobotsCheck(log, await fetchRobotsPolicy(parsed.origin));
    fetched = true;
  }

  const verdict = evaluatePolicy(check, parsed.pathname + parsed.search, 'chromium');
  if (verdict.allowed) {
    const permit = issueDiscoveryPermit(log, {
      agency, category, candidateSetVersion: setVersion, url,
      robotsCheckId: check.id, reason: verdict.reason ?? null,
    });
    writeLog(logPath, log);
    console.log(`permit ${permit.id}: ${url}`);
    console.log(`robots: ${check.disposition} (HTTP ${check.httpStatus ?? 'unreachable'})${fetched ? ' [fetched]' : ' [reused]'}`);
    if (verdict.crawlDelay) console.log(`crawl-delay: ${verdict.crawlDelay}s`);
    return;
  }

  // Withheld: record it directly and make no request to the target.
  //
  // selection-v1.0.21. Two reasons to withhold, and they are not the same finding. `disallowed`
  // says the host published a policy forbidding this path. An unestablished policy says the host
  // published nothing we could read - so recording it as `disallowed` would put a refusal in the
  // record that no server ever made, and would attribute to the agency a decision it did not take.
  appendAttempt(log, {
    examinedAt: now(), agency, website, url,
    status: 'discovery', discoveryKind: method,
    outcome: verdict.unestablished ? 'robots-unestablished' : 'disallowed',
    category, candidateSetVersion: setVersion,
    navigationPerformed: false,
    checkedAt: now(),
    robotsCheckId: check.id,
    note: flag('note') ?? `NOT NAVIGATED. ${verdict.reason}`,
    approval: APPROVAL.APPROVED,
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log(
    verdict.unestablished
      ? `no robots policy established, recorded without navigating: ${url}`
      : `disallowed, recorded without navigating: ${url}`
  );
  console.log(`reason: ${verdict.reason}`);
}

/**
 * Re-reads one origin's robots policy and appends the result. Nothing else is requested.
 *
 * selection-v1.0.21. Needed because a policy recorded under the old classifier may be wrong about
 * what it read, and the correction has to be a fresh observation rather than a re-labelling of the
 * old record - which is append-only and stays exactly as it was. `/robots.txt` is implicitly
 * allowed by RFC 9309 section 2.2.2, so this needs no permit; it records its own request.
 */
async function doRecheckRobots() {
  const dir = require_('out');
  const origin = new URL(require_('origin')).origin;
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const previous = findRobotsCheck(log, origin);
  const check = recordRobotsCheck(log, await fetchRobotsPolicy(origin));
  writeLog(logPath, log);
  console.log(`${check.id} ${origin} HTTP ${check.httpStatus ?? 'unreachable'} -> ${check.disposition}`);
  console.log(`content-type: ${check.contentType ?? 'none'}  bytes: ${check.bytes}  sha256: ${check.sha256.slice(0, 16)}`);
  if (check.representation) console.log(`representation: ${check.representation.reason}`);
  if (check.representation?.challenge) console.log(`challenge: ${check.representation.challenge}`);
  if (previous) {
    console.log(`previous: ${previous.id} ${previous.disposition} (${previous.fetchedAt}) - retained unchanged`);
  }
}

/**
 * Records an OBSERVATION from the rendered DOM. It concludes nothing.
 *
 * selection-v1.0.25. `--outcome` used to be required here, before the page had been rendered — and
 * that is precisely how `d-0306` came to record `no-candidates` about a page carrying First, Middle
 * and Last name inputs: the judgement was supplied first and the evidence read afterwards, so the
 * render summary was written down instead of the DOM. Observation and judgement are now two steps,
 * and the second one makes no request.
 *
 * Consumes a fresh permit, paces like every other navigation, and writes the rendered markup into
 * the private data tree rather than beside the corpus captures. Nothing is typed, clicked or
 * submitted, and no challenge is answered.
 */
async function doRenderDiscovery() {
  const dir = require_('out');
  const agency = require_('agency');
  const website = require_('website');
  const url = require_('url');
  const category = require_('category');
  const setVersion = Number(require_('set-version'));
  const method = flag('method') ?? 'navigation';
  const permitId = require_('permit-id');
  const settleMs = Number(flag('settle-ms') ?? POLICY.postLoadSettleMs);

  if (flag('outcome') !== null) {
    die(
      '--outcome cannot be given to render-discovery. A render records what was retrieved and ' +
        'concludes nothing; run `classify-render` once you have read the evidence. Supplying the ' +
        'judgement first is what produced d-0306.'
    );
  }
  if (!RENDERED_METHODS.includes(method)) {
    die(
      `--method must be one of ${RENDERED_METHODS.join(', ')}. A rendered DOM is the authoritative ` +
        'evidence for a page; robots.txt, sitemaps, status codes and non-HTML files are read plainly.'
    );
  }
  if (!CATEGORIES.includes(category)) die(`--category must be one of ${CATEGORIES.join(', ')}`);
  if (!Number.isInteger(setVersion) || setVersion < 1) die('--set-version must be a positive integer');

  validateUrl(url);
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const renderedDir = join(resolve(dir), 'rendered');

  // The permit is checked BEFORE the browser opens. It used to be consumed after the render, so an
  // expired, closed or mismatched permit was discovered only once the request had already been made.
  // A permit is meant to be a precondition of traffic, not a comment on it.
  assertPermitUsable(log, { agency, category, candidateSetVersion: setVersion, url, permitId });

  await pacer.beforeNavigation(null);
  const rendered = await renderDiscoveryPage({
    browserFactory: () => chromium.launch({ headless: true }),
    url, outDir: renderedDir, recordId: `g${Date.now()}`, settleMs,
    browserMode: 'headless',
  });

  const permit = consumeDiscoveryPermit(log, {
    agency, category, candidateSetVersion: setVersion, url,
    navigatedAt: rendered.navigatedAt, permitId,
  });
  const render = recordRender(log, {
    url, finalUrl: rendered.finalUrl, navigatedAt: rendered.navigatedAt, permitId: permit.id,
    renderFile: rendered.renderFile, renderedSha256: rendered.renderedSha256,
    renderedBytes: rendered.renderedBytes, httpStatus: rendered.httpStatus,
    loadState: rendered.loadState, domNodes: rendered.domNodes,
    linkCount: rendered.links.length, formCount: rendered.forms.length,
    controlCount: rendered.controls.length, buttonCount: rendered.buttons,
    accessBarriers: rendered.accessBarriers, submissionProtection: rendered.submissionProtection,
    authenticationSignals: rendered.authenticationSignals, title: rendered.title,
    browser: rendered.browser, browserMode: rendered.browserMode, userAgent: rendered.userAgent,
    viewport: rendered.viewport, locale: rendered.locale, settleMs: rendered.settleMs,
  });

  // A challenge is mechanical, so the harness states it. Everything else is left unjudged.
  const outcome = rendered.accessBarriers.length > 0 ? 'retrieval-blocked' : 'rendered';
  appendAttempt(log, {
    recordType: 'observation',
    permitId: permit.id,
    renderId: render.id,
    examinedAt: now(), agency, website, url,
    status: 'discovery', discoveryKind: method, outcome, category, candidateSetVersion: setVersion,
    navigatedAt: rendered.navigatedAt,
    finalUrl: rendered.finalUrl,
    evidence: rendered.evidence,
    renderFile: rendered.renderFile,
    renderedSha256: rendered.renderedSha256,
    renderedBytes: rendered.renderedBytes,
    httpStatus: rendered.httpStatus,
    loadState: rendered.loadState,
    domNodes: rendered.domNodes,
    linkCount: rendered.links.length,
    formCount: rendered.forms.length,
    controlCount: rendered.controls.length,
    buttonCount: rendered.buttons,
    accessBarriers: rendered.accessBarriers,
    submissionProtection: rendered.submissionProtection,
    authenticationSignals: rendered.authenticationSignals,
    ...(flag('note') ? { note: flag('note') } : {}),
    approval: APPROVAL.APPROVED,
    politeness: { userAgent: rendered.userAgent, settleMs, browserMode: rendered.browserMode },
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });

  const record = log.attempts.at(-1);
  console.log(`recorded ${record.id}: observation ${render.id} (${method}, ${category} v${setVersion}) -> ${outcome}`);
  console.log(
    `HTTP ${rendered.httpStatus ?? '-'}  ${rendered.domNodes} DOM nodes, ${rendered.links.length} link(s), ` +
      `${rendered.forms.length} form element(s), ${rendered.controls.length} control(s), ${rendered.buttons} button(s)`
  );
  console.log(`rendered bytes: ${rendered.renderedBytes} sha256 ${rendered.renderedSha256.slice(0, 16)} (private: rendered/${rendered.renderFile})`);
  if (rendered.title) console.log(`title: ${rendered.title}`);
  if (rendered.accessBarriers.length) console.log(`accessBarriers: ${rendered.accessBarriers.join(', ')}`);
  if (rendered.submissionProtection.length) console.log(`submissionProtection: ${rendered.submissionProtection.join(', ')}`);
  for (const f of rendered.forms.slice(0, 6)) {
    console.log(`  form ${f.method} ${f.action || '(self)'} -> ${f.controls.length} control(s)`);
  }
  // Printed whether or not a `<form>` element exists: a page with none can still be a form. The
  // accessible name is printed because `q7` does not tell a reader it means "First name".
  for (const c of rendered.controls.slice(0, 30)) {
    console.log(
      `  control ${c.tag}${c.type ? `[${c.type}]` : ''}${c.name ? ` name=${c.name}` : ''}` +
        `${c.id ? ` id=${c.id}` : ''}${c.maxlength ? ` maxlength=${c.maxlength}` : ''}` +
        `${c.accessibleName ? `  <- ${JSON.stringify(c.accessibleName.slice(0, 60))}` : ''}`
    );
  }
  if (rendered.controls.length > 30) console.log(`  ... and ${rendered.controls.length - 30} more control(s)`);
  for (const l of rendered.links.slice(0, 40)) console.log(`  link ${l}`);
  if (rendered.links.length > 40) console.log(`  ... and ${rendered.links.length - 40} more link(s)`);
  console.log('');
  console.log(`Nothing is judged yet. Run \`classify-render --render ${render.id} --category <c> --outcome <o>\`.`);
}

/** Registers a render recorded before the registry existed, verifying its bytes first. */
function doAdoptRender() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const render = adoptRender(log, { fromAttemptId: require_('from'), capturesRoot: resolve(dir) });
  writeLog(logPath, log);
  console.log(`registered ${render.id} from ${render.adoptedFrom}: ${render.renderFile}`);
  console.log(`verified ${render.renderedBytes} bytes, sha256 ${render.renderedSha256.slice(0, 16)}`);
}

/**
 * Records a category-specific judgement on evidence already held. Makes no request.
 *
 * One render supports as many judgements as it has categories: a page is routinely `no-candidates`
 * for account registration and `candidates-found` for service application, and tying the judgement
 * to the observation record made that impossible to express.
 */
function doClassifyRender() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const renderId = require_('render');
  const category = require_('category');
  const outcome = require_('outcome');
  const setVersion = Number(require_('set-version'));

  if (!JUDGEMENT_OUTCOMES.includes(outcome)) {
    die(`--outcome must be ${JUDGEMENT_OUTCOMES.join(' or ')}; a judgement says whether the page yields candidates`);
  }
  if (!CATEGORIES.includes(category)) die(`--category must be one of ${CATEGORIES.join(', ')}`);
  if (!Number.isInteger(setVersion) || setVersion < 1) die('--set-version must be a positive integer');

  const problems = assertRenderEvidenceUsable(log, { renderId, capturesRoot: resolve(dir) });
  if (problems.length) die(`the render evidence cannot be relied on:\n  ${problems.join('\n  ')}`);
  const render = findRender(log, renderId);
  const observation = log.attempts.find(
    (a) => a.renderId === renderId && a.recordType === 'observation'
  ) ?? log.attempts.find((a) => a.renderFile === render.renderFile);
  if (!observation) die(`no observation record names render ${renderId}`);

  const answers = flag('answers');
  if (answers) {
    const target = log.attempts.find((a) => a.id === answers);
    if (!target) die(`--answers ${answers} matches no recorded attempt`);
    if (target.category !== category) {
      die(
        `--answers ${answers} is a ${target.category} record, but this judgement is for ${category}. ` +
          'A judgement answers a record in its own category; one render supports one judgement per category.'
      );
    }
  }

  appendAttempt(log, {
    recordType: 'judgement-only',
    renderId,
    evidenceFromDiscoveryId: observation.id,
    ...(answers ? { rendersDiscoveryId: answers } : {}),
    examinedAt: now(), agency: observation.agency, website: observation.website, url: render.url,
    status: 'discovery', discoveryKind: observation.discoveryKind, outcome,
    category, candidateSetVersion: setVersion,
    navigationPerformed: false,
    checkedAt: now(),
    evidence: 'rendered-dom',
    renderFile: render.renderFile,
    renderedSha256: render.renderedSha256,
    renderedBytes: render.renderedBytes,
    note: require_('note'),
    approval: APPROVAL.APPROVED,
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  const record = log.attempts.at(-1);
  console.log(`recorded ${record.id}: ${category} ${outcome} from ${renderId} (${observation.id})`);
  if (answers) console.log(`answers ${answers}, which is preserved unchanged`);
  console.log('No request was made for this judgement.');
}

/**
 * Corrects the JUDGEMENT on a discovery record, from evidence already held and re-verified.
 *
 * selection-v1.0.25. The first version of this was an integrity bypass. It could mint a modern
 * record with no permit — which the ledger read as a pre-permit legacy record — and it copied
 * whatever evidence fields the target happened to carry, including none at all. A correction that
 * rests on nothing is not a correction; it is a fresh assertion wearing the target's provenance.
 *
 * So a correction now requires a render that exists, whose file is on disk with the recorded length
 * and digest, and whose URL is the target's page; it names both the record it supersedes and the
 * observation its evidence comes from; it is explicitly a `judgement-only` record; and the target
 * must not already have been superseded.
 *
 * The correction this was written for is one of mine: the NZSIS reporting portal was recorded
 * `no-candidates` because the extractor counted controls only inside `<form>` elements and that page
 * has none, so a page carrying First, Middle and Last name fields was summarised as having no form
 * and I wrote the summary down instead of reading the DOM.
 */
function doCorrectDiscovery() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const targetId = require_('supersedes');
  const outcome = require_('outcome');

  if (!JUDGEMENT_OUTCOMES.includes(outcome)) {
    die(`--outcome must be ${JUDGEMENT_OUTCOMES.join(' or ')}; a correction corrects a judgement`);
  }
  const target = log.attempts.find((a) => a.id === targetId);
  if (!target) die(`${targetId} matches no recorded attempt`);
  if (target.status !== 'discovery') die(`${targetId} is a ${target.status} attempt`);
  if (target.outcome === outcome) {
    die(`${targetId} already records ${outcome}; a correction must change the judgement`);
  }
  if (isDiscoverySuperseded(log, targetId)) {
    die(`${targetId} has already been corrected; correct the correction instead`);
  }
  const renderId = target.renderId ?? findRenderForUrl(log, target.url)?.id ?? null;
  if (!renderId) {
    die(
      `${targetId} rests on no rendered evidence, so its judgement cannot be corrected from evidence ` +
        'already held. Render the page under a fresh permit and use `classify-render`.'
    );
  }
  const problems = assertRenderEvidenceUsable(log, { renderId, capturesRoot: resolve(dir) });
  if (problems.length) die(`the render evidence cannot be relied on:\n  ${problems.join('\n  ')}`);
  const render = findRender(log, renderId);
  if (canonicalise(render.url) !== canonicalise(target.url)) {
    die(`render ${renderId} is of ${render.url}, not ${target.url}`);
  }
  const observation = log.attempts.find(
    (a) => a.renderId === renderId && a.recordType === 'observation'
  ) ?? target;

  appendAttempt(log, {
    recordType: 'judgement-only',
    supersedesDiscoveryId: targetId,
    evidenceFromDiscoveryId: observation.id,
    renderId,
    examinedAt: now(), agency: target.agency, website: target.website, url: target.url,
    status: 'discovery', discoveryKind: target.discoveryKind, outcome,
    category: target.category, candidateSetVersion: target.candidateSetVersion,
    navigationPerformed: false,
    checkedAt: now(),
    evidence: 'rendered-dom',
    renderFile: render.renderFile,
    renderedSha256: render.renderedSha256,
    renderedBytes: render.renderedBytes,
    note: require_('note'),
    approval: APPROVAL.APPROVED,
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  const record = log.attempts.at(-1);
  console.log(`recorded ${record.id}: corrects ${targetId}, ${target.outcome} -> ${outcome}`);
  console.log(`evidence: ${renderId} ${render.renderFile} sha256 ${render.renderedSha256.slice(0, 16)} (re-verified)`);
  console.log(`${targetId} is preserved unchanged; no request was made for this correction`);
}

/**
 * Re-records an agency's resolution under the protocol now in force, keeping the old record.
 *
 * Takes no resolution and no reason FOR the resolution - only a reason for re-resolving, which is
 * recorded. The resolution itself is derived, exactly as it is the first time.
 */
function doReResolve() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  for (const forbidden of ['resolution', 'exhaustion-reason']) {
    if (flag(forbidden) !== null) die(`--${forbidden} cannot be given; the resolution is derived`);
  }
  const { record, previous } = reResolveExhaustion(log, {
    agency: require_('agency'), reason: require_('reason'),
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log(`re-resolved ${record.agency} at ${record.reResolvedAt}`);
  console.log(`  was: ${previous.resolution ?? 'bounded-discovery-complete (implied)'}`);
  console.log(`       ${previous.reason}`);
  console.log(`  now: ${record.resolution}`);
  console.log(`       ${record.reason}`);
  console.log(`exhausted at ${record.exhaustedAt} - unchanged; only the wording was corrected`);
}

/** Records a structured deviation from the frozen protocol, with the evidence it rests on. */
function doDeviation() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const list = (name) => (flag(name) ? flag(name).split(',').map((v) => v.trim()).filter(Boolean) : undefined);
  const deviation = recordDeviation(log, {
    kind: require_('kind'),
    summary: require_('summary'),
    detail: require_('detail'),
    ...(list('robots-checks') ? { robotsCheckIds: list('robots-checks') } : {}),
    ...(list('permits') ? { permitIds: list('permits') } : {}),
    ...(list('attempts') ? { attemptIds: list('attempts') } : {}),
    ...(flag('requests-affected') ? { requestsAffected: Number(flag('requests-affected')) } : {}),
    ...(has('no-candidate-evidence') ? { candidateEvidenceObtained: false } : {}),
    ...(list('corrected-by') ? { correctedBy: list('corrected-by') } : {}),
  });
  writeLog(logPath, log);
  console.log(`recorded deviation ${deviation.id}: ${deviation.kind}`);
}

/**
 * Reopens a locked but unapproved set so a discovery correction can be bound into it.
 *
 * The previous lock is preserved in `lockHistory` with the reason for reopening, so the fact that
 * the set was once locked differently is part of the record rather than overwritten.
 */
function doReopenSet() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const set = reopenCandidateSet(log, {
    agency: require_('agency'), category: require_('category'), reason: require_('reason'),
  });
  writeLog(logPath, log);
  const previous = set.lockHistory.at(-1);
  console.log(`reopened ${set.agency} / ${set.category} v${set.version}`);
  console.log(`previous lock: ${previous.lockedAt}, ${previous.discoveryRecordIds.length} bound record(s)`);
  console.log(`reason: ${previous.reason}`);
}

/** Closes an open permit with an explicit account of what happened under it. */
function doClosePermit() {
  const dir = require_('out');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const permit = closeDiscoveryPermit(log, {
    permitId: require_('permit-id'),
    disposition: require_('disposition'),
    reason: require_('reason'),
    accountedBy: flag('accounted-by'),
  });
  writeLog(logPath, log);
  console.log(`closed ${permit.id} as ${permit.disposition} (${permit.closureId})`);
  if (permit.accountedBy) console.log(`accounted by ${permit.accountedBy}`);
}

const commands = { packet: doPacket, candidates: doCandidates, lock: doLock, 'approve-set': doApproveSet,
  'supersede-set': doSupersedeSet, publish: doPublish, next: doNext, capture: doCapture, exclude: doExclude, discovery: doDiscovery, budget: doBudget, approve: doApprove, status: doStatus, build: doBuild, exhaust: doExhaust, 'preflight-discovery': doPreflightDiscovery, 'reopen-set': doReopenSet, 'close-permit': doClosePermit,
  deviation: doDeviation, 'recheck-robots': doRecheckRobots, 're-resolve': doReResolve,
  'render-discovery': doRenderDiscovery, 'correct-discovery': doCorrectDiscovery,
  'classify-render': doClassifyRender, 'adopt-render': doAdoptRender };
if (!commands[command]) die(USAGE);
try {
  await commands[command]();
} catch (error) {
  die(error.message);
}
