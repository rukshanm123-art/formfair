/**
 * Shapes of the records the protocol requires, with validators.
 *
 * These are frozen before annotation begins, because a schema settled afterwards can be
 * bent to fit whatever was collected. Validators return a list of problems rather than
 * throwing, so a whole file can be checked in one pass and every fault reported at once.
 *
 * The invariants enforced here are the ones that protect the research claim, not merely
 * the ones that protect the parser:
 *
 *   - "declined" is refused as a ground-truth label. It is a FormFair outcome; admitting
 *     it as a human label would let a hard case be recorded as agreement with the tool.
 *   - A control labelled a personal-name control carries exactly five rule pairs. Fewer
 *     silently shrinks the denominator; more double-counts.
 *   - Every label carries a reason and markup evidence, so adjudication has something to
 *     work from and a label cannot be a bare assertion.
 *   - The viewport is fixed. A capture at another size is not comparable.
 */

export const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];
export const LABELS = ['positive', 'negative'];

/** Protocol section 3, in priority order. */
export const CATEGORIES = [
  'account-registration',
  'service-application',
  'enquiry-or-contact',
  'subscription-or-newsletter',
];

export const CAPTURE_STATUSES = ['captured', 'excluded'];

/** Protocol section 7: the only controls the frozen stage one considers. */
export const SUPPORTED_INPUT_TYPES = ['', 'text', 'search', null];

/** Protocol section 5. CWAC's documented medium viewport. */
export const VIEWPORT = { width: 1280, height: 800 };

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isSha256 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isIsoUtc = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v);

function requireFields(record, fields, where, problems) {
  for (const field of fields) {
    if (!isNonEmptyString(record?.[field])) {
      problems.push(`${where}: ${field} is required and must be a non-empty string`);
    }
  }
}

/** Protocol section 5. One record per agency attempted, whether or not it yielded a page. */
export function validateCapture(record, index = 0) {
  const problems = [];
  const at = `capture[${index}]`;

  requireFields(record, ['agency', 'website', 'originalUrl', 'status'], at, problems);

  if (!CAPTURE_STATUSES.includes(record?.status)) {
    problems.push(`${at}: status must be one of ${CAPTURE_STATUSES.join(', ')}`);
  }

  if (record?.status === 'captured') {
    requireFields(record, ['finalUrl', 'capturedAt', 'browser', 'automationTool', 'locale'], at, problems);
    if (!isSha256(record?.htmlSha256)) problems.push(`${at}: htmlSha256 must be a 64-character hex digest`);
    if (!CATEGORIES.includes(record?.category)) {
      problems.push(`${at}: category must be one of ${CATEGORIES.join(', ')}`);
    }
    if (record?.viewport?.width !== VIEWPORT.width || record?.viewport?.height !== VIEWPORT.height) {
      problems.push(
        `${at}: viewport must be ${VIEWPORT.width}x${VIEWPORT.height}; a capture at another ` +
          'size is not comparable with the rest'
      );
    }
    if (!Array.isArray(record?.redirects)) problems.push(`${at}: redirects must be an array, empty if none`);
    if (record?.capturedAt !== undefined && !isIsoUtc(record.capturedAt)) {
      problems.push(`${at}: capturedAt must be an ISO 8601 UTC timestamp ending in Z`);
    }
  }

  if (record?.status === 'excluded' && !isNonEmptyString(record?.exclusionReason)) {
    problems.push(`${at}: an excluded agency must record why, so the attempt is auditable`);
  }

  return { valid: problems.length === 0, problems };
}

function validateLabel(entry, at, problems) {
  if (entry?.label === 'declined') {
    problems.push(
      `${at}: "declined" is a FormFair outcome, not a ground-truth label. A case the ` +
        'annotator cannot decide goes to adjudication, not into the labels.'
    );
  } else if (!LABELS.includes(entry?.label)) {
    problems.push(`${at}: label must be one of ${LABELS.join(', ')}`);
  }
  if (!isNonEmptyString(entry?.reason)) problems.push(`${at}: a label must carry a short reason`);
  if (!isNonEmptyString(entry?.evidence)) problems.push(`${at}: a label must carry the markup evidence`);
}

/** Protocol section 7. One annotator's independent labels over the whole held-out set. */
export function validateAnnotation(file) {
  const problems = [];

  if (!isNonEmptyString(file?.annotator)) problems.push('annotator id is required');
  if (file?.instrument !== 'evaluation-v1.0.0') {
    problems.push(`instrument must be evaluation-v1.0.0, found ${file?.instrument ?? 'nothing'}`);
  }
  if (!Array.isArray(file?.pages)) {
    problems.push('pages must be an array');
    return { valid: false, problems };
  }

  const seenPages = new Set();
  for (const [p, page] of file.pages.entries()) {
    const at = `page[${p}]`;
    if (!isNonEmptyString(page?.pageId)) problems.push(`${at}: pageId is required`);
    if (seenPages.has(page?.pageId)) problems.push(`${at}: duplicate pageId ${page.pageId}`);
    seenPages.add(page?.pageId);

    if (!Array.isArray(page?.controls)) {
      problems.push(`${at}: controls must be an array`);
      continue;
    }

    const seenControls = new Set();
    for (const [c, control] of page.controls.entries()) {
      const where = `${at}.control[${c}]`;
      if (!isNonEmptyString(control?.controlId)) problems.push(`${where}: controlId is required`);
      if (seenControls.has(control?.controlId)) problems.push(`${where}: duplicate controlId`);
      seenControls.add(control?.controlId);

      if (!SUPPORTED_INPUT_TYPES.includes(control?.inputType ?? null)) {
        problems.push(
          `${where}: inputType ${JSON.stringify(control?.inputType)} is outside the supported set. ` +
            'Only inputs the frozen stage one considers may be annotated.'
        );
      }

      validateLabel(control?.stageOne, `${where}.stageOne`, problems);

      const isName = control?.stageOne?.label === 'positive';
      const rules = control?.rules ?? {};
      const present = Object.keys(rules);

      if (isName) {
        for (const rule of RULES) {
          if (!(rule in rules)) {
            problems.push(`${where}: a personal-name control needs a label for ${rule}`);
            continue;
          }
          validateLabel(rules[rule], `${where}.${rule}`, problems);
        }
        const extra = present.filter((r) => !RULES.includes(r));
        if (extra.length) problems.push(`${where}: unknown rules ${extra.join(', ')}`);
      } else if (present.length > 0) {
        problems.push(
          `${where}: only controls labelled personal-name controls carry rule labels; ` +
            `found ${present.join(', ')}`
        );
      }
    }
  }

  return { valid: problems.length === 0, problems };
}

/** Protocol section 8. Decisions on the disagreements the primaries could not resolve. */
export function validateAdjudication(file) {
  const problems = [];

  if (!isNonEmptyString(file?.adjudicator)) problems.push('adjudicator id is required');
  if (!Array.isArray(file?.decisions)) {
    problems.push('decisions must be an array');
    return { valid: false, problems };
  }

  for (const [i, d] of file.decisions.entries()) {
    const at = `decision[${i}]`;
    requireFields(d, ['pageId', 'controlId', 'reason', 'catalogueClause'], at, problems);
    if (d?.rule !== undefined && !RULES.includes(d.rule)) {
      problems.push(`${at}: rule must be one of ${RULES.join(', ')} when present`);
    }
    if (!LABELS.includes(d?.decision)) {
      problems.push(`${at}: decision must be one of ${LABELS.join(', ')}`);
    }
  }

  return { valid: problems.length === 0, problems };
}

/**
 * The joined dataset the metrics read: adjudicated ground truth on the left, what
 * FormFair did on the right. Kept as its own artefact so the join is inspectable rather
 * than happening invisibly inside the scoring.
 */
export function validateDataset(file) {
  const problems = [];

  if (file?.instrument !== 'evaluation-v1.0.0') {
    problems.push(`instrument must be evaluation-v1.0.0, found ${file?.instrument ?? 'nothing'}`);
  }
  if (!Array.isArray(file?.pages)) {
    problems.push('pages must be an array');
    return { valid: false, problems };
  }

  for (const [p, page] of file.pages.entries()) {
    const at = `page[${p}]`;
    if (!isNonEmptyString(page?.pageId)) problems.push(`${at}: pageId is required`);
    if (!Array.isArray(page?.controls)) {
      problems.push(`${at}: controls must be an array`);
      continue;
    }
    for (const [c, control] of page.controls.entries()) {
      const where = `${at}.control[${c}]`;
      if (!isNonEmptyString(control?.controlId)) problems.push(`${where}: controlId is required`);
      if (typeof control?.isNameControl !== 'boolean') {
        problems.push(`${where}: isNameControl must be a boolean from the adjudicated ground truth`);
      }
      if (typeof control?.detected !== 'boolean') {
        problems.push(
          `${where}: detected must be a boolean. Stage-one recall cannot be computed ` +
            'without knowing which controls FormFair identified, including those it ' +
            'identified and found nothing on.'
        );
      }
      if (control?.isNameControl === true) {
        for (const rule of RULES) {
          if (!LABELS.includes(control?.rules?.[rule])) {
            problems.push(`${where}: ground-truth label for ${rule} must be positive or negative`);
          }
        }
        if (control?.detected === true) {
          for (const [rule, outcome] of Object.entries(control?.outcomes ?? {})) {
            if (!['finding', 'clean', 'declined'].includes(outcome)) {
              problems.push(`${where}.${rule}: outcome must be finding, clean or declined`);
            }
          }
        }
      }
    }
  }

  return { valid: problems.length === 0, problems };
}

export const VALIDATORS = {
  capture: validateCapture,
  annotation: validateAnnotation,
  adjudication: validateAdjudication,
  dataset: validateDataset,
};
