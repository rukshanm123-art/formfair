import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULE_IDS = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];

export const sha256 = (value) =>
  createHash('sha256').update(typeof value === 'string' ? Buffer.from(value, 'utf8') : value).digest('hex');

const ratio = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator,
});

function attributes(node) {
  return Object.fromEntries((node.attrs ?? []).map((a) => [a.name.toLowerCase(), a.value]));
}

function supportedInputCount(html, parseFragment) {
  const root = parseFragment(html);
  let count = 0;
  const walk = (node) => {
    if (node.tagName === 'input') {
      const attrs = attributes(node);
      const type = (attrs.type ?? 'text').trim().toLowerCase();
      if (type === '' || type === 'text' || type === 'search') count += 1;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
  return count;
}

const increment = (record, key, by = 1) => {
  record[key] = (record[key] ?? 0) + by;
};

export function loadSealedPages({ manifest, manifestPath, capturesDir, captureRoot = null }) {
  const problems = [];
  if (manifest?.schema !== 'formfair/solo-corpus@1') problems.push('manifest schema must be formfair/solo-corpus@1');
  if (!Array.isArray(manifest?.pages) || manifest.pages.length === 0) problems.push('manifest must contain at least one page');
  const ids = new Set();
  const pages = [];
  const root = resolve(capturesDir);

  if (typeof manifest?.selectionLedger?.file !== 'string' || typeof manifest?.selectionLedger?.sha256 !== 'string') {
    problems.push('manifest must seal the selection ledger');
  } else {
    const ledgerPath = resolve(root, manifest.selectionLedger.file);
    if (relative(root, ledgerPath).startsWith('..')) {
      problems.push('selection ledger escapes the captures directory');
    } else {
      try {
        const actual = sha256(readFileSync(ledgerPath));
        if (actual !== manifest.selectionLedger.sha256) problems.push('selection ledger hash mismatch');
      } catch (error) {
        problems.push(`cannot read selection ledger: ${error.message}`);
      }
    }
  }

  // solo-protocol-v1.0.3. The capture log is re-read and re-verified, not merely recorded.
  //
  // The manifest carried its digest and nothing ever checked it again, so the one artefact
  // proving which searches actually happened could be edited after sealing without any later
  // step noticing. Both the hash and the byte count are checked: a length check catches a
  // truncation cheaply and makes a mismatch easier to diagnose than a bare digest difference.
  if (manifest?.captureLog !== null && manifest?.captureLog !== undefined) {
    const seal = manifest.captureLog;
    if (typeof seal?.file !== 'string' || typeof seal?.sha256 !== 'string' || !Number.isInteger(seal?.bytes)) {
      problems.push('manifest.captureLog must name the log file, its sha256 and its byte count');
    } else {
      const logRoot = resolve(captureRoot ?? dirname(root));
      const logPath = resolve(logRoot, seal.file);
      if (relative(logRoot, logPath).startsWith('..')) {
        problems.push('the sealed capture log escapes the capture root');
      } else {
        try {
          const bytes = readFileSync(logPath);
          if (bytes.length !== seal.bytes) {
            problems.push(
              `capture log byte count mismatch: sealed ${seal.bytes}, on disk ${bytes.length}`
            );
          }
          if (sha256(bytes) !== seal.sha256) problems.push('capture log hash mismatch');
        } catch (error) {
          problems.push(`cannot read the sealed capture log: ${error.message}`);
        }
      }
    }
  }

  for (const [index, page] of (manifest?.pages ?? []).entries()) {
    const where = `pages[${index}]`;
    if (typeof page?.pageId !== 'string' || page.pageId.length === 0) problems.push(`${where}.pageId is required`);
    if (ids.has(page?.pageId)) problems.push(`${where}: duplicate pageId ${page.pageId}`);
    ids.add(page?.pageId);
    if (typeof page?.file !== 'string' || page.file.length === 0) {
      problems.push(`${where}.file is required`);
      continue;
    }
    if (isAbsolute(page.file)) {
      problems.push(`${where}.file must be relative to the captures directory`);
      continue;
    }
    const path = resolve(root, page.file);
    if (relative(root, path).startsWith('..')) {
      problems.push(`${where}.file escapes the captures directory`);
      continue;
    }
    let html;
    try {
      html = readFileSync(path, 'utf8');
    } catch (error) {
      problems.push(`${where}: cannot read ${path}: ${error.message}`);
      continue;
    }
    const actual = sha256(html);
    if (actual !== page.sha256) problems.push(`${where}: hash mismatch for ${page.file}`);
    pages.push({ ...page, html, path });
  }

  if (problems.length > 0) return { pages: null, problems };
  return {
    pages,
    manifestSha256: sha256(readFileSync(manifestPath)),
    problems: [],
  };
}

/**
 * The frozen frame artefacts, pinned by content rather than by filename.
 *
 * frame-v1.0.0 fixes the sampling frame and the agency draw order, and every sampled page
 * inherits its legitimacy from them. An earlier version of this seal checked only that the
 * draft's declared hashes were 64 hex characters, so a draft could assert any digest -
 * including sixty-four zeros - and seal successfully. Both files are now read and hashed on
 * every seal, and both must match these values and the draft's declaration.
 *
 * Recorded in evaluation/frame/README.md. Changing either requires a new frame tag and a
 * new draw order, which would reroll the sample.
 */
export const FROZEN_FRAME_SHA256 = '11a0bcd30489648050dc287775d88cc4d99c54e2c9022b7226f157796df8c3ce';
export const FROZEN_DRAW_ORDER_SHA256 = '30dc8c27bbf601ce43da2d781c4bdff43db5dd074704268bb2532a21ce0fabf1';

const FRAME_FILES = [
  { key: 'frameSha256', file: 'frame.csv', frozen: FROZEN_FRAME_SHA256 },
  { key: 'drawOrderSha256', file: 'draw-order.csv', frozen: FROZEN_DRAW_ORDER_SHA256 },
];


/**
 * The exhaustion contract, duplicated here deliberately.
 *
 * `evaluation/` is dependency-free by design: building evaluation tooling must not be able to
 * change the instrument the evaluation runs with, and importing the capture package would end
 * that. So the frozen reason and the qualification target are restated here, and a test asserts
 * these constants are identical to the capture package's. The seal is the authority: a record
 * whose reason differs from this string does not seal, whatever wrote it.
 */
/**
 * The protocol version this sealer implements.
 *
 * It was a default of `solo-protocol-v1.0.0`, so a manifest produced by the v1.0.1 sealer
 * declared it had been sealed under the previous protocol - the one whose seal did not read the
 * exhaustion records at all. A manifest that misnames its own protocol is worse than one that
 * omits it: a reader checking which rules a corpus was sealed under would be told the wrong ones.
 */
export const SOLO_PROTOCOL_TAG = 'solo-protocol-v1.0.42';

/**
 * Two resolutions, mirrored from the capture package and checked equal by a test.
 *
 * solo-protocol-v1.0.4. One frozen reason asserted that all four categories "were searched". For
 * an agency whose websites answer every request with a bot-management challenge that is false:
 * the categories were attempted. Sealing it under the bounded-discovery-complete reason would put a
 * completed search into the denominator of every prevalence figure on the strength of requests
 * that returned no agency content.
 */
/**
 * solo-protocol-v1.0.5. `bounded-discovery-complete` overclaimed in its turn. The procedure is BOUNDED - five
 * candidates a category, four methods, and a robots-disallowed URL deliberately never retrieved -
 * so what runs to completion is a fixed procedure, not an exhaustive examination of an agency's web
 * presence. Where a `Disallow` was honoured, what was read is the robots POLICY, not the page.
 */
export const AGENCY_RESOLUTIONS = Object.freeze({
  BOUNDED_DISCOVERY_COMPLETE: 'bounded-discovery-complete',
  TECHNICAL_ATTRITION: 'technical-discovery-attrition',
});

export const BOUNDED_COMPLETE_REASON =
  'the frozen bounded discovery procedure was completed for all four categories in the priority ' +
  'order, and no eligible form was located';

export const ATTRITION_REASON =
  'technical retrieval barriers prevented the frozen bounded discovery procedure from completing, ' +
  'and no eligible form was located';

export const RESOLUTION_REASONS = Object.freeze({
  [AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE]: BOUNDED_COMPLETE_REASON,
  [AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION]: ATTRITION_REASON,
});

/**
 * Wordings frozen under earlier protocols. Recognised so the seal can SAY what such a record is,
 * never accepted as current: an exhaustion recorded under superseded wording must be re-resolved
 * before it can be sealed, or a manifest would carry a claim the protocol has since withdrawn.
 */
/**
 * The render ledger rules, mirrored from the capture package and held to it by a conformance test.
 *
 * solo-protocol-v1.0.7. `evaluation/` must not import `capture/`, so these rules exist twice. The
 * duplication is only safe if the two are checked against each other over the same inputs, and the
 * previous sealing-time check was a weaker second implementation rather than a mirror — it verified
 * bytes and URLs and none of the semantics, while the protocol claimed one shared validator.
 *
 * Returns problems rather than throwing, in the order the capture package produces them.
 */
/**
 * Amendment 39, mirrored. Every rendered observation must carry exactly one judgement of its own
 * category and round.
 *
 * An independent implementation on purpose: the capture package's `unjudgedRenderedObservations`
 * is the gate at lock and approval, and this is the gate at seal. A round whose evidence was
 * retrieved and never read must fail both, including when it reaches the sealer by a route that
 * never touched the capture CLI.
 *
 * Two distinctions the first cut got wrong, kept here so this copy cannot drift back to them.
 * A judgement is linked by EITHER `answersDiscoveryId` or `evidenceFromDiscoveryId`: a fresh
 * render answers its own observation, while a retrospective judgement answers the original
 * plain-retrieval record and merely cites the observation as evidence. And uniqueness is scoped to
 * the observation's own category and round, because one render legitimately supports a separate
 * judgement in every category it was examined under.
 */
/**
 * Amendment 41, mirrored. A locked candidate is settled only by a terminal decision, and an
 * evidence-only retrieval is not one.
 *
 * Independent of the capture package on purpose. The attack this closes was reproduced on a copy of
 * the live log: delete the exclusion, mark the retrieval approved, approve the rest, and both
 * `nextWork` and `corpusBlockers` fell silent while a locked candidate had never been decided. A
 * seal must refuse that state even when it is reached by a route that never touched the capture CLI.
 */
export function terminalDecisionProblems(log) {
  const TERMINAL = ['captured', 'excluded', 'eligible-not-selected', 'failed', 'capture-blocked'];
  const problems = [];
  const attempts = Array.isArray(log.attempts) ? log.attempts : [];
  const superseded = new Set(
    attempts.map((a) => a.supersedesAttemptId).filter((id) => id !== undefined && id !== null)
  );
  const canon = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };

  // A retrieval decides nothing, so it must not wear a decision's approval.
  for (const a of attempts) {
    if (a.status !== 'retrieved') continue;
    if (a.approval !== 'not-applicable') {
      problems.push(
        `${a.id} is an evidence-only retrieval recording approval ${JSON.stringify(a.approval)}; ` +
          'it must be not-applicable'
      );
    }
  }
  for (const a of attempts) {
    if (a.status !== 'retrieved' && a.approval === 'not-applicable') {
      problems.push(`${a.id} is a ${a.status} attempt recording approval not-applicable`);
    }
  }

  for (const [key, set] of Object.entries(log.candidateSets ?? {})) {
    const [agency, category] = key.split('\u0000');
    for (const url of set.locked ?? []) {
      const decisions = attempts.filter(
        (a) => a.agency === agency && TERMINAL.includes(a.status) &&
          canon(a.url) === canon(url) && !superseded.has(a.id)
      );
      const where = `${agency} / ${category}: ${url}`;
      if (decisions.length === 0) {
        const held = attempts.find(
          (a) => a.status === 'retrieved' && a.agency === agency && canon(a.url) === canon(url)
        );
        problems.push(
          `${where} has no active terminal decision` +
            (held ? ` (${held.id} holds its bytes, which decides nothing)` : '')
        );
      } else if (decisions.length > 1) {
        problems.push(
          `${where} has ${decisions.length} active terminal decisions (${decisions.map((d) => d.id).join(', ')})`
        );
      }
    }
  }

  // Amendment 44, mirrored. An eligible-but-not-selected record claims that every criterion was
  // satisfied and that another candidate in the same locked set won the frozen tie-break. Both
  // halves are checked independently here, because a seal must refuse a tie-break that the rule
  // did not make even when the capture package never saw the log.
  const canonUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };
  for (const a of attempts) {
    if (a.status !== 'eligible-not-selected' || superseded.has(a.id)) continue;
    const where = `${a.id} (${a.agency} / ${a.category})`;
    const CRITERIA = ['publiclyReachableWithoutSigningIn', 'reachedFromFrameWebsiteForThatAgency',
      'asksForTheNameOfANaturalPerson', 'nameFieldVisibleWithoutEnteringDataOrSubmitting',
      'normalHtmlOrBrowserRenderedNotPdfOrNative'];
    if (CRITERIA.some((c) => a.eligibility?.[c] !== true)) {
      problems.push(`${where} is eligible-not-selected but does not record every criterion as true`);
    }
    if (!a.evidenceFromAttemptId) {
      problems.push(`${where} is eligible-not-selected and cites no assessment-only retrieval`);
    }
    const selected = attempts.find((x) => x.id === a.notSelectedInFavourOf);
    if (!selected) {
      problems.push(`${where} names no captured selection (notSelectedInFavourOf=${a.notSelectedInFavourOf ?? 'absent'})`);
      continue;
    }
    if (selected.status !== 'captured') {
      problems.push(`${where} names ${selected.id}, which is a ${selected.status} attempt, not a capture`);
    }
    // Amendment 45. A REJECTED capture decides nothing, so a record resting on it rests on
    // nothing. The capture package's corpus gate refused this state and the sealer did not, which
    // is the divergence an independent implementation exists to prevent rather than create: a
    // tampered log reaching the seal by another route would have passed.
    if (selected.approval === 'rejected') {
      problems.push(
        `${where} rests on the selection ${selected.id}, which has been REJECTED; the tie-break ` +
          'must be decided again before this record stands'
      );
    }
    if (selected.agency !== a.agency || selected.category !== a.category ||
        selected.candidateSetVersion !== a.candidateSetVersion) {
      problems.push(`${where} names ${selected.id}, which belongs to a different locked set`);
    }
    if (!(canonUrl(selected.url) < canonUrl(a.url))) {
      problems.push(
        `${where} names ${selected.id}, which does not sort before it; the frozen tie-break takes ` +
          'the alphabetically first eligible canonical URL'
      );
    }
    const set = (log.candidateSets ?? {})[`${a.agency}\u0000${a.category}`];
    for (const [u, who] of [[canonUrl(a.url), 'this candidate'], [canonUrl(selected.url), 'its selection']]) {
      if (!(set?.locked ?? []).includes(u)) problems.push(`${where}: ${who} is not in the locked set`);
    }
  }

  // An exclusion citing a retrieval must match it on agency, category, canonical URL and bytes.
  for (const a of attempts) {
    if (!a.evidenceFromAttemptId) continue;
    const src = attempts.find((x) => x.id === a.evidenceFromAttemptId);
    if (!src) { problems.push(`${a.id} cites ${a.evidenceFromAttemptId}, which does not exist`); continue; }
    if (src.status !== 'retrieved') problems.push(`${a.id} cites ${src.id}, which is a ${src.status} attempt`);
    if (src.agency !== a.agency) problems.push(`${a.id} cites ${src.id}, whose agency differs`);
    if (src.category !== a.category) problems.push(`${a.id} cites ${src.id}, whose category differs`);
    // solo-protocol-v1.0.29 (Amendment 53). A differing URL is permitted only when the retrieval's
    // OWN recorded redirect chain runs from its requested URL to the URL being decided, every hop
    // was allowed, and the URL it finally reached is the one being decided. Derived here
    // independently of the capture package, which this file may not import, and fail-closed: any
    // reason the equivalence cannot be established is a problem, so a sealer that cannot see the
    // chain refuses the citation rather than assuming it.
    if (canon(src.url) !== canon(a.url)) {
      for (const p of redirectEquivalenceProblems({
        log, source: src, decisionUrl: a.url, agency: a.agency, category: a.category,
        candidateSetVersion: a.candidateSetVersion ?? src.candidateSetVersion,
      })) {
        problems.push(`${a.id} cites ${src.id}, whose URL differs: ${p}`);
      }
    }
    if (a.htmlSha256 !== undefined && src.htmlSha256 !== a.htmlSha256) {
      problems.push(`${a.id} cites ${src.id}, whose digest differs`);
    }
    // Amendment 45. `htmlBytes`, not `bytes`. No record has ever carried a field called `bytes`,
    // so this check was reading undefined on both sides and could never fire: tampering with
    // `c-0653.htmlBytes` produced zero sealer problems while a digest change was caught. A check
    // that cannot fail is worse than no check, because the passing seal was read as verification.
    if (a.htmlBytes !== undefined && src.htmlBytes !== a.htmlBytes) {
      problems.push(
        `${a.id} cites ${src.id}, whose byte length differs (${src.htmlBytes} recorded on the ` +
          `retrieval, ${a.htmlBytes} claimed here)`
      );
    }
    if (a.supersedesAttemptId === a.evidenceFromAttemptId) {
      problems.push(`${a.id} supersedes the very retrieval it cites as evidence (${src.id})`);
    }
  }
  return problems;
}

/**
 * The sealer's own redirect-equivalence derivation. See Amendment 53.
 *
 * Independent of the capture package by design, and stricter where it cannot be sure: it has no
 * canonicaliser beyond `canon`, so it compares what `canon` gives it and treats anything it cannot
 * establish as a reason to refuse. A citation standing in for another URL is the one place where
 * one retrieval settles two decisions, so the seal re-derives the permission rather than trusting
 * that the write-time check ran.
 */
export function redirectEquivalenceProblems(
  { log, source, decisionUrl, agency, category, candidateSetVersion } = {}
) {
  // Its own normaliser: `canon` elsewhere in this file is local to the function that defines it,
  // and a shared one would be a dependency between checks that are meant to be separable.
  const canon = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };
  const problems = [];
  const want = canon(decisionUrl);
  if (!source) return ['the evidence source does not exist'];
  if (canon(source.url) === want) return problems;

  if (source.status !== 'retrieved') problems.push(`${source.id} is a ${source.status} attempt`);
  if (source.agency !== agency) problems.push(`${source.id} is a different agency`);
  if (source.category !== category) problems.push(`${source.id} is a different category`);
  if (candidateSetVersion !== undefined && source.candidateSetVersion !== undefined &&
      source.candidateSetVersion !== candidateSetVersion) {
    problems.push(`${source.id} belongs to round ${source.candidateSetVersion}, not ${candidateSetVersion}`);
  }

  const sets = log?.candidateSets ?? {};
  const set = sets[`${agency}\u0000${category}`];
  const locked = (set?.locked ?? []).map((u) => canon(u));
  if (!locked.includes(canon(source.url))) problems.push(`${source.url} is not a locked candidate`);
  if (!locked.includes(want)) problems.push(`${decisionUrl} is not a locked candidate`);

  const chain = Array.isArray(source.redirectChain) ? source.redirectChain : [];
  if (chain.length === 0) {
    problems.push(`${source.id} records no redirect chain`);
  } else {
    if (canon(chain[0].from) !== canon(source.url)) {
      problems.push(`the chain does not start at ${source.url}`);
    }
    if (canon(chain[chain.length - 1].to) !== want) {
      problems.push(`the chain does not end at ${decisionUrl}`);
    }
    for (let i = 1; i < chain.length; i++) {
      if (canon(chain[i].from) !== canon(chain[i - 1].to)) problems.push(`the chain breaks at hop ${i + 1}`);
    }
    for (const [i, hop] of chain.entries()) {
      if (hop.allowed !== true) problems.push(`hop ${i + 1} is not recorded as allowed`);
    }
  }

  if (!source.finalUrl) problems.push(`${source.id} records no finalUrl`);
  else if (canon(source.finalUrl) !== want) {
    problems.push(`${source.id} finally reached ${source.finalUrl}, not ${decisionUrl}`);
  }
  return problems;
}

/**
 * The sealer's own derivation of which conclusion a render may carry. Amendment 54.
 *
 * `https://www.sia.govt.nz/search/SearchForm?Search=register` returned HTTP 500 - the agency's own
 * themed error page - so the render happened and the search did not. A conclusion of
 * `no-candidates` there would assert that the search found no registration form, and an error
 * page's own navigation would become evidence about forms.
 *
 * The rule runs both ways: a page the server SERVED must be judged on its content and may not be
 * dismissed as inconclusive; a page it did NOT serve must be recorded inconclusive and may not be
 * read for candidates. The status comes from the render registry, never from the conclusion being
 * checked, and a status that is missing or not an integer refuses every conclusion rather than
 * defaulting to served.
 *
 * Independent of the capture package, which this file may not import, and scoped per render per
 * category and round because one render legitimately answers several categories.
 */
export function renderConclusionProblems(log) {
  const problems = [];
  const attempts = Array.isArray(log?.attempts) ? log.attempts : [];
  const renders = Array.isArray(log?.renders) ? log.renders : [];
  const superseded = new Set(
    attempts.map((a) => a.supersedesDiscoveryId).filter((id) => id !== undefined && id !== null)
  );
  const active = (a) => !superseded.has(a.id);
  const KINDS = ['judgement-only', 'technical-conclusion'];
  const CONTENT = ['candidates-found', 'no-candidates'];
  const served = (n) => Number.isInteger(n) && n >= 200 && n <= 299;
  // `0` is a crashed fetch, not a response; an unusable status refuses every conclusion.
  const usable = (n) => Number.isInteger(n) && n >= 100 && n <= 599;
  const canon = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };

  for (const a of attempts) {
    if (!KINDS.includes(a.recordType) || !active(a)) continue;
    const where = `${a.id} (${a.category} v${a.candidateSetVersion})`;
    const render = renders.find((r) => r.id === a.renderId);
    if (!render) {
      problems.push(`${where} names render ${a.renderId}, which is not in the registry`);
      continue;
    }
    const status = render.httpStatus;
    if (!served(status)) {
      if (!usable(status)) {
        problems.push(
          `${where} rests on ${render.id}, whose httpStatus ${JSON.stringify(status)} is not a ` +
            'usable status; no conclusion can be drawn about it'
        );
      } else if (a.outcome !== 'retrieval-inconclusive') {
        problems.push(
          `${where} reads ${render.id} as ${a.outcome}, but the server did not serve it ` +
            `(HTTP ${status}); nothing on it bears on candidates`
        );
      }
    } else if (!CONTENT.includes(a.outcome)) {
      problems.push(
        `${where} records ${a.outcome} for ${render.id}, which WAS served (HTTP ${status}) and ` +
          'must be judged on its content'
      );
    }

    // A technical conclusion is about one retrieval of one page in one round.
    if (a.recordType === 'technical-conclusion') {
      if (a.permitId) problems.push(`${where} is a technical conclusion naming a permit`);
      if (a.navigatedAt) problems.push(`${where} is a technical conclusion carrying a navigation time`);
      if (a.navigationPerformed !== false) {
        problems.push(`${where} does not record navigationPerformed: false`);
      }
      if (a.supersedesDiscoveryId) {
        problems.push(`${where} supersedes ${a.supersedesDiscoveryId}; the render still happened`);
      }
      const obs = attempts.find((x) => x.id === a.evidenceFromDiscoveryId);
      if (!obs) problems.push(`${where} cites ${a.evidenceFromDiscoveryId}, which does not exist`);
      else {
        if (!active(obs)) problems.push(`${where} cites ${obs.id}, which has been superseded`);
        if (obs.outcome !== 'rendered') problems.push(`${where} cites ${obs.id}, which is not a render`);
        if (obs.renderId !== a.renderId) {
          problems.push(`${where} cites ${obs.id}, which registered ${obs.renderId}`);
        }
        if (obs.agency !== a.agency || obs.category !== a.category ||
            obs.candidateSetVersion !== a.candidateSetVersion || canon(obs.url) !== canon(a.url)) {
          problems.push(`${where} cites ${obs.id}, which is a different agency, category, round or page`);
        }
      }
    }

    // One active conclusion per render per category and round.
    const rival = attempts.find(
      (x) => x.id !== a.id && KINDS.includes(x.recordType) && active(x) &&
        x.renderId === a.renderId && x.category === a.category &&
        x.candidateSetVersion === a.candidateSetVersion
    );
    if (rival && rival.id < a.id) {
      problems.push(`${where} is a second active conclusion for ${a.renderId}, after ${rival.id}`);
    }
  }
  return problems;
}

/** The record types that may rest on a render. Mirrors the capture package's RECORD_TYPES. */
export const RENDER_BEARING_RECORD_TYPES = Object.freeze([
  'observation', 'judgement-only', 'reclassification', 'technical-conclusion',
]);

/**
 * The sealer's own check on retained plain-read evidence. Amendment 55.
 *
 * The sitemap method kept nothing until now, so a sitemap judgement rested on a reading no reader
 * could re-verify - which is how four approved records came to state what a child sitemap listed
 * when no child sitemap was ever retrieved (deviation `v-0003`). A retained resource is now
 * verified exactly as a render is: the file is where the registry says, inside `fetched/`, and its
 * digest and length are what was recorded.
 *
 * Independent of the capture package, which this file may not import, and fail-closed: a registry
 * entry that cannot be re-verified is a problem rather than a pass.
 */
/**
 * The sealer's own re-derivation of what retained bytes are. Amendment 56.
 *
 * `rootElement` and `locCount` were recorded once and trusted thereafter, so changing them in the
 * log to `urlset` and `999` produced no problem anywhere: a digest proves the bytes are unchanged
 * and says nothing about whether the log describes them correctly. Derived here independently of
 * the capture package, which this file may not import.
 */
export function parseRetainedBytes(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes ?? '');
  const stripped = text
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, ' ');
  const rootElement = (/<\s*([A-Za-z][\w:.-]*)/.exec(stripped) ?? [])[1] ?? null;
  const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((x) => x[1]);
  return { rootElement, locs, locCount: locs.length };
}

/** Is a retained resource a valid served sitemap representation? Amendment 56. */
export function sitemapRepresentationProblems(entry, bytes) {
  const problems = [];
  if (!entry) return ['there is no retained resource to check'];
  if (!(Number.isInteger(entry.httpStatus) && entry.httpStatus >= 200 && entry.httpStatus <= 299)) {
    problems.push(`HTTP ${entry.httpStatus} is not a served status`);
  }
  const type = String(entry.contentType ?? '').toLowerCase().split(';')[0].trim();
  if (!(type === 'application/xml' || type === 'text/xml' || type.endsWith('+xml'))) {
    problems.push(`content type ${JSON.stringify(entry.contentType ?? null)} is not XML`);
  }
  const { rootElement, locs } = parseRetainedBytes(bytes);
  if (!['sitemapindex', 'urlset'].includes(String(rootElement ?? '').toLowerCase())) {
    problems.push(`the document opens with <${rootElement ?? '?'}>, not sitemapindex or urlset`);
  }
  for (const l of locs.slice(0, 50)) {
    if (!/^https?:\/\//i.test(l)) problems.push(`a loc entry is not an absolute http(s) URL: ${l}`);
  }
  return problems;
}

/**
 * The sealer's own check on policy-reuse records. Amendment 57.
 *
 * A robots discovery record could only be created by the discovery recorder, which requires a
 * permit and so asserts a request; documenting that a round reused a fresh policy therefore
 * required refetching robots.txt, which happened against an explicit instruction and is recorded as
 * deviation `v-0005`. The reuse kind removes the need for that request, and the one thing it must
 * prove is that the policy it names really governed the round: the same origin, still fresh when
 * the record was written, and established. Derived independently of the capture package.
 */
export function policyReuseProblems(log) {
  const problems = [];
  const canonUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };
  const attempts = Array.isArray(log?.attempts) ? log.attempts : [];
  const checks = Array.isArray(log?.robotsChecks) ? log.robotsChecks : [];
  const superseded = new Set(
    attempts.map((a) => a.supersedesDiscoveryId).filter((id) => id !== undefined && id !== null)
  );
  const DAY = 24 * 60 * 60 * 1000;

  for (const a of attempts) {
    if (a.recordType !== 'policy-reuse' || superseded.has(a.id)) continue;
    const where = `${a.id} (${a.category} v${a.candidateSetVersion}, ${a.url})`;
    if (a.permitId) problems.push(`${where} names a permit, so it claims a request it must not make`);
    if (a.navigatedAt) problems.push(`${where} carries a navigation timestamp`);
    if (a.navigationPerformed !== false) problems.push(`${where} does not record navigationPerformed: false`);
    if (a.fetchId) problems.push(`${where} retains bytes, which the recorded check already holds`);
    if (a.discoveryKind !== 'robots') problems.push(`${where} is not a robots-method record`);
    if (a.outcome !== 'no-candidates') problems.push(`${where} records ${a.outcome}, not no-candidates`);
    const check = checks.find((c) => c.id === a.robotsCheckId);
    if (!check) {
      problems.push(`${where} names robots check ${JSON.stringify(a.robotsCheckId)}, which is not recorded`);
      continue;
    }
    // Amendment 58. The record must be OF the policy file, not merely of the same origin.
    if (canonUrl(a.url) !== canonUrl(check.url)) {
      problems.push(`${where} rests on ${check.id}, the policy at ${check.url}`);
    }
    let origin = null;
    try { origin = new URL(a.url).origin; } catch { problems.push(`${where} has no usable origin`); }
    if (origin && check.origin !== origin) {
      problems.push(`${where} rests on ${check.id}, the policy for ${check.origin}`);
    }
    let site = null;
    try { site = new URL(a.website).origin; } catch { problems.push(`${where} has no usable website`); }
    if (site && site !== check.origin) {
      problems.push(`${where} has website ${site}, which is not ${check.origin}`);
    }
    // Amendment 58. Two-sided: a record cannot rest on a policy fetched after it.
    const at = Date.parse(a.examinedAt ?? '');
    const fetched = Date.parse(check.fetchedAt ?? '');
    if (Number.isNaN(at) || Number.isNaN(fetched)) {
      problems.push(`${where} cannot be dated against ${check.id}`);
    } else if (at < fetched) {
      problems.push(`${where} rests on ${check.id}, which was fetched AFTER it`);
    } else if (at - fetched >= DAY) {
      problems.push(`${where} rests on ${check.id}, fetched more than 24 hours earlier`);
    }
    if (check.disposition === 'unestablished') {
      problems.push(`${where} rests on ${check.id}, which established no policy`);
    }
  }
  return problems;
}

/**
 * Amendment 58. The sealer's own check that a round documents the policy it decided under.
 *
 * A reuse record could name one real fresh policy while every permit in the round rested on
 * another, so the published account would name a policy nothing was decided under. The documented
 * set must EQUAL the acted-under set per origin per round - equality, not containment, which is
 * also what makes a refreshed policy representable: a round spanning a refresh cites two checks and
 * must carry two reuse records, one per governing interval. Derived independently of the capture
 * package.
 */
/** Amendment 59. The sealer's own structural-report check. */
export const STRUCTURAL_REPORT_VERSION = 1;
export const STRUCTURAL_REPORT_REQUIRED_FROM = Date.parse('2026-10-04T02:00:00Z');

/**
 * Amendment 59. Every document-bearing capture and render must carry a structural report, and a
 * report that is present must be well formed, self-consistent, and consistent with any evidence it
 * was taken from.
 *
 * Amendments 46 and 51 computed four fields in `detectBlocking` and both writers dropped them: the
 * name-field report was persisted nowhere in 348 attempts and 319 renders, and an approved record
 * cited "the structural name-field report is empty" when the field did not exist. Derived here
 * independently of the capture package, which this file may not import, and grandfathered by an
 * explicit boundary rather than by the marker's absence, which would be circular.
 */
/**
 * Amendment 61. The sealer's own offline derivation, so a reanalysis can be reproduced and
 * compared rather than trusted.
 *
 * Defined over the markup alone because this package is dependency-free and cannot launch a
 * browser - which is also what makes the derivation deterministic and comparable across the two
 * implementations. Its limits are the point: with no stylesheets it cannot know what was VISIBLE,
 * so it establishes that a name-collecting control exists in the retained markup and never that it
 * met criterion four.
 */
export function offlineStructuralReport(html) {
  const text = Buffer.isBuffer(html) ? html.toString('utf8') : String(html ?? '');
  const NAME = /(^|[^a-z])(name|first[_\s-]?names?|given[_\s-]?names?|sur[_\s-]?name|last[_\s-]?name|family[_\s-]?name|fore[_\s-]?names?|full[_\s-]?name|middle[_\s-]?names?|preferred[_\s-]?name|maiden[_\s-]?name)([^a-z]|$)/i;
  const QUERY_SUBMIT = /^\s*(search|find|look\s?up|browse|filter|refine|go)\b/i;
  const QUERY_FORM = /(^|[^a-z])(search|find|results?|query|keywords?|browse|look-?up|catalogue?|archway|finding-?aid|recordsearch)([^a-z]|$)/i;
  const REGISTER = /\b(register|sign\s?up|signup|create (?:an? )?account|join (?:now|us|up))\b/i;
  const attr = (tag, name) => {
    const m = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return m ? (m[2] ?? m[3] ?? '') : '';
  };
  const labelFor = (id) => {
    if (!id) return '';
    const m = new RegExp(`<label[^>]*\\bfor=("${id}"|'${id}')[^>]*>([\\s\\S]*?)</label>`, 'i').exec(text);
    return (m?.[2] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const nameFields = [];
  for (const [, formAttrs, body] of text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formAction = attr(formAttrs, 'action');
    const formRole = attr(formAttrs, 'role');
    const formIdent = `${attr(formAttrs, 'id')} ${attr(formAttrs, 'class')}`;
    const submits = [...body.matchAll(/<input\b[^>]*>|<button\b[^>]*>([\s\S]*?)<\/button>/gi)]
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
      if (!NAME.test(`${name} ${id} ${label} ${aria}`)) continue;
      const own = `${name} ${id} ${label} ${aria}`;
      const bases = [];
      if (QUERY_FORM.test(own)) bases.push('field named as a search key');
      if (QUERY_FORM.test(formAction)) bases.push('form action queries records');
      if (formRole === 'search') bases.push('form carries role="search"');
      if (QUERY_FORM.test(formIdent)) bases.push('form identified as a search');
      if (submits.length > 0 && submits.every((l) => QUERY_SUBMIT.test(l))) {
        bases.push(`submit control(s) labelled ${submits.map((l) => JSON.stringify(l)).join(', ')}`);
      }
      nameFields.push({
        name: name || null, label: label || null,
        role: bases.length > 0 ? 'query' : 'collection', basis: bases,
      });
    }
  }
  const affordances = [];
  for (const el of text.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>|<button\b[^>]*>[\s\S]*?<\/button>/gi)) {
    const tag = el[0];
    const inner = tag.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const aria = attr(tag, 'aria-label');
    const matched = REGISTER.test(inner) ? inner : (REGISTER.test(aria) ? aria : null);
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
 * An authorised re-retrieval, checked independently of the capture package.
 *
 * Amendment 62. A second request for a page already retrieved is permitted only to obtain evidence
 * the first retrieval does not carry. The capture package refuses this before the request; this
 * mirror refuses it at the seal, so a record written by some other path cannot pass. It is NOT a
 * copy rule: an extending retrieval has its own bytes and its own live report, which is the whole
 * reason the request was made.
 */
export function reRetrievalProblems(log) {
  const problems = [];
  const attempts = Array.isArray(log?.attempts) ? log.attempts : [];
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const superseded = new Set(
    attempts.flatMap((a) => [a.supersedesAttemptId, a.supersedesDiscoveryId]).filter((id) => id != null)
  );
  const canon = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };
  for (const a of attempts) {
    if (!a.extendsAttemptId || superseded.has(a.id)) continue;
    const prior = byId.get(a.extendsAttemptId);
    if (!prior) { problems.push(`${a.id} extends ${a.extendsAttemptId}, which is not a recorded attempt`); continue; }
    if (a.status !== 'retrieved') {
      problems.push(`${a.id} is a ${a.status} record extending ${prior.id}; only a retrieval re-retrieves a page`);
    }
    if (prior.status !== 'retrieved') {
      problems.push(`${a.id} extends ${prior.id}, which is a ${prior.status} attempt, not an evidence-only retrieval`);
    }
    if (superseded.has(prior.id)) {
      problems.push(`${a.id} extends ${prior.id}, which has been superseded and is not standing evidence`);
    }
    if (prior.agency !== a.agency || canon(prior.url) !== canon(a.url)) {
      problems.push(`${a.id} extends ${prior.id}, which is a different page or agency`);
    }
    // Nothing a second request would establish means the request should not have been made.
    const complete = prior.structuralReportVersion === STRUCTURAL_REPORT_VERSION &&
      prior.structuralReportSource === 'live' &&
      Array.isArray(prior.registrationAffordances) && Array.isArray(prior.nameFields) &&
      Number.isInteger(prior.collectedNameFields) && Number.isInteger(prior.searchKeyNameFields);
    if (complete) {
      problems.push(`${a.id} re-retrieved a page whose retrieval ${prior.id} already carried a complete live report`);
    }
    if (a.pageId && a.pageId === prior.pageId) {
      problems.push(`${a.id} reuses the pageId of ${prior.id}; a re-retrieval carries its own bytes`);
    }
    if (a.supersedesAttemptId === prior.id) {
      problems.push(`${a.id} supersedes ${prior.id} while extending it; the earlier retrieval is incomplete, not false`);
    }
  }
  return problems;
}

export function structuralReportProblems(log, { capturesRoot = null } = {}) {
  const problems = [];
  const attempts = Array.isArray(log?.attempts) ? log.attempts : [];
  const renders = Array.isArray(log?.renders) ? log.renders : [];
  const superseded = new Set(
    attempts.flatMap((a) => [a.supersedesAttemptId, a.supersedesDiscoveryId])
      .filter((id) => id !== undefined && id !== null)
  );
  const canon = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };
  const FIELDS = ['registrationAffordances', 'nameFields', 'collectedNameFields', 'searchKeyNameFields'];
  const digest = /^[0-9a-f]{64}$/;
  // One report per document, on the record that OWNS the bytes: a discovery observation defers to
  // the render it registered, so it is not asked for a second copy of the same finding.
  const bears = (r) => r?.refused !== true && !(r?.renderId && r?.status === 'discovery') &&
    (digest.test(r?.htmlSha256 ?? '') || digest.test(r?.renderedSha256 ?? ''));
  const byId = new Map(attempts.map((a) => [a.id, a]));
  // An offline report is recomputed, never asserted, so this cannot pass one without the bytes.
  if (!capturesRoot && attempts.some((a) =>
    a.structuralReportSource === 'offline-reanalysis' && !superseded.has(a.id))) {
    problems.push('the log holds offline structural reanalyses, but no captures root was supplied to re-read their bytes');
  }

  const check = (r, label, citedFrom) => {
    // Amendment 61, Finding 4. The record's OWN time decides whether it must carry a report. This
    // read `capturedAt` first, so a decision written today inherited the capture time of the
    // evidence it rests on and appeared grandfathered - the capture package was repaired and this
    // independent mirror was not, so the attack passed the sealer while the gate refused it.
    const at = Date.parse(r.examinedAt ?? r.capturedAt ?? r.navigatedAt ?? '');
    const current = bears(r) && !Number.isNaN(at) && at >= STRUCTURAL_REPORT_REQUIRED_FROM;
    const present = FIELDS.some((f) => r[f] !== undefined) || r.structuralReportVersion !== undefined;
    if (!bears(r) && present) {
      problems.push(`${label} carries a structural report although it obtained no document`);
      return;
    }
    if (current && !present) {
      problems.push(`${label} obtained a document but carries no structural report`);
      return;
    }
    if (!present) return;
    if (current && r.structuralReportVersion !== STRUCTURAL_REPORT_VERSION) {
      problems.push(`${label} records structuralReportVersion ${JSON.stringify(r.structuralReportVersion)}`);
    }
    if (!current && r.structuralReportVersion !== undefined &&
        r.structuralReportVersion !== STRUCTURAL_REPORT_VERSION) {
      problems.push(`${label} records an unissued structuralReportVersion`);
    }
    for (const f of ['registrationAffordances', 'nameFields']) {
      if (r[f] === undefined && !current) continue;
      if (!Array.isArray(r[f])) problems.push(`${label}.${f} is not an array`);
    }
    for (const f of ['collectedNameFields', 'searchKeyNameFields']) {
      if (r[f] === undefined && !current) continue;
      if (!Number.isInteger(r[f]) || r[f] < 0) problems.push(`${label}.${f} is not a count`);
    }
    if (Array.isArray(r.nameFields)) {
      for (const [i, f] of r.nameFields.entries()) {
        if (!f || typeof f !== 'object') { problems.push(`${label}.nameFields[${i}] is not an object`); continue; }
        if (!['collection', 'query'].includes(f.role)) {
          problems.push(`${label}.nameFields[${i}].role is ${JSON.stringify(f.role)}`);
        }
        if (!Array.isArray(f.basis)) problems.push(`${label}.nameFields[${i}].basis is not an array`);
      }
      const collected = r.nameFields.filter((f) => f?.role === 'collection').length;
      const query = r.nameFields.filter((f) => f?.role === 'query').length;
      if (Number.isInteger(r.collectedNameFields) && r.collectedNameFields !== collected) {
        problems.push(`${label}.collectedNameFields is ${r.collectedNameFields}, but nameFields holds ${collected}`);
      }
      if (Number.isInteger(r.searchKeyNameFields) && r.searchKeyNameFields !== query) {
        problems.push(`${label}.searchKeyNameFields is ${r.searchKeyNameFields}, but nameFields holds ${query}`);
      }
    }
    // Amendment 60. The report's provenance, declared. A reanalysis of retained bytes is not a
    // copy of a live report, and must not be read as one: visibility depends on external styles
    // the saved markup does not carry.
    const src = r.structuralReportSource;
    if (current && !['live', 'offline-reanalysis'].includes(src)) {
      problems.push(`${label} records structuralReportSource ${JSON.stringify(src)}`);
    }
    if (!current && src !== undefined && !['live', 'offline-reanalysis'].includes(src)) {
      problems.push(`${label} records an unknown structuralReportSource`);
    }
    if (citedFrom) {
      if (canon(citedFrom.url) !== canon(r.url)) {
        problems.push(`${label} carries a report while citing ${citedFrom.id}, which is a different page`);
      }
      // Amendment 61. These bind the record that PERFORMS the reanalysis; a decision inheriting
      // such a report is a copy and is held to equality like any other.
      if (src === 'offline-reanalysis' && r.recordType === 'structural-reanalysis') {
        // The label is evidence-only; wearing it must not exempt a decision from copy-equality.
        if (r.status !== 'retrieved' || r.approval !== 'not-applicable') {
          problems.push(`${label} is a reanalysis with status ${JSON.stringify(r.status)} and approval ${JSON.stringify(r.approval)}; a reanalysis is evidence-only`);
        }
        if (r.fails !== undefined) {
          problems.push(`${label} is a reanalysis but carries a criterion conclusion`);
        }
        if (!bears(citedFrom)) {
          problems.push(`${label} is an offline reanalysis citing ${citedFrom.id}, which holds no document`);
        }
        // Amendment 61. Permitted only where there is no live report to copy.
        const complete = citedFrom.structuralReportVersion === STRUCTURAL_REPORT_VERSION &&
          citedFrom.structuralReportSource === 'live' &&
          Array.isArray(citedFrom.registrationAffordances) && Array.isArray(citedFrom.nameFields) &&
          Number.isInteger(citedFrom.collectedNameFields) && Number.isInteger(citedFrom.searchKeyNameFields);
        if (complete) {
          problems.push(`${label} re-derives a report offline although ${citedFrom.id} carries a live one`);
        }
        const citedAt = Date.parse(citedFrom.capturedAt ?? citedFrom.navigatedAt ?? citedFrom.examinedAt ?? '');
        if (!Number.isNaN(citedAt) && citedAt >= STRUCTURAL_REPORT_REQUIRED_FROM) {
          problems.push(`${label} re-derives a report for ${citedFrom.id}, obtained after the boundary`);
        }
        // Recomputed from the retained bytes, independently of the capture package. No file, or no
        // root to read it under, means the derivation cannot be re-run - and a derivation nobody
        // re-runs is an assertion. Previously both cases simply skipped the check.
        if (!citedFrom.file) {
          problems.push(`${label} re-derives a report from ${citedFrom.id}, which names no retained file`);
        }
        if (capturesRoot && citedFrom.file) {
          const path = join(resolve(capturesRoot), 'captures', citedFrom.file);
          if (!existsSync(path)) {
            problems.push(`${label} cites ${citedFrom.id}, whose file is not on disk to re-read`);
          } else {
            const bytes = readFileSync(path);
            if (createHash('sha256').update(bytes).digest('hex') !== citedFrom.htmlSha256) {
              problems.push(`${label} cites ${citedFrom.id}, whose bytes no longer match its digest`);
            } else {
              const recomputed = offlineStructuralReport(bytes);
              for (const f of FIELDS) {
                if (JSON.stringify(r[f]) !== JSON.stringify(recomputed[f])) {
                  problems.push(`${label}.${f} is not what re-reading ${citedFrom.file} produces`);
                }
              }
            }
          }
        }
      } else {
        for (const f of FIELDS) {
          if (r[f] === undefined && citedFrom[f] === undefined) continue;
          if (JSON.stringify(r[f]) !== JSON.stringify(citedFrom[f])) {
            problems.push(`${label}.${f} differs from ${citedFrom.id}`);
          }
        }
        if (r.structuralReportVersion !== citedFrom.structuralReportVersion) {
          problems.push(`${label}.structuralReportVersion differs from ${citedFrom.id}`);
        }
        if (r.structuralReportSource !== citedFrom.structuralReportSource) {
          problems.push(`${label}.structuralReportSource differs from ${citedFrom.id}`);
        }
      }
    } else if (src === 'offline-reanalysis') {
      problems.push(`${label} is an offline reanalysis but cites no evidence whose bytes it re-read`);
    }
  };

  for (const a of attempts) {
    if (superseded.has(a.id)) continue;
    const source = a.promotedFrom ? byId.get(a.promotedFrom)
      : (a.evidenceFromAttemptId ? byId.get(a.evidenceFromAttemptId) : null);
    const carries = FIELDS.some((f) => a[f] !== undefined) || a.structuralReportVersion !== undefined;
    check(a, a.id, carries ? source : null);
  }
  for (const g of renders) check(g, g.id, null);
  return problems;
}

export function policyAgreementProblems(log) {
  const problems = [];
  const attempts = Array.isArray(log?.attempts) ? log.attempts : [];
  const permits = Array.isArray(log?.discoveryPermits) ? log.discoveryPermits : [];
  const checks = Array.isArray(log?.robotsChecks) ? log.robotsChecks : [];
  const superseded = new Set(
    attempts.map((a) => a.supersedesDiscoveryId).filter((id) => id !== undefined && id !== null)
  );
  const active = (a) => !superseded.has(a.id);
  const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
  const known = new Set(checks.map((c) => c.id));
  const scopes = new Map();
  const key = (agency, category, version, origin) => `${agency}\u0000${category}\u0000${version}\u0000${origin}`;

  for (const a of attempts) {
    if (a.recordType !== 'policy-reuse' || !active(a)) continue;
    const origin = originOf(a.url);
    if (!origin || !known.has(a.robotsCheckId)) continue;
    const k = key(a.agency, a.category, a.candidateSetVersion, origin);
    if (!scopes.has(k)) scopes.set(k, { documented: new Set(), used: new Set() });
    scopes.get(k).documented.add(a.robotsCheckId);
  }
  if (scopes.size === 0) return problems;

  for (const p of permits) {
    const origin = originOf(p.url);
    if (!origin || !p.robotsCheckId) continue;
    const k = key(p.agency, p.category, p.candidateSetVersion, origin);
    if (scopes.has(k)) scopes.get(k).used.add(p.robotsCheckId);
  }
  for (const a of attempts) {
    if (!a.robotsCheckId || !active(a) || a.recordType === 'policy-reuse') continue;
    const origin = originOf(a.url);
    if (!origin) continue;
    const k = key(a.agency, a.category, a.candidateSetVersion, origin);
    if (scopes.has(k)) scopes.get(k).used.add(a.robotsCheckId);
  }

  for (const [k, { documented, used }] of scopes) {
    const [agency, category, version, origin] = k.split('\u0000');
    const where = `${agency} / ${category} v${version}, ${origin}`;
    for (const id of used) {
      if (!documented.has(id)) {
        problems.push(`${where} acted under ${id}, which no policy-reuse record documents`);
      }
    }
    for (const id of documented) {
      if (used.size > 0 && !used.has(id)) {
        problems.push(`${where} documents ${id} but acted under ${[...used].join(', ')}`);
      }
    }
  }
  return problems;
}

/**
 * Every request in the log against the floor it was made under, derived independently.
 *
 * Amendment 65. Equal timestamps are a breach, not an absence of a predecessor; a request is never
 * measured against itself; the required gap is the greater of the study's floor and the governing
 * recorded policy's crawl-delay; and the boundary precedes the freeze it was introduced by. The two
 * sitemap fetches at 09:03 remain grandfathered and are disclosed as a deviation.
 */
export function pacingProblems(log) {
  const problems = [];
  const MIN_DELAY_MS = 5000;
  const REQUIRED_FROM = Date.parse('2026-10-04T09:04:00Z');
  const attempts = Array.isArray(log?.attempts) ? log.attempts : [];
  const fetches = Array.isArray(log?.fetches) ? log.fetches : [];
  const robots = Array.isArray(log?.robotsChecks) ? log.robotsChecks : [];

  const requests = [];
  for (const a of attempts) {
    if (a.navigationPerformed === false || a.promotedFrom || a.fetchId) continue;
    const at = Date.parse(a.navigatedAt ?? a.capturedAt ?? '');
    if (!Number.isNaN(at)) requests.push({ key: `a:${a.id}`, at });
  }
  for (const f of fetches) {
    const at = Date.parse(f.fetchedAt ?? '');
    if (!Number.isNaN(at)) requests.push({ key: `f:${f.id}`, at, url: f.url, what: f.id });
  }
  for (const c of robots) {
    const at = Date.parse(c.fetchedAt ?? '');
    if (!Number.isNaN(at)) requests.push({ key: `r:${c.id}`, at, url: c.url, what: c.id });
  }

  const askedFor = (at, url) => {
    let origin = null;
    try { origin = new URL(url).origin; } catch { origin = null; }
    let governing = null;
    for (const c of robots) {
      const t = Date.parse(c.fetchedAt ?? '');
      if (Number.isNaN(t) || c.origin !== origin || t > at) continue;
      if (!governing || t > Date.parse(governing.fetchedAt)) governing = c;
    }
    const delays = ((governing && governing.policy && governing.policy.groups) || [])
      .map((g) => g && g.crawlDelay)
      .filter((d) => typeof d === 'number' && d > 0);
    return delays.length ? Math.max(...delays) * 1000 : 0;
  };

  for (const entry of requests) {
    if (!entry.url || entry.at < REQUIRED_FROM) continue;
    let previous;
    for (const other of requests) {
      if (other.key === entry.key || other.at > entry.at) continue;
      if (previous === undefined || other.at > previous) previous = other.at;
    }
    if (previous === undefined) continue;
    const gap = entry.at - previous;
    const required = Math.max(MIN_DELAY_MS, askedFor(entry.at, entry.url));
    if (gap < required) {
      problems.push(`${entry.what} (${entry.url}) was fetched ${gap} ms after the previous request, under the ${required} ms required`);
    }
  }
  return problems;
}

export function fetchLedgerProblems(log, fetchedDir) {
  const problems = [];
  const fetches = Array.isArray(log?.fetches) ? log.fetches : [];
  const attempts = Array.isArray(log?.attempts) ? log.attempts : [];
  if (fetches.length === 0) return problems;
  const canon = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };

  // Amendment 65. The pacing floor, verified independently of the capture package.
  //
  // Amendment 64's version had three holes, all of which this mirror shared: it searched for a
  // preceding request with `t < at`, so two requests in the same second were never compared; it
  // enforced only the five-second floor and never the crawl-delay a policy asked for; and its
  // boundary sat twenty minutes AFTER the freeze commit, leaving that window unverified. A
  // robots.txt fetch is audited here too - it is a request to the host like any other. The floor
  // is global, not per-origin, because that is what this study publishes.
  problems.push(...pacingProblems(log));

  for (const f of fetches) {
    const where = `${f.id} (${f.url})`;
    if (!/^[0-9a-f]{64}$/.test(f.fetchedSha256 ?? '')) problems.push(`${where} records no usable digest`);
    if (!Number.isInteger(f.fetchedBytes) || f.fetchedBytes < 0) {
      problems.push(`${where} records no usable byte length`);
    }
    if (!Number.isInteger(f.httpStatus)) problems.push(`${where} records no usable httpStatus`);
    if (f.httpStatus >= 200 && f.httpStatus <= 299 && typeof f.contentType !== 'string') {
      problems.push(`${where} was served but records no contentType`);
    }
    if (typeof f.fetchFile !== 'string' || f.fetchFile.length === 0) {
      problems.push(`${where} names no file`);
    } else if (basename(f.fetchFile) !== f.fetchFile) {
      problems.push(`${where} names ${JSON.stringify(f.fetchFile)}, which is not a plain file name`);
    } else if (fetchedDir) {
      const path = join(resolve(fetchedDir), f.fetchFile);
      if (!existsSync(path)) problems.push(`${where} names ${f.fetchFile}, which is not on disk`);
      else {
        const bytes = readFileSync(path);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== f.fetchedSha256) {
          problems.push(`${where} hashes to ${digest}, not the recorded ${f.fetchedSha256}`);
        }
        if (bytes.length !== f.fetchedBytes) {
          problems.push(`${where} is ${bytes.length} bytes on disk, not the recorded ${f.fetchedBytes}`);
        }
        // Amendment 56. The description of the bytes, re-derived from the bytes.
        const parsed = parseRetainedBytes(bytes);
        if (f.rootElement !== undefined && f.rootElement !== parsed.rootElement) {
          problems.push(
            `${where} records rootElement ${JSON.stringify(f.rootElement)}, but the file opens ` +
              `with ${JSON.stringify(parsed.rootElement)}`
          );
        }
        if (f.locCount !== undefined && f.locCount !== parsed.locCount) {
          problems.push(`${where} records ${f.locCount} loc entries, but the file declares ${parsed.locCount}`);
        }
      }
    }
    // The permit that authorised the request, as the render registry requires of a render: the
    // traffic behind retained evidence must be accounted for, not merely the bytes.
    const permits = Array.isArray(log?.discoveryPermits) ? log.discoveryPermits : [];
    const permit = permits.find((x) => x.id === f.permitId);
    if (!f.permitId) problems.push(`${where} names no permit`);
    else if (!permit) problems.push(`${where} names permit ${f.permitId}, which does not exist`);
    else if (canon(permit.url) !== canon(f.url)) {
      problems.push(`${where} names permit ${permit.id}, which authorised ${permit.url}`);
    }
    if (!attempts.some((a) => a.fetchId === f.id)) problems.push(`${where} has no record citing it`);
  }

  // Amendment 56. Retained bytes no registry entry names.
  if (fetchedDir && existsSync(resolve(fetchedDir))) {
    const named = new Set(fetches.map((f) => f.fetchFile));
    for (const file of readdirSync(resolve(fetchedDir))) {
      if (!named.has(file)) {
        problems.push(`${file} is in fetched/ but no retained resource names it`);
      }
    }
  }

  for (const a of attempts) {
    if (!a.fetchId) continue;
    const entry = fetches.find((f) => f.id === a.fetchId);
    if (!entry) { problems.push(`${a.id} cites ${a.fetchId}, which is not registered`); continue; }
    // Amendment 56. A sitemap content judgement needs a valid served sitemap representation.
    if (['candidates-found', 'no-candidates'].includes(a.outcome) && a.discoveryKind === 'sitemap') {
      const path = fetchedDir && entry.fetchFile && basename(entry.fetchFile) === entry.fetchFile
        ? join(resolve(fetchedDir), entry.fetchFile) : null;
      if (!path || !existsSync(path)) {
        problems.push(`${a.id} judges sitemap content, but ${entry.id}'s bytes are not readable here`);
      } else {
        for (const p of sitemapRepresentationProblems(entry, readFileSync(path))) {
          problems.push(`${a.id} records ${a.outcome} from ${entry.id}, which is not a sitemap: ${p}`);
        }
      }
    }
    if (canon(entry.url) !== canon(a.url)) {
      problems.push(`${a.id} cites ${entry.id}, which is of ${entry.url}, not ${a.url}`);
    }
    for (const [field, label] of [['fetchedSha256', 'digest'], ['fetchedBytes', 'byte length'],
      ['contentType', 'content type']]) {
      if (a[field] !== undefined && a[field] !== entry[field]) {
        problems.push(`${a.id} cites ${entry.id}, whose ${label} differs`);
      }
    }
  }
  return problems;
}

export function unjudgedRenderProblems(log) {
  const problems = [];
  const attempts = Array.isArray(log.attempts) ? log.attempts : [];
  const superseded = new Set(
    attempts.map((a) => a.supersedesDiscoveryId).filter((id) => id !== undefined && id !== null)
  );
  const active = (a) => !superseded.has(a.id);

  for (const o of attempts) {
    if (o.status !== 'discovery' || o.outcome !== 'rendered' || !active(o)) continue;
    const where = `${o.id} (${o.agency} / ${o.category} v${o.candidateSetVersion}, ${o.url})`;
    const citing = attempts.filter(
      (j) => j.recordType === 'judgement-only' && active(j) &&
        (j.answersDiscoveryId === o.id || j.evidenceFromDiscoveryId === o.id)
    );
    const sameRound = citing.filter(
      (j) => j.category === o.category && j.candidateSetVersion === o.candidateSetVersion
    );
    if (sameRound.length === 0) {
      problems.push(
        citing.length
          ? `${where} is cited only by judgements in other categories or rounds; none concludes its own round`
          : `${where} was rendered but never judged`
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
    for (const [field, label] of [['renderId', 'render'], ['url', 'URL'], ['agency', 'agency']]) {
      if (j[field] !== o[field]) {
        problems.push(
          `${where} is judged by ${j.id}, whose ${label} is ${JSON.stringify(j[field])} and not ${JSON.stringify(o[field])}`
        );
      }
    }
  }
  return problems;
}

export function renderLedgerProblems(log, renderedDir) {
  const problems = [];
  const root = resolve(renderedDir);
  const attempts = (Array.isArray(log.attempts) ? log.attempts : []).filter((a) => a.status === 'discovery');
  const byId = new Map((log.attempts ?? []).map((a) => [a.id, a]));
  const renders = Array.isArray(log.renders) ? log.renders : [];
  const findRender = (id) => renders.find((r) => r.id === id) ?? null;
  const superseded = new Set(
    (log.attempts ?? []).map((a) => a.supersedesDiscoveryId).filter((id) => id !== undefined && id !== null)
  );
  const canon = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };
  // Amendment 48, mirrored. The head of a record's own supersession lineage: the version in force.
  const headOf = (id) => {
    const walked = new Set();
    let current = id;
    for (;;) {
      if (!current || walked.has(current)) return current;
      walked.add(current);
      // Evidence successors only: a judgement may both answer and supersede one plain record.
      const next = attempts.find(
        (a) => a.supersedesDiscoveryId === current &&
          ['observation', 'reclassification'].includes(a.recordType)
      );
      if (!next) return current;
      current = next.id;
    }
  };

  // A rendered file name must resolve inside `rendered/`. Both implementations joined the name
  // straight onto the directory, so `../../captures/page.html` escaped confinement entirely.
  const confinedPath = (file, where) => {
    if (typeof file !== 'string' || file.trim() === '') { problems.push(`${where} names no rendered file`); return null; }
    if (file !== basename(file)) {
      problems.push(`${where} names ${JSON.stringify(file)}, which is not a plain file name`);
      return null;
    }
    const full = resolve(root, file);
    const rel = relative(root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      problems.push(`${where} names ${JSON.stringify(file)}, which resolves outside rendered/`);
      return null;
    }
    return full;
  };
  const verifyBytes = (where, full, claimedSha, claimedBytes) => {
    let bytes = null;
    try { bytes = readFileSync(full); } catch (error) {
      problems.push(`${where}: ${basename(full)} could not be read: ${error.message}`);
      return;
    }
    if (claimedBytes !== undefined && claimedBytes !== null && bytes.length !== claimedBytes) {
      problems.push(`${where}: ${basename(full)} is ${bytes.length} bytes, the log records ${claimedBytes}`);
    }
    if (sha256(bytes) !== claimedSha) {
      problems.push(`${where}: ${basename(full)} does not match its recorded digest`);
    }
  };

  // solo-protocol-v1.0.12: what ELSE is in the directory. Two renders wrote their bytes and failed to
  // record, leaving files nothing named while both ledgers reported zero problems.
  {
    let present = null;
    try { present = readdirSync(root).filter((f) => f.endsWith('.html')); } catch { present = null; }
    if (present) {
      const named = new Set([
        ...renders.map((r) => r.renderFile),
        ...(log.attempts ?? []).map((a) => a.renderFile),
      ].filter(Boolean));
      for (const file of present) {
        if (!named.has(file)) problems.push(`${file} is in rendered/ but no render or record names it`);
      }
    }
  }

  const seen = new Set();
  for (const render of renders) {
    const where = render.id ?? '(a render with no id)';
    if (!render.id) problems.push('a render has no id');
    else if (seen.has(render.id)) problems.push(`render id ${render.id} appears more than once`);
    seen.add(render.id);
    for (const field of ['url', 'renderedSha256', 'navigatedAt']) {
      if (!render[field]) problems.push(`${where} has no ${field}`);
    }
    if (!/^[0-9a-f]{64}$/.test(render.renderedSha256 ?? '')) {
      problems.push(`${where} has an unusable renderedSha256`);
    }
    if (!Number.isInteger(render.renderedBytes) || render.renderedBytes < 0) {
      problems.push(`${where} has an unusable renderedBytes`);
    }
    const full = confinedPath(render.renderFile, where);
    if (full) verifyBytes(where, full, render.renderedSha256, render.renderedBytes);
  }

  const permits = Array.isArray(log.discoveryPermits) ? log.discoveryPermits : [];
  for (const render of renders) {
    if (!render.id) continue;
    const observations = attempts.filter(
      (a) => a.renderId === render.id && a.recordType === 'observation' && !superseded.has(a.id)
    );
    if (observations.length > 1) {
      problems.push(`${render.id} is claimed by ${observations.length} active observations`);
    }
    // Amendment 48, mirrored. A reclassification owns the render carrying its corrected metadata,
    // and a render whose observation was superseded somewhere along a chain ending in an active
    // reclassification keeps that observation as its historical owner: `g-0158` was retrieved under
    // `p-0285` by `d-0676`, which remains the true account of how those bytes arrived.
    const reclassifications = attempts.filter(
      (a) => a.renderId === render.id && a.recordType === 'reclassification' && !superseded.has(a.id)
    );
    const historicalOwner = attempts.some((a) => {
      if (a.renderId !== render.id || a.recordType !== 'observation') return false;
      const headRecord = attempts.find((x) => x.id === headOf(a.id));
      return Boolean(headRecord) && headRecord.recordType === 'reclassification';
    });
    if (observations.length === 0 && reclassifications.length === 0 && !historicalOwner &&
        !render.adoptedFrom) {
      problems.push(`${render.id} has no observation record and was not adopted from one`);
    }
    // solo-protocol-v1.0.8: the registry's own permit.
    const permit = permits.find((x) => x.id === render.permitId);
    if (!render.permitId) problems.push(`${render.id} names no permit`);
    else if (!permit) problems.push(`${render.id} names permit ${render.permitId}, which does not exist`);
    else if (!permit.consumedAt) problems.push(`${render.id} names permit ${permit.id}, which is not consumed`);
    else if (permit.url !== render.url) {
      problems.push(`${render.id} names permit ${permit.id}, which authorised a different page`);
    }
    const introducer = observations[0] ?? (render.adoptedFrom ? byId.get(render.adoptedFrom) : null);
    if (introducer && introducer.permitId && render.permitId && introducer.permitId !== render.permitId) {
      problems.push(`${render.id} names a permit other than the one ${introducer.id} used`);
    }
  }

  for (const a of attempts) {
    // solo-protocol-v1.0.7: semantic checks apply to ACTIVE records. A superseded record's citation
    // was withdrawn with its judgement; holding it to the rule would make every correction a
    // permanent publication block. Its bytes are still checked below.
    const withdrawn = superseded.has(a.id);

    // solo-protocol-v1.0.8. What each record TYPE may contain. The ledger checked only that
    // `recordType` held a recognised word: an active judgement relabelled `observation` with its
    // evidence source deleted still reported `no-candidates`, claimed no navigation, answered its
    // record and cleared the backlog, and both implementations passed it with zero problems. They
    // agreed on an incomplete rule, which a conformance test cannot detect by itself.
    if (!withdrawn && a.recordType === 'observation') {
      const where = `${a.id} (observation)`;
      if (!['rendered', 'retrieval-blocked'].includes(a.outcome)) {
        problems.push(`${where} records an outcome an observation may not record`);
      }
      if (a.navigationPerformed === false) problems.push(`${where} claims no navigation occurred`);
      if (!isoUtc(a.navigatedAt)) problems.push(`${where} has no navigation timestamp`);
      if (!a.permitId) problems.push(`${where} names no permit`);
      else {
        const permit = permits.find((x) => x.id === a.permitId);
        if (!permit) problems.push(`${where} names permit ${a.permitId}, which does not exist`);
        else if (!permit.consumedAt) problems.push(`${where} names an unconsumed permit`);
      }
      if (a.evidenceFromDiscoveryId) problems.push(`${where} names an evidence source`);
      if (a.answersDiscoveryId) problems.push(`${where} answers a record`);
      if (!a.renderId) problems.push(`${where} cites no render`);
    }
    if (!withdrawn && a.recordType === 'judgement-only') {
      const where = `${a.id} (judgement)`;
      if (!['candidates-found', 'no-candidates'].includes(a.outcome)) {
        problems.push(`${where} records an outcome a judgement may not record`);
      }
      if (a.permitId) problems.push(`${where} names a permit`);
      if (a.navigationPerformed !== false) problems.push(`${where} does not record navigationPerformed: false`);
      if (!a.renderId) problems.push(`${where} cites no rendered evidence`);
      // solo-protocol-v1.0.15: the two links name different roles and must differ in a correction
      // chain - the obligation discharged, and the prior judgement corrected. Ambiguity arises only
      // when the superseded record is itself an obligation rather than a judgement.
      if (a.answersDiscoveryId && a.supersedesDiscoveryId &&
          a.answersDiscoveryId !== a.supersedesDiscoveryId) {
        const sup = byId.get(a.supersedesDiscoveryId);
        if (sup && sup.recordType !== 'judgement-only') {
          problems.push(`${where} answers one record and supersedes another that is not a judgement`);
        }
      }
    }

    // One authority for the evidence: a copy of the registry's file, digest or size must match it.
    if (a.renderId) {
      const render = findRender(a.renderId);
      if (render) {
        for (const field of ['renderFile', 'renderedSha256', 'renderedBytes']) {
          if (a[field] !== undefined && a[field] !== null && a[field] !== render[field]) {
            problems.push(`${a.id} carries a ${field} that disagrees with render ${render.id}`);
          }
        }
      }
    }

    if (a.renderId && !withdrawn) {
      const render = findRender(a.renderId);
      if (!render) { problems.push(`${a.id} cites render ${a.renderId}, which does not exist`); continue; }
      if (canon(render.url) !== canon(a.url)) {
        problems.push(`${a.id} cites render ${render.id} of a different page`);
      }
      // solo-protocol-v1.0.31. Amendment 54's fourth type, `technical-conclusion`. Named in one
      // place in this file so the sealer's list cannot drift from the capture package's the way
      // this one did: the capture allowlist was not extended with the type, so the render ledger
      // refused every technical conclusion and the provenance publish failed.
      if (!RENDER_BEARING_RECORD_TYPES.includes(a.recordType)) {
        problems.push(`${a.id} cites render ${a.renderId} but is neither an observation nor a judgement`);
      }
      if (a.recordType === 'judgement-only' && (render.accessBarriers ?? []).length > 0) {
        problems.push(`${a.id} judges ${a.url} on access-barred render ${render.id}`);
      }
      if (a.recordType === 'judgement-only') {
        const source = byId.get(a.evidenceFromDiscoveryId);
        if (!a.evidenceFromDiscoveryId) problems.push(`${a.id} is a judgement with no evidenceFromDiscoveryId`);
        else if (!source) problems.push(`${a.id} names evidence source ${a.evidenceFromDiscoveryId}, which does not exist`);
        else if (source.status !== 'discovery') problems.push(`${a.id} names evidence source ${source.id}, not a discovery record`);
        else if (!(source.renderId === a.renderId || render.adoptedFrom === source.id)) {
          problems.push(`${a.id} names ${source.id} as its evidence source, which did not introduce render ${a.renderId}`);
        }
      }
    }
    if (a.answersDiscoveryId && !withdrawn) {
      const target = byId.get(a.answersDiscoveryId);
      const where = `${a.id} answers ${a.answersDiscoveryId}`;
      if (!target) problems.push(`${where}, which does not exist`);
      else if (target.status !== 'discovery') problems.push(`${where}, not a discovery record`);
      else {
        if (!a.renderId) problems.push(`${where} without citing rendered evidence`);
        for (const field of ['agency', 'category', 'candidateSetVersion']) {
          if (target[field] !== a[field]) problems.push(`${where}, which differs in ${field}`);
        }
        if (canon(target.url) !== canon(a.url)) problems.push(`${where}, which is a different page`);
      }
    }
    // solo-protocol-v1.0.11: the flag that discharges a backlog obligation. Adding
    // `renderRefused: true` to an ordinary record removed it from the backlog with both ledgers
    // reporting nothing. A boolean that discharges an obligation must carry the evidence that the
    // obligation was discharged.
    if (a.renderRefused !== undefined) {
      const where = a.id ?? '(an unidentified record)';
      if (a.renderRefused !== true) {
        problems.push(`${where} has a renderRefused that is neither true nor absent`);
      } else {
        const chain = a.redirectChain;
        if (!Array.isArray(chain) || chain.length === 0) {
          problems.push(`${where} claims renderRefused with no redirect chain`);
        }
        if (a.navigationPerformed === false) {
          problems.push(`${where} claims renderRefused but records that no navigation occurred`);
        }
        if (!isoUtc(a.navigatedAt)) problems.push(`${where} claims renderRefused with no navigation timestamp`);
        if (!a.permitId) problems.push(`${where} claims renderRefused with no permit`);
        else {
          const permit = permits.find((p) => p.id === a.permitId);
          if (!permit) problems.push(`${where} names permit ${a.permitId}, which does not exist`);
          else {
            if (!permit.consumedAt) problems.push(`${where} names an unconsumed permit`);
            for (const field of ['agency', 'category', 'candidateSetVersion']) {
              if (permit[field] !== a[field]) problems.push(`${where} names a permit covering a different ${field}`);
            }
            if (permit.url !== a.url) problems.push(`${where} names a permit for a different URL`);
          }
        }
        if (Array.isArray(chain) && chain.length > 0) {
          if (canon(chain[0].from ?? '') !== canon(a.url)) {
            problems.push(`${where}'s chain does not start at its own URL`);
          }
          for (let i = 1; i < chain.length; i++) {
            if (canon(chain[i].from ?? '') !== canon(chain[i - 1].to ?? '')) {
              problems.push(`${where}'s chain is not continuous at hop ${i + 1}`);
            }
          }
          if (chain[chain.length - 1].allowed !== false) {
            problems.push(`${where} claims renderRefused but its last hop was allowed`);
          }
          for (const [i, hop] of chain.slice(0, -1).entries()) {
            if (hop.allowed !== true) {
              problems.push(`${where}'s hop ${i + 1} was refused, so the chain should have stopped there`);
            }
          }
        }
      }
    }

    // solo-protocol-v1.0.15. The answer link is a property of the correction CHAIN, recovered by
    // walking every supersession backwards. A correction that drops it silently reopens the
    // obligation it discharged; one that changes it resolves a different obligation than the chain
    // established. A chain that never carried a link stays valid - there is nothing to have lost.
    if (a.recordType === 'judgement-only' && !withdrawn) {
      const seen = new Set();
      const links = new Set();
      let cur = a;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.answersDiscoveryId) links.add(cur.answersDiscoveryId);
        cur = cur.supersedesDiscoveryId ? byId.get(cur.supersedesDiscoveryId) : null;
      }
      const where = a.id ?? '(an unidentified record)';
      // Amendment 48, mirrored. Links in ONE supersession lineage are one obligation.
      const obligations = new Set([...links].map(headOf));
      if (obligations.size > 1) {
        problems.push(`${where}'s correction chain answers more than one record (${[...links].join(', ')})`);
      } else if (obligations.size === 1 && a.answersDiscoveryId !== [...obligations][0]) {
        problems.push(
          `${where} is the active end of a chain answering ${[...links][0]} but names ` +
            `${a.answersDiscoveryId ? a.answersDiscoveryId : 'none'}`
        );
      }
    }

    // solo-protocol-v1.0.14. Every headed observation must justify its second navigation, successful
    // or not. The relationship was checked only where it was written: deleting `followsDiscoveryId`,
    // pointing it at a record for another page, or deleting `attemptedModes` each left both
    // validators silent.
    if (a.recordType === 'observation' && !withdrawn) {
      const own = findRender(a.renderId);
      const where = a.id ?? '(an unidentified record)';
      if (own && own.browserMode === 'headed') {
        const prior = byId.get(a.followsDiscoveryId);
        const priorRender = prior ? findRender(prior.renderId) : null;
        if (!a.followsDiscoveryId) problems.push(`${where} is a headed observation with no headless predecessor`);
        else if (!prior) problems.push(`${where} follows a record that does not exist`);
        else {
          if (prior.recordType !== 'observation') problems.push(`${where} follows a record that is not an observation`);
          if (prior.outcome !== 'retrieval-blocked') problems.push(`${where} follows a record that was not access-barred`);
          if (superseded.has(prior.id)) problems.push(`${where} follows a superseded record`);
          for (const field of ['agency', 'category', 'candidateSetVersion']) {
            if (prior[field] !== a[field]) problems.push(`${where} follows a record differing in ${field}`);
          }
          if (canon(prior.url ?? '') !== canon(a.url)) problems.push(`${where} follows a record for a different page`);
          const followers = attempts.filter((x) => x.followsDiscoveryId === prior.id && !superseded.has(x.id));
          if (followers.length > 1) problems.push(`${prior.id} is followed by ${followers.length} active records`);
          if (!priorRender) problems.push(`${where} follows a record citing no registered render`);
          else {
            if (priorRender.browserMode !== 'headless') problems.push(`${where} follows a render that was not headless`);
            const barriers = priorRender.accessBarriers ?? [];
            if (!barriers.some((b) => !/sign-in wall/.test(b))) {
              problems.push(`${where} follows a record whose barriers do not warrant a headed retry`);
            }
          }
          if (!prior.permitId || !a.permitId || prior.permitId === a.permitId) {
            problems.push(`${where} and the record it follows must each name their own permit`);
          } else {
            const earlierPermit = permits.find((p) => p.id === prior.permitId);
            const thisPermit = permits.find((p) => p.id === a.permitId);
            for (const [permit, id] of [[earlierPermit, prior.permitId], [thisPermit, a.permitId]]) {
              if (!permit) problems.push(`${where} rests on permit ${id}, which does not exist`);
              else if (!permit.consumedAt) problems.push(`${where} rests on an unconsumed permit`);
            }
            const t = (v) => { const x = Date.parse(v ?? ''); return Number.isNaN(x) ? null : x; };
            if (t(thisPermit?.issuedAt) !== null && t(earlierPermit?.consumedAt) !== null &&
                t(thisPermit.issuedAt) < t(earlierPermit.consumedAt)) {
              problems.push(`${where}'s permit was issued before the first attempt was recorded`);
            }
            if (t(a.navigatedAt) !== null && t(prior.navigatedAt) !== null && t(a.navigatedAt) <= t(prior.navigatedAt)) {
              problems.push(`${where} did not navigate after the record it follows`);
            }
          }
          // attemptedModes is a summary of the two renders and may not disagree with them.
          if (a.attemptedModes === undefined) problems.push(`${where} records no attemptedModes`);
          else if (priorRender) {
            const derived = [
              { browserMode: 'headless', httpStatus: priorRender.httpStatus ?? null, accessBarriers: priorRender.accessBarriers ?? [] },
              { browserMode: 'headed', httpStatus: own.httpStatus ?? null, accessBarriers: own.accessBarriers ?? [] },
            ];
            if (!Array.isArray(a.attemptedModes) || a.attemptedModes.length !== 2) {
              problems.push(`${where} records the wrong number of attempted modes`);
            } else {
              for (const [i, want] of derived.entries()) {
                const got = a.attemptedModes[i] ?? {};
                if (got.browserMode !== want.browserMode) problems.push(`${where}'s attempted mode ${i + 1} names the wrong browser mode`);
                if ((got.httpStatus ?? null) !== want.httpStatus) problems.push(`${where}'s attempted mode ${i + 1} disagrees with its render about the status`);
                if (JSON.stringify(got.accessBarriers ?? []) !== JSON.stringify(want.accessBarriers)) {
                  problems.push(`${where}'s attempted mode ${i + 1} disagrees with its render about the access barriers`);
                }
              }
            }
          }
        }
      } else if (own && a.followsDiscoveryId) {
        problems.push(`${where} is a ${own.browserMode} observation claiming to follow another`);
      }
    }

    // solo-protocol-v1.0.13: the second flag able to retire a backlog entry. Both browser modes
    // barred is terminal, and terminal claims carry their evidence.
    if (a.renderBarred !== undefined) {
      const where = a.id ?? '(an unidentified record)';
      if (a.renderBarred !== true) {
        problems.push(`${where} has a renderBarred that is neither true nor absent`);
      } else {
        if (a.outcome !== 'retrieval-blocked') problems.push(`${where} claims renderBarred without being blocked`);
        // Derived from the two registered renders, not read off the summary.
        const ownR = findRender(a.renderId);
        const priorR = findRender(byId.get(a.followsDiscoveryId)?.renderId);
        if (!ownR || !priorR) problems.push(`${where} claims renderBarred without two registered renders`);
        else {
          if (priorR.browserMode !== 'headless' || ownR.browserMode !== 'headed') {
            problems.push(`${where} claims renderBarred from the wrong pair of browser modes`);
          }
          for (const r of [priorR, ownR]) {
            if ((r.accessBarriers ?? []).length === 0) {
              problems.push(`${where} claims renderBarred but a render recorded no access barrier`);
            }
          }
        }
        if (Array.isArray(a.attemptedModes) && a.attemptedModes.some((m) => m.error)) {
          problems.push(`${where} claims renderBarred, but one attempt failed to launch`);
        }
        const earlier = byId.get(a.followsDiscoveryId);
        if (!a.followsDiscoveryId) problems.push(`${where} claims renderBarred without naming what it follows`);
        else if (!earlier) problems.push(`${where} follows a record that does not exist`);
        else {
          if (earlier.outcome !== 'retrieval-blocked') problems.push(`${where} follows a record that was not barred`);
          if (canon(earlier.url) !== canon(a.url)) problems.push(`${where} follows a record for a different page`);
          if (!earlier.permitId || !a.permitId || earlier.permitId === a.permitId) {
            problems.push(`${where} and the record it follows must each name their own consumed permit`);
          }
          for (const id of [earlier.permitId, a.permitId]) {
            const permit = permits.find((p) => p.id === id);
            if (!permit) problems.push(`${where} rests on permit ${id}, which does not exist`);
            else if (!permit.consumedAt) problems.push(`${where} rests on an unconsumed permit`);
          }
        }
      }
    }

    if (!a.renderId && a.renderFile) {
      const full = confinedPath(a.renderFile, a.id);
      if (full) verifyBytes(a.id, full, a.renderedSha256, a.renderedBytes);
    }
  }
  // solo-protocol-v1.0.15: one active judgement per obligation. Two were accepted and were free to
  // contradict each other, with nothing saying which answered the record.
  {
    const byAnswer = new Map();
    for (const a of attempts) {
      if (a.recordType !== 'judgement-only') continue;
      if (!a.answersDiscoveryId || superseded.has(a.id)) continue;
      if (!byAnswer.has(a.answersDiscoveryId)) byAnswer.set(a.answersDiscoveryId, []);
      byAnswer.get(a.answersDiscoveryId).push(a);
    }
    for (const [answered, judgements] of byAnswer) {
      if (judgements.length > 1) {
        problems.push(`${answered} is answered by ${judgements.length} active judgements`);
      }
    }
  }

  return problems;
}

export const SUPERSEDED_REASONS = Object.freeze([
  'all four categories in the frozen priority order were searched and none yielded an eligible form',
  'all four categories in the frozen priority order were attempted, but technical retrieval ' +
    'barriers prevented complete discovery and no eligible form was located',
]);

/** The discovery outcomes that mean a page could not be read. Mirrored, and checked equal. */
export const TECHNICAL_ATTRITION_OUTCOMES = Object.freeze([
  'robots-unestablished',
  'retrieval-blocked',
  'retrieval-inconclusive',
]);

/**
 * Which attrition records actually cost coverage - the sealer's own derivation.
 *
 * solo-protocol-v1.0.27 (Amendment 50). A barred attempt the headed fallback then READ cost the
 * agency nothing, so it cannot be what makes a search incomplete. Counting every attrition record
 * made the whole Ministry for Culture and Heritage estate look unsearched: its origins bar
 * headless Chromium, the frozen fallback read five of six anyway, and the resolution still said
 * `technical-discovery-attrition` - a false claim about the sample.
 *
 * Independent of the capture package by design (this file may not import it) and deliberately
 * STRICTER: recovery needs an explicit `followsDiscoveryId` link to an unbarred `rendered` record
 * for the same agency, category, round and URL, and that record must itself carry a judgement. An
 * unjudged render proves retrieval, not reading; an unrelated later render of the same URL proves
 * nothing about THIS barrier. Where the link cannot be established the barrier stays unresolved,
 * so a sealer that cannot see a recovery reports the weaker resolution rather than assuming the
 * stronger one. `robots-unestablished` is never recoverable: no permission was established, so
 * nothing was read under one.
 */
export function unresolvedAttrition(attempts, { bound = null, superseded = null } = {}) {
  const sup = superseded ?? new Set(
    attempts.map((a) => a.supersedesDiscoveryId).filter((id) => id !== undefined && id !== null)
  );
  const active = (a) => !sup.has(a.id);
  const inScope = (a) =>
    (bound === null || bound.has(a.id)) && a.status === 'discovery' && active(a);

  const recoveredBarrier = (barred) => {
    const follower = attempts.find(
      (a) => a.followsDiscoveryId === barred.id && active(a) && a.outcome === 'rendered' &&
        a.agency === barred.agency && a.category === barred.category &&
        a.candidateSetVersion === barred.candidateSetVersion && a.url === barred.url
    );
    if (!follower) return false;
    return attempts.some(
      (j) => j.recordType === 'judgement-only' && active(j) &&
        (j.answersDiscoveryId === follower.id || j.evidenceFromDiscoveryId === follower.id) &&
        j.category === follower.category &&
        j.candidateSetVersion === follower.candidateSetVersion
    );
  };

  const attrition = attempts.filter(
    (a) => inScope(a) && TECHNICAL_ATTRITION_OUTCOMES.includes(a.outcome)
  );
  const recovered = attrition.filter((a) => a.outcome === 'retrieval-blocked' && recoveredBarrier(a));
  const unresolved = attrition.filter((a) => !recovered.includes(a));
  return { attrition, recovered, unresolved };
}
export const MAX_QUALIFIED_AGENCIES = 40;
export const EXHAUSTION_CATEGORIES = Object.freeze([
  'account-registration',
  'service-application',
  'enquiry-or-contact',
  'subscription-or-newsletter',
]);

/** Splits one CSV line, honouring quoted fields: two frame agencies have commas in their names. */
function splitCsvLine(line) {
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

/** The frozen draw order as an ordered list of agency names. */
function drawOrderAgencies(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('position,'))
    .map(splitCsvLine)
    .filter((f) => f.length >= 3 && /^\d+$/.test(f[0]))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map((f) => f[1]);
}

const isoUtc = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.endsWith('Z');

export function sealCorpus({
  draft, capturesDir, instrument, frameDir, sealer = null, captureLogPath = null,
  captureRoot = null, protocol = SOLO_PROTOCOL_TAG,
}) {
  const problems = [];
  if (draft?.schema !== 'formfair/solo-corpus-draft@1') {
    problems.push('draft schema must be formfair/solo-corpus-draft@1');
  }
  if (!Array.isArray(draft?.pages) || draft.pages.length === 0) problems.push('draft must contain at least one page');
  // The frame is verified by reading it, not by trusting what the draft claims about it.
  // There is deliberately no synthetic bypass: the frame files are repository artefacts and
  // are present in every mode, and a bypass is how the previous seal came to be weakened.
  const frameRoot = resolve(frameDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'frame'));
  for (const { key, file, frozen } of FRAME_FILES) {
    const declared = draft?.[key];
    if (typeof declared !== 'string' || !/^[0-9a-f]{64}$/.test(declared)) {
      problems.push(`${key} must be a SHA-256 digest`);
      continue;
    }
    let actual;
    try {
      actual = createHash('sha256').update(readFileSync(join(frameRoot, file))).digest('hex');
    } catch {
      problems.push(`cannot read ${file} from ${frameRoot} to verify ${key}`);
      continue;
    }
    if (actual !== frozen) {
      problems.push(
        `${file} on disk hashes to ${actual}, which is not the frame-v1.0.0 artefact ${frozen}. ` +
          'The frame has been modified; the sample it produced is no longer the frozen one.'
      );
    } else if (declared !== actual) {
      problems.push(
        `${key} declares ${declared} but ${file} hashes to ${actual}. ` +
          'The draft was not derived from the frozen frame.'
      );
    }
  }
  if (
    instrument?.tag !== 'evaluation-v1.1.0' ||
    typeof instrument?.commit !== 'string' ||
    typeof instrument?.lockfileSha256 !== 'string'
  ) {
    problems.push('instrument must name evaluation-v1.1.0, its commit, and its lockfile hash');
  }

  const root = resolve(capturesDir);
  const readRelative = (file, where) => {
    if (typeof file !== 'string' || file.length === 0 || isAbsolute(file)) {
      problems.push(`${where} must be a relative path`);
      return null;
    }
    const path = resolve(root, file);
    if (relative(root, path).startsWith('..')) {
      problems.push(`${where} escapes the captures directory`);
      return null;
    }
    try {
      return { path, bytes: readFileSync(path) };
    } catch (error) {
      problems.push(`${where} cannot be read: ${error.message}`);
      return null;
    }
  };

  const ledger = readRelative(draft?.selectionLedgerFile, 'selectionLedgerFile');
  const ids = new Set();
  const pages = [];
  for (const [index, page] of (draft?.pages ?? []).entries()) {
    const where = `pages[${index}]`;
    const required = ['pageId', 'agency', 'website', 'originalUrl', 'finalUrl', 'capturedAt', 'browser', 'automationTool', 'locale', 'category', 'file'];
    for (const key of required) {
      if (typeof page?.[key] !== 'string' || page[key].length === 0) problems.push(`${where}.${key} is required`);
    }
    if (ids.has(page?.pageId)) problems.push(`${where}: duplicate pageId ${page.pageId}`);
    ids.add(page?.pageId);
    if (!isoUtc(page?.capturedAt)) problems.push(`${where}.capturedAt must be ISO 8601 UTC ending in Z`);
    if (page?.viewport?.width !== 1280 || page?.viewport?.height !== 800) {
      problems.push(`${where}.viewport must be 1280x800`);
    }
    if (!Array.isArray(page?.redirects)) problems.push(`${where}.redirects must be an array`);
    const capture = readRelative(page?.file, `${where}.file`);
    if (capture) {
      pages.push({
        ...page,
        // capture-v1.0.5 / solo-protocol: submission protection and credential fields are
        // properties of the captured form, sealed with it.
        accessBarriers: page.accessBarriers ?? [],
        submissionProtection: page.submissionProtection ?? [],
        authenticationSignals: page.authenticationSignals ?? [],
        sha256: sha256(capture.bytes),
        bytes: capture.bytes.length,
      });
    }
  }

  // solo-protocol-v1.0.1. The exhaustion records, validated and carried into the manifest.
  //
  // Until now the seal ignored them entirely: it constructed a manifest from the pages and the
  // ledger, so a corpus could be sealed that recorded forty pages without recording how many
  // agencies were searched to obtain them. The denominator of every prevalence figure lived in
  // an array the seal did not read.
  const exhausted = [];
  const exhaustedAgencies = new Set();
  const rawExhausted = draft?.exhaustedAgencies;
  if (rawExhausted !== undefined && !Array.isArray(rawExhausted)) {
    problems.push('exhaustedAgencies must be an array when present');
  }
  for (const [index, record] of (Array.isArray(rawExhausted) ? rawExhausted : []).entries()) {
    const where = `exhaustedAgencies[${index}]`;
    if (typeof record?.agency !== 'string' || record.agency.length === 0) {
      problems.push(`${where}.agency is required`);
      continue;
    }
    if (exhaustedAgencies.has(record.agency)) {
      problems.push(`${where}: ${record.agency} is recorded as exhausted more than once`);
    }
    exhaustedAgencies.add(record.agency);
    if (!isoUtc(record?.exhaustedAt)) {
      problems.push(
        `${where}.exhaustedAt must be ISO 8601 UTC ending in Z. A record without one predates ` +
          'the exhaustion operation and must be re-recorded rather than sealed.'
      );
    }
    // solo-protocol-v1.0.4. The resolution, and the one frozen reason it may carry. A record with
    // no resolution predates the distinction and asserted a completed search, so it reads as
    // `bounded-discovery-complete` - and is then held to that claim against the log below.
    const resolution = record?.resolution ?? AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE;
    if (!Object.values(AGENCY_RESOLUTIONS).includes(resolution)) {
      problems.push(
        `${where}.resolution must be ${Object.values(AGENCY_RESOLUTIONS).join(' or ')}, not ` +
          JSON.stringify(record?.resolution)
      );
    } else if (record?.reason !== RESOLUTION_REASONS[resolution]) {
      problems.push(
        SUPERSEDED_REASONS.includes(record?.reason)
          ? `${where}.reason is wording frozen under an earlier protocol and withdrawn by ` +
            `${SOLO_PROTOCOL_TAG}. Re-resolve the exhaustion so the record states the current ` +
            'reason; sealing it would publish a claim the protocol has withdrawn.'
          : `${where}.reason must be the frozen reason for ${resolution}. Agencies that did not ` +
            'qualify are interpretable only if each left for one of two stated reasons, and only ' +
            'if the reason matches the resolution it is filed under.'
      );
    }
    if (resolution === AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION) {
      const ids = record?.attritionRecordIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        problems.push(
          `${where} is technical-discovery-attrition but names no supporting record. The weaker ` +
            'resolution is the one that must show its evidence, because it removes an agency from ' +
            'the searched denominator.'
        );
      }
    } else if (record?.attritionRecordIds !== undefined) {
      problems.push(`${where} is ${resolution} but names attrition records`);
    }
    const versions = record?.categorySetVersions;
    if (versions === null || typeof versions !== 'object') {
      problems.push(`${where}.categorySetVersions must name all four categories`);
    } else {
      for (const category of EXHAUSTION_CATEGORIES) {
        const v = versions[category];
        if (!Number.isInteger(v) || v < 1) {
          problems.push(`${where}.categorySetVersions.${category} must be a positive integer`);
        }
      }
      const extra = Object.keys(versions).filter((k) => !EXHAUSTION_CATEGORIES.includes(k));
      if (extra.length) problems.push(`${where}.categorySetVersions has unknown categories: ${extra.join(', ')}`);
    }
    exhausted.push({
      agency: record.agency,
      exhaustedAt: record.exhaustedAt,
      // When the wording was corrected under a later protocol, both times are kept: the manifest
      // says when the agency was searched, not when its record was rephrased.
      ...(record.reResolvedAt !== undefined ? { reResolvedAt: record.reResolvedAt } : {}),
      resolution,
      reason: record.reason,
      categorySetVersions: record.categorySetVersions,
      ...(resolution === AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION
        ? { attritionRecordIds: [...(record.attritionRecordIds ?? [])] }
        : {}),
    });
  }

  // Completion. A synthetic corpus is explicitly not the study's corpus - its agencies are not
  // frame agencies and its page count is arbitrary - so the frame and completion rules apply to
  // a real seal only. The manifest records which it is.
  if (draft?.synthetic !== true) {
    const pageAgencies = [];
    for (const page of draft?.pages ?? []) if (typeof page?.agency === 'string') pageAgencies.push(page.agency);
    const uniquePageAgencies = new Set(pageAgencies);
    if (uniquePageAgencies.size !== pageAgencies.length) {
      problems.push('two pages name the same agency; the protocol takes at most one page per agency');
    }
    const overlap = [...uniquePageAgencies].filter((a) => exhaustedAgencies.has(a));
    if (overlap.length) {
      problems.push(
        `${overlap.join(', ')} is both a sealed page and an exhausted agency; an agency either ` +
          'contributed a page or was searched without one'
      );
    }

    // An upper bound, not only a target. The branch below tested `>= MAX_QUALIFIED_AGENCIES`,
    // which treats forty-one pages as "reached the target" and lets a forty-one page corpus seal
    // against a forty-one agency prefix. The study takes at most forty, so forty-one is not a
    // corpus that overshot: it is one whose selection did not stop where the protocol says.
    if (uniquePageAgencies.size > MAX_QUALIFIED_AGENCIES) {
      problems.push(
        `${uniquePageAgencies.size} agencies have a sealed page, which exceeds the target of ` +
          `${MAX_QUALIFIED_AGENCIES}. The scan stops at exactly ${MAX_QUALIFIED_AGENCIES} ` +
          'qualifying pages.'
      );
    }

    let order;
    try {
      order = drawOrderAgencies(readFileSync(join(frameRoot, 'draw-order.csv'), 'utf8'));
    } catch {
      order = null;
      problems.push('cannot read draw-order.csv to verify that the scan covered the frozen order');
    }
    if (order) {
      const known = new Set(order);
      const outside = [...uniquePageAgencies, ...exhaustedAgencies].filter((a) => !known.has(a));
      if (outside.length) {
        problems.push(`agencies outside the frozen frame: ${[...new Set(outside)].join(', ')}`);
      } else {
        const touched = new Set([...uniquePageAgencies, ...exhaustedAgencies]);
        if (uniquePageAgencies.size === MAX_QUALIFIED_AGENCIES) {
          // The scan stopped on reaching the target, so what was touched must be exactly the
          // prefix of the draw order up to that point - no agency skipped over, none reached past.
          const prefix = order.slice(0, touched.size);
          const missing = prefix.filter((a) => !touched.has(a));
          const beyond = [...touched].filter((a) => !prefix.includes(a));
          if (missing.length || beyond.length) {
            problems.push(
              `the ${touched.size} agencies with a page or an exhaustion are not the first ` +
                `${touched.size} of the frozen draw order` +
                (missing.length ? `; not accounted for: ${missing.join(', ')}` : '') +
                (beyond.length ? `; reached out of turn: ${beyond.join(', ')}` : '')
            );
          }
        } else {
          // Fewer than the target qualified, so the scan must have run out of agencies: every
          // one in the frame has to be accounted for as a page or an exhaustion.
          const unaccounted = order.filter((a) => !touched.has(a));
          if (unaccounted.length) {
            problems.push(
              `only ${uniquePageAgencies.size} agencies qualified, fewer than the target of ` +
                `${MAX_QUALIFIED_AGENCIES}, so every agency in the frozen order must be either a ` +
                `page or a recorded exhaustion. ${unaccounted.length} are neither: ` +
                `${unaccounted.slice(0, 5).join(', ')}${unaccounted.length > 5 ? ', …' : ''}`
            );
          }
        }
      }
    }
  }

  // solo-protocol-v1.0.2. The exhaustions are checked against the authoritative log, not only
  // for shape.
  //
  // Validating shape alone left the completion rule trivially satisfiable: a hand-written draft
  // could carry forty-four well-formed exhaustion records for agencies nobody ever searched, and
  // the seal would accept it as a complete scan. The sealed selection ledger does not close this,
  // because it holds examined URLs and outcomes - not candidate-set versions, approvals, or
  // exhaustion records. So the log itself is bound by hash and read.
  let captureLogSeal = null;
  if (draft?.synthetic !== true) {
    if (typeof captureLogPath !== 'string' || captureLogPath.length === 0) {
      problems.push(
        'captureLogPath is required to seal a real corpus: the exhaustion records are claims ' +
          'about what was searched, and they are verified against the authoritative capture log'
      );
    } else {
      // The log must live inside the capture root - the directory holding both `captures/` and
      // `capture-log.json` - and the manifest stores its ACTUAL relative path. The previous
      // version hardcoded the name `capture-log.json` in the manifest while sealing whatever
      // `--capture-log` pointed at, so a manifest could name one file and have been sealed
      // against another, anywhere on disk.
      const logRoot = resolve(captureRoot ?? dirname(resolve(capturesDir)));
      const logPath = resolve(captureLogPath);
      const logRelative = relative(logRoot, logPath);
      let bytes = null;
      let log = null;
      if (logRelative.startsWith('..') || isAbsolute(logRelative)) {
        problems.push(
          `the capture log at ${captureLogPath} is outside the capture root ${logRoot}; the log ` +
            'the corpus is sealed against must live with the captures it describes'
        );
      } else {
        try {
          bytes = readFileSync(logPath);
          log = JSON.parse(bytes.toString('utf8'));
        } catch (error) {
          problems.push(`cannot read the capture log at ${captureLogPath}: ${error.message}`);
        }
      }
      if (log) {
        captureLogSeal = { file: logRelative, sha256: sha256(bytes), bytes: bytes.length };
        const logExhausted = Array.isArray(log.exhausted) ? log.exhausted : [];
        const sets = log.candidateSets ?? {};
        const attempts = Array.isArray(log.attempts) ? log.attempts : [];

        for (const record of exhausted) {
          const where = `exhaustedAgencies[${record.agency}]`;

          // The record must BE in the log, not merely resemble one.
          const inLog = logExhausted.find((e) => (typeof e === 'string' ? e : e?.agency) === record.agency);
          if (!inLog || typeof inLog === 'string') {
            problems.push(
              `${where} is not recorded as exhausted in the capture log. An exhaustion in the ` +
                'draft that the log does not contain is an assertion about a search that has no record.'
            );
            continue;
          }
          if (inLog.exhaustedAt !== record.exhaustedAt || inLog.reason !== record.reason) {
            problems.push(`${where} does not match the capture log's record of it`);
          }
          // solo-protocol-v1.0.4. The resolution must match the log, AND the log's own bound
          // evidence must support it. Matching the log alone would let an exhaustion written
          // before a round was corrected go on claiming a completed search after attrition
          // records were bound into it - the claim would be consistent with the log and false
          // about the world. Re-derived here rather than trusted, for the same reason the
          // exhaustion contract is duplicated at all: the seal is the authority.
          const loggedResolution = inLog.resolution ?? AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE;
          if (loggedResolution !== record.resolution) {
            problems.push(
              `${where}.resolution is ${record.resolution} but the capture log records ` +
                `${loggedResolution}`
            );
          }
          const bound = new Set();
          for (const category of EXHAUSTION_CATEGORIES) {
            for (const id of sets[`${record.agency}\u0000${category}`]?.discoveryRecordIds ?? []) {
              bound.add(id);
            }
          }
          const superseded = new Set(
            attempts.map((a) => a.supersedesDiscoveryId).filter((id) => id !== undefined && id !== null)
          );
          // solo-protocol-v1.0.27 (Amendment 50). Only attrition that actually cost coverage
          // bears on the resolution; see `unresolvedAttrition`.
          const attritionInLog = unresolvedAttrition(attempts, { bound, superseded }).unresolved;
          // With nothing bound, `bounded-discovery-complete` would be vacuously derivable - the stronger
          // claim, on no evidence. The absence of attrition only means something where there is
          // evidence in which attrition could have shown up.
          const boundInLog = attempts.filter((a) => bound.has(a.id) && a.status === 'discovery' && !superseded.has(a.id));
          if (boundInLog.length === 0) {
            problems.push(
              `${where} has no discovery records bound to its four sets in the capture log, so ` +
                'nothing supports either resolution'
            );
          }
          const derived = attritionInLog.length > 0
            ? AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION
            : AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE;
          if (derived !== record.resolution) {
            problems.push(
              `${where} is sealed as ${record.resolution}, but the capture log's bound discovery ` +
                `records support ${derived}` +
                (attritionInLog.length
                  ? ` (${attritionInLog.length} record(s) were never read successfully: ` +
                    `${attritionInLog.slice(0, 4).map((a) => `${a.id} ${a.outcome}`).join(', ')})`
                  : '')
            );
          }
          if (record.resolution === AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION) {
            const supporting = new Set(attritionInLog.map((a) => a.id));
            const unsupported = (record.attritionRecordIds ?? []).filter((id) => !supporting.has(id));
            if (unsupported.length) {
              problems.push(
                `${where} names ${unsupported.join(', ')} as attrition evidence, but the capture ` +
                  'log has no such bound, active, unreadable record'
              );
            }
          }
          for (const category of EXHAUSTION_CATEGORIES) {
            if (inLog.categorySetVersions?.[category] !== record.categorySetVersions?.[category]) {
              problems.push(`${where}.categorySetVersions.${category} disagrees with the capture log`);
            }
          }

          // No approved capture: an agency cannot both contribute a page and be exhausted.
          const captured = attempts.find(
            (a) => a.agency === record.agency && a.status === 'captured' && a.approval === 'approved'
          );
          if (captured) {
            problems.push(`${where} has an approved captured page (${captured.pageId}) in the capture log`);
          }

          // Four candidate sets, at the recorded versions, approved and settled.
          for (const category of EXHAUSTION_CATEGORIES) {
            const set = sets[`${record.agency}\u0000${category}`];
            if (!set) {
              problems.push(`${where}: the capture log has no ${category} candidate set for this agency`);
              continue;
            }
            if (set.version !== record.categorySetVersions?.[category]) {
              problems.push(
                `${where}: the log's ${category} set is version ${set.version}, but the exhaustion ` +
                  `claims version ${record.categorySetVersions?.[category]}`
              );
            }
            if (!set.lockedAt) problems.push(`${where}: the log's ${category} set is not locked`);
            if (set.approval !== 'approved') {
              problems.push(`${where}: the log's ${category} set is ${set.approval ?? 'pending'}, not approved`);
            }
            const decided = new Set(
              attempts.filter((a) => a.agency === record.agency && a.status !== 'discovery').map((a) => a.url)
            );
            const unassessed = (set.locked ?? []).filter((u) => !decided.has(u));
            if (unassessed.length) {
              problems.push(`${where}: the log's ${category} set has ${unassessed.length} unassessed candidate(s)`);
            }
          }
        }

        // solo-protocol-v1.0.7. The render ledger, checked by the same rules as the capture
        // package's `checkRenderLedger` — and `checkRenderLedger` is exported as
        // `renderLedgerProblems` below so a conformance test can drive BOTH implementations over one
        // table of adversarial ledgers and require identical verdicts. The previous version here was
        // a weaker second implementation of a validator described as shared, which is how two
        // divergent rule sets came to sit behind one claim.
        for (const problem of renderLedgerProblems(log, join(logRoot, 'rendered'))) {
          problems.push(`renderLedger: ${problem}`);
        }

        // Amendment 39. Evidence retrieved and never read must not reach a seal.
        for (const problem of unjudgedRenderProblems(log)) {
          problems.push(`unjudgedRender: ${problem}`);
        }

        // Amendment 59. The structural report must be present and consistent.
        for (const problem of reRetrievalProblems(log)) {
          problems.push(`${where}: ${problem}`);
        }
        for (const problem of structuralReportProblems(log, { capturesRoot: logRoot })) {
          problems.push(`structuralReport: ${problem}`);
        }

        // Amendment 58. And the documented policy must be the one the round decided under.
        for (const problem of policyAgreementProblems(log)) {
          problems.push(`policyAgreement: ${problem}`);
        }

        // Amendment 57. A policy-reuse record must rest on a policy that governed it.
        for (const problem of policyReuseProblems(log)) {
          problems.push(`policyReuse: ${problem}`);
        }

        // Amendment 55. Retained plain-read bytes, re-verified at sealing time like rendered ones.
        for (const problem of fetchLedgerProblems(log, join(logRoot, 'fetched'))) {
          problems.push(`fetchLedger: ${problem}`);
        }

        // Amendment 54. A conclusion that does not match its render's HTTP status must not reach a
        // seal: an error page read for candidates, or a served page waved away as a failure.
        for (const problem of renderConclusionProblems(log)) {
          problems.push(`renderConclusion: ${problem}`);
        }

        // Amendment 41. A candidate settled by evidence alone must not reach a seal.
        for (const problem of terminalDecisionProblems(log)) {
          problems.push(`terminalDecision: ${problem}`);
        }

        // The symmetric check: a sealed page must be an approved capture in the log.
        for (const page of pages) {
          const match = attempts.find(
            (a) => a.status === 'captured' && a.approval === 'approved' && a.pageId === page.pageId
          );
          if (!match) {
            problems.push(
              `pages[${page.pageId}] is not an approved capture in the capture log`
            );
          } else if (match.agency !== page.agency) {
            problems.push(
              `pages[${page.pageId}] is attributed to ${page.agency} but the capture log records ` +
                `${match.agency}`
            );
          }
        }
      }
    }
  }

  if (problems.length > 0) return { manifest: null, problems };
  return {
    manifest: {
      schema: 'formfair/solo-corpus@1',
      protocol,
      instrument: {
        tag: instrument.tag,
        commit: instrument.commit,
        lockfileSha256: instrument.lockfileSha256,
        packageVersion: instrument.packageVersion,
      },
      synthetic: draft.synthetic === true,
      frameSha256: draft.frameSha256,
      drawOrderSha256: draft.drawOrderSha256,
      selectionLedger: {
        file: draft.selectionLedgerFile,
        sha256: sha256(ledger.bytes),
        bytes: ledger.bytes.length,
      },
      pages,
      exhaustedAgencies: exhausted,
      // solo-protocol-v1.0.4. Counted apart in the manifest itself, so a reader does not have to
      // tally the array to learn how much of the frame was actually read. An agency whose
      // discovery was blocked belongs in neither the numerator nor the searched denominator.
      agencyResolutions: {
        boundedDiscoveryComplete: exhausted.filter((e) => e.resolution === AGENCY_RESOLUTIONS.BOUNDED_DISCOVERY_COMPLETE).length,
        technicalDiscoveryAttrition:
          exhausted.filter((e) => e.resolution === AGENCY_RESOLUTIONS.TECHNICAL_ATTRITION).length,
      },
      // The sealer attests itself, separately from the analyser it will later run. They are
      // different artefacts under different tags, and a manifest that named only the analyser
      // could not say which sealing rules produced it.
      sealer: sealer
        ? { tag: sealer.tag, commit: sealer.commit, dirty: sealer.dirty }
        : null,
      captureLog: captureLogSeal,
    },
    problems: [],
  };
}

export async function analyseDescriptively({ pages, analysePage, findNameControls, parseFragment, instrument, manifest }) {
  const findingsByRule = Object.fromEntries(RULE_IDS.map((rule) => [rule, 0]));
  const declinesByRule = Object.fromEntries(RULE_IDS.map((rule) => [rule, 0]));
  const advisoriesByCode = {};
  const delegatedByRule = {};
  const pageReports = [];
  let supportedInputs = 0;
  let detectedNameControls = 0;
  let detectedWithPattern = 0;
  let detectedWithMinlength = 0;
  let detectedWithMaxlength = 0;
  let detectedWithAnyDeclaredConstraint = 0;
  let controlsWithFinding = 0;
  let pagesWithFinding = 0;

  for (const page of [...pages].sort((a, b) => a.pageId.localeCompare(b.pageId))) {
    const supported = supportedInputCount(page.html, parseFragment);
    const controls = findNameControls(page.html);
    const result = await analysePage(page.html);
    supportedInputs += supported;
    detectedNameControls += controls.length;
    detectedWithPattern += controls.filter((c) => c.pattern !== null).length;
    detectedWithMinlength += controls.filter((c) => c.minLength !== null).length;
    detectedWithMaxlength += controls.filter((c) => c.maxLength !== null).length;
    detectedWithAnyDeclaredConstraint += controls.filter(
      (c) => c.pattern !== null || c.minLength !== null || c.maxLength !== null
    ).length;

    const affected = new Set(result.findings.map((f) => `${f.source.line}:${f.source.column}`));
    controlsWithFinding += affected.size;
    if (affected.size > 0) pagesWithFinding += 1;
    for (const finding of result.findings) increment(findingsByRule, finding.rule);
    for (const decline of result.declined) increment(declinesByRule, decline.rule);
    for (const advisory of result.advisories) increment(advisoriesByCode, advisory.code);
    for (const finding of result.delegated?.findings ?? []) increment(delegatedByRule, finding.ruleId);

    pageReports.push({
      pageId: page.pageId,
      agency: page.agency ?? null,
      htmlSha256: page.sha256,
      supportedInputs: supported,
      toolDetectedNameControls: controls.length,
      toolReportedFindings: result.findings.length,
      toolDeclines: result.declined.length,
      advisories: result.advisories.length,
      delegatedFindings: result.delegated?.findings?.length ?? 0,
      // Positions aid private audit without reproducing third-party markup.
      findings: result.findings.map((f) => ({ rule: f.rule, line: f.source.line, column: f.source.column })),
      declines: result.declined.map((d) => ({ rule: d.rule, line: d.source.line, column: d.source.column })),
    });
  }

  return {
    schema: 'formfair/solo-descriptive-report@1',
    protocol: 'solo-protocol-v1.0.0',
    instrument,
    corpus: {
      manifestSha256: manifest.sha256,
      attestation: manifest.attestation ?? null,
      pages: pages.length,
      synthetic: manifest.synthetic === true,
    },
    counts: {
      supportedInputs,
      toolDetectedNameControls: detectedNameControls,
      detectedWithPattern,
      detectedWithMinlength,
      detectedWithMaxlength,
      detectedWithAnyDeclaredConstraint,
      controlsWithToolReportedFinding: controlsWithFinding,
      pagesWithToolReportedFinding: pagesWithFinding,
    },
    descriptiveRates: {
      toolDetectedShareOfSupportedInputs: ratio(detectedNameControls, supportedInputs),
      patternShareOfToolDetectedControls: ratio(detectedWithPattern, detectedNameControls),
      declaredConstraintShareOfToolDetectedControls: ratio(detectedWithAnyDeclaredConstraint, detectedNameControls),
      toolReportedFindingShareOfDetectedControls: ratio(controlsWithFinding, detectedNameControls),
      pagesWithToolReportedFindingShare: ratio(pagesWithFinding, pages.length),
    },
    toolOutput: {
      findingsByRule,
      declinesByRule,
      advisoriesByCode,
      delegated: { scored: false, findingsByRule: delegatedByRule },
    },
    interpretation: {
      permitted:
        'Describes what the frozen tool reported, its applicability, declared-constraint exposure, declines, and runtime coverage in this corpus.',
      prohibited:
        'These are not human-confirmed defects, precision, recall, F1, or prevalence of actual defects. A tool-reported finding may be a false positive.',
    },
    pages: pageReports,
  };
}
