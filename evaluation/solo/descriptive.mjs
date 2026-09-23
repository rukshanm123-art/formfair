import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

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

export function loadSealedPages({ manifest, manifestPath, capturesDir }) {
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

const isoUtc = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.endsWith('Z');

export function sealCorpus({ draft, capturesDir, instrument, protocol = 'solo-protocol-v1.0.0' }) {
  const problems = [];
  if (draft?.schema !== 'formfair/solo-corpus-draft@1') {
    problems.push('draft schema must be formfair/solo-corpus-draft@1');
  }
  if (!Array.isArray(draft?.pages) || draft.pages.length === 0) problems.push('draft must contain at least one page');
  if (typeof draft?.frameSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(draft.frameSha256)) {
    problems.push('frameSha256 must be a SHA-256 digest');
  }
  if (typeof draft?.drawOrderSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(draft.drawOrderSha256)) {
    problems.push('drawOrderSha256 must be a SHA-256 digest');
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
    if (capture) pages.push({ ...page, sha256: sha256(capture.bytes), bytes: capture.bytes.length });
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
