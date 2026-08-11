/**
 * Joins the frozen inventory, the adjudicated ground truth and what FormFair produced
 * into the dataset the metrics read.
 *
 * The join is a separate, inspectable artefact rather than something that happens inside
 * the scoring, and it is deliberately strict. Every assertion here is a case where a
 * quiet mismatch would still produce plausible numbers:
 *
 *   - a detected control that matches no inventory record means the analysed bytes are
 *     not the captured bytes;
 *   - a report whose control count disagrees with `findNameControls` means the two views
 *     of the same run disagree;
 *   - a finding, decline or advisory that maps to no detected control would be scored
 *     against nothing;
 *   - a detected name control missing an outcome for a rule would shrink the denominator.
 */

import { matchDetected, sha256 } from './inventory.mjs';

const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];

const positionKey = (line, column) => `${line}:${column}`;

/**
 * @param inventory  the frozen inventory for one page
 * @param truth      adjudicated ground truth for that page, keyed by controlId
 * @param detected   what findNameControls returned, as SourceRef-bearing controls
 * @param report     the JSON report from the same run
 */
export function joinPage({ inventory, truth, detected, report }) {
  const problems = [];

  if (report?.summary?.controls !== detected.length) {
    problems.push(
      `${inventory.pageId}: the report counts ${report?.summary?.controls} controls but ` +
        `findNameControls returned ${detected.length}. The two views of one run disagree.`
    );
  }

  // Detected controls, resolved to inventory identities.
  const detectedById = new Map();
  const detectedPositions = new Set();
  for (const control of detected) {
    const source = control.source ?? control;
    const { matched, error } = matchDetected(inventory, source);
    if (error) {
      problems.push(`${inventory.pageId}: ${error}`);
      continue;
    }
    if (detectedById.has(matched.controlId)) {
      problems.push(`${inventory.pageId}: ${matched.controlId} was detected twice`);
      continue;
    }
    detectedById.set(matched.controlId, matched);
    detectedPositions.add(positionKey(source.line, source.column));
  }

  // Everything the report emitted must belong to one of those controls.
  const emitted = [
    ...(report?.findings ?? []).map((f) => ({ kind: `finding ${f.rule}`, line: f.line, column: f.column })),
    ...(report?.declined ?? []).map((d) => ({ kind: `decline ${d.rule}`, line: d.line, column: d.column })),
    ...(report?.advisories ?? []).map((a) => ({ kind: `advisory ${a.code}`, line: a.line, column: a.column })),
  ];
  for (const item of emitted) {
    if (!detectedPositions.has(positionKey(item.line, item.column))) {
      problems.push(
        `${inventory.pageId}: ${item.kind} at line ${item.line}, column ${item.column} maps to ` +
          'no detected control, so it would be scored against nothing'
      );
    }
  }

  // Per-rule outcomes for each detected control: a finding, else a decline, else clean.
  const outcomeFor = (control) => {
    const at = positionKey(control.line, control.column);
    const outcomes = {};
    for (const rule of RULES) {
      const fired = (report?.findings ?? []).some(
        (f) => f.rule === rule && positionKey(f.line, f.column) === at
      );
      const declined = (report?.declined ?? []).some(
        (d) => d.rule === rule && positionKey(d.line, d.column) === at
      );
      if (fired && declined) {
        problems.push(`${inventory.pageId}: ${control.controlId} has both a finding and a decline for ${rule}`);
      }
      outcomes[rule] = fired ? 'finding' : declined ? 'declined' : 'clean';
    }
    return outcomes;
  };

  const controls = inventory.controls.map((record) => {
    const groundTruth = truth[record.controlId];
    if (!groundTruth) {
      problems.push(`${inventory.pageId}: ${record.controlId} has no adjudicated ground truth`);
    }
    const isNameControl = groundTruth?.isNameControl === true;
    const wasDetected = detectedById.has(record.controlId);

    const control = {
      controlId: record.controlId,
      isNameControl,
      detected: wasDetected,
    };
    if (isNameControl) {
      control.rules = groundTruth.rules;
      for (const rule of RULES) {
        if (!groundTruth.rules?.[rule]) {
          problems.push(`${inventory.pageId}: ${record.controlId} has no ground-truth label for ${rule}`);
        }
      }
      if (wasDetected) control.outcomes = outcomeFor(record);
    }
    return control;
  });

  return {
    page: {
      pageId: inventory.pageId,
      htmlSha256: inventory.htmlSha256,
      controls,
      advisories: report?.advisories ?? [],
      delegatedFindings: report?.delegated?.findings ?? [],
    },
    problems,
  };
}

/**
 * Builds the whole dataset, and records the hash of every input it rests on so a figure
 * can be traced back to the exact material that produced it.
 */
export function buildDataset({ pages, hashes }) {
  const problems = [];
  const built = [];

  for (const page of pages) {
    const { page: joined, problems: pageProblems } = joinPage(page);
    problems.push(...pageProblems);
    built.push(joined);
  }

  const dataset = {
    instrument: 'evaluation-v1.0.0',
    builtFrom: {
      inventorySha256: hashes?.inventory ?? null,
      annotationSha256: hashes?.annotation ?? null,
      adjudicationSha256: hashes?.adjudication ?? null,
      reportsSha256: hashes?.reports ?? null,
      htmlSha256ByPage: Object.fromEntries(built.map((p) => [p.pageId, p.htmlSha256])),
    },
    pages: built,
  };

  return { dataset, problems, datasetSha256: sha256(JSON.stringify(dataset)) };
}
