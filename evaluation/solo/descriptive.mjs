import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
export const SOLO_PROTOCOL_TAG = 'solo-protocol-v1.0.3';

export const EXHAUSTION_REASON =
  'all four categories in the frozen priority order were searched and none yielded an eligible form';
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
    if (record?.reason !== EXHAUSTION_REASON) {
      problems.push(
        `${where}.reason must be the frozen exhaustion reason. Five agencies that did not ` +
          'qualify are interpretable only if every one left for the same stated reason.'
      );
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
      reason: record.reason,
      categorySetVersions: record.categorySetVersions,
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
