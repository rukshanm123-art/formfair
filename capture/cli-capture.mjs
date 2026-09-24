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
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { capturePage, validateUrl, validatePageId, CATEGORIES } from './capture.mjs';
import { POLICY, parseRobots, isAllowed, createPacer } from './politeness.mjs';
import {
  readLog, writeLog, appendAttempt, writeDerived, ELIGIBILITY_CRITERIA, APPROVAL,
  recordCandidates, lockCandidateSet, categorySettled, approveCandidateSet,
  supersedeCandidateSet, publishProvenance,
} from './run.mjs';
import {
  DISCOVERY_KINDS, remainingBudget, canonicalise, SEARCH_TERMS, parseDrawOrder, nextWork,
} from './selection.mjs';
import { readFileSync as readFile } from 'node:fs';

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
  cli-capture.mjs exclude --out <dir> --agency <name> --website <url> --url <url>
                          --reason "<why it was not captured>" --category <c>
  cli-capture.mjs discovery --out <dir> --agency <name> --website <url> --url <url>
                          --kind <${DISCOVERY_KINDS.join('|')}> --navigated-at <ISO8601Z>
  cli-capture.mjs candidates --out <dir> --agency <name> --category <c> --add <url>[,<url>...]
  cli-capture.mjs lock    --out <dir> --agency <name> --category <c>
  cli-capture.mjs approve-set --out <dir> --agency <name> --category <c>
                          [--reject] [--note "<why>"]
  cli-capture.mjs supersede-set --out <dir> --agency <name> --category <c>
                          --reason "<why the rejected set is being redone>"
  cli-capture.mjs publish --out <dir> --to <tracked dir>
  cli-capture.mjs next    --out <dir>
  cli-capture.mjs budget  --out <dir> --agency <name> [--category <c>]
  cli-capture.mjs approve --out <dir> --url <url> [--reject --reason "<why>"]
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

/** Fetches and parses robots.txt for an origin, cached for the life of the process. */
const robotsCache = new Map();
async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let groups = null;
  try {
    const res = await fetch(new URL('/robots.txt', origin), { redirect: 'follow' });
    if (res.ok) groups = parseRobots(await res.text());
  } catch {
    groups = null; // Unreachable robots.txt is treated as absent, which is standard.
  }
  robotsCache.set(origin, groups);
  return groups;
}

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

  const base = { examinedAt: now(), agency, website, url };

  // robots.txt decides before anything is fetched from the site itself.
  const groups = await robotsFor(parsed.origin);
  const verdict = isAllowed(groups, parsed.pathname + parsed.search, 'chromium');
  if (!verdict.allowed) {
    const attempt = {
      ...base, status: 'excluded', category,
      exclusionReason: `robots.txt disallows this path (${verdict.reason})`,
      eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
      politeness: { robots: verdict.reason },
    };
    appendAttempt(log, attempt);
    writeLog(logPath, log);
    writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
    console.log(`excluded: robots.txt disallows ${url}`);
    return;
  }

  await pacer.beforeNavigation(verdict.crawlDelay ?? null);

  let record = null;
  let lastError = null;
  for (let attemptNo = 1; attemptNo <= 1 + POLICY.transientRetries; attemptNo++) {
    try {
      record = await capturePage({
        browserFactory: () => chromium.launch(),
        url, agency, website, pageId, category, outDir: capturesDir, settleMs,
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

  if (record.httpStatus === 429) {
    die('HTTP 429 received. The run stops here by policy. Respect Retry-After before resuming.');
  }

  // A page behind a sign-in, CAPTCHA or blocking control is ineligible by the protocol's
  // first criterion, and nothing here attempts to get past one.
  if (record.blocking.length > 0) {
    appendAttempt(log, {
      ...base, status: 'excluded', category, finalUrl: record.finalUrl,
      exclusionReason: `not publicly reachable: ${record.blocking.join(', ')}`,
      eligibility: { ...Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
        publiclyReachableWithoutSigningIn: false },
      politeness: { robots: verdict.reason, userAgent: record.userAgent },
    });
    writeLog(logPath, log);
    writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
    console.log(`excluded: ${record.blocking.join(', ')}`);
    return;
  }

  appendAttempt(log, {
    ...base, ...record, status: 'captured',
    inclusionEvidence: evidence,
    eligibility: {
      // Mechanically established by this run.
      publiclyReachableWithoutSigningIn: record.blocking.length === 0,
      nameFieldVisibleWithoutEnteringDataOrSubmitting: true,
      normalHtmlOrBrowserRenderedNotPdfOrNative: true,
      // Proposed by the operator and confirmed at approval, per the frozen criteria.
      reachedFromFrameWebsiteForThatAgency: true,
      asksForTheNameOfANaturalPerson: true,
    },
    politeness: { robots: verdict.reason, userAgent: record.userAgent, settleMs },
  });
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
  appendAttempt(log, {
    examinedAt: now(),
    agency: require_('agency'), website: require_('website'), url: require_('url'),
    status: 'excluded', exclusionReason: require_('reason'), category: flag('category') ?? undefined,
    eligibility: Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null])),
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log('recorded exclusion');
}

function doApprove() {
  const dir = require_('out');
  const url = require_('url');
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  const attempt = log.attempts.find((a) => a.url === url);
  if (!attempt) die(`no recorded attempt for ${url}`);
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
  console.log(`${attempt.approval}: ${url}`);
}

function doStatus() {
  const log = readLog(logPathFor(require_('out')));
  const by = (p) => log.attempts.filter(p).length;
  console.log(`attempts        ${log.attempts.length}`);
  console.log(`  captured      ${by((a) => a.status === 'captured')}`);
  console.log(`  excluded      ${by((a) => a.status === 'excluded')}`);
  console.log(`  failed        ${by((a) => a.status === 'failed')}`);
  console.log(`pending approval ${by((a) => a.approval === APPROVAL.PENDING)}`);
  const approvedCaptures = by((a) => a.status === 'captured' && a.approval === APPROVAL.APPROVED);
  console.log(`approved captures ${approvedCaptures} of a target of 40`);
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

function doDiscovery() {
  const dir = require_('out');
  const kind = require_('kind');
  if (!DISCOVERY_KINDS.includes(kind)) die(`--kind must be one of ${DISCOVERY_KINDS.join(', ')}`);
  const logPath = logPathFor(dir);
  const log = readLog(logPath);
  appendAttempt(log, {
    examinedAt: now(), agency: require_('agency'), website: require_('website'),
    url: require_('url'), status: 'discovery', discoveryKind: kind,
    // Discovery browsing happens outside the capture harness, so its navigation time is
    // recorded and checked against the previous one rather than paced by the pacer.
    navigatedAt: require_('navigated-at'),
    approval: APPROVAL.APPROVED, // a page inspected to find links is not a judgement to approve
  });
  writeLog(logPath, log);
  writeDerived({ log, dir, frameSha256: flag('frame-sha256'), drawOrderSha256: flag('draw-order-sha256'), synthetic: has('synthetic') });
  console.log(`recorded discovery page (${kind})`);
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
  const r = publishProvenance(log, { to: require_('to') });
  console.log(`ledger:     ${r.ledgerPath}`);
  console.log(`provenance: ${r.provenancePath}`);
  console.log('These carry no markup and are safe to track.');
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
  const urls = require_('add').split(',').map((u) => u.trim()).filter(Boolean);
  const set = recordCandidates(log, { agency: require_('agency'), category: require_('category'), urls });
  writeLog(logPath, log);
  console.log(`${set.discovered.length} candidate URL(s) recorded; the set is still open`);
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
    return console.log(`${work.agency}: every category is settled with no eligible form. Record it as exhausted.`);
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

const commands = { candidates: doCandidates, lock: doLock, 'approve-set': doApproveSet,
  'supersede-set': doSupersedeSet, publish: doPublish, next: doNext, capture: doCapture, exclude: doExclude, discovery: doDiscovery, budget: doBudget, approve: doApprove, status: doStatus, build: doBuild };
if (!commands[command]) die(USAGE);
try {
  await commands[command]();
} catch (error) {
  die(error.message);
}
