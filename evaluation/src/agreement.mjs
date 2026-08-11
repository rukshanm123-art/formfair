/**
 * Protocol section 8, step 1. Agreement computed from the two primary annotators'
 * original independent labels, before any adjudication.
 *
 * This is derived, not written by hand, for the same reason the ground truth is: a kappa
 * assembled after the fact can be assembled to taste.
 *
 * ---------------------------------------------------------------------------
 * FROZEN DECISION: which controls enter per-rule agreement
 * ---------------------------------------------------------------------------
 * Recorded 11 August 2026, before any annotation.
 *
 * Per-rule kappa is computed over **controls both annotators independently labelled as
 * personal-name controls at stage one**, and over no others.
 *
 * The alternatives were rejected:
 *
 *   - Union of the two, treating an absent rule label as negative. An annotator who
 *     judged a control not to be a name never formed a view on FF-01 for it. Recording
 *     that non-view as "negative" would invent a label and inflate agreement, since the
 *     invented labels would usually match.
 *   - Controls the adjudicator later ruled to be name controls. The protocol requires
 *     this figure to come from the original independent labels, and adjudication has not
 *     happened when it is computed. Using it would leak a later decision into a
 *     pre-adjudication measure.
 *
 * The consequence is that stage-one disagreements are excluded from per-rule agreement
 * rather than resolved inside it. That is reported explicitly: `stageOneDisagreements`
 * and `controlsInPerRuleBasis` are part of the output, so a reader can see how much of
 * the corpus each per-rule figure rests on.
 * ---------------------------------------------------------------------------
 */

import { createHash } from 'node:crypto';
import { cohensKappa } from './stats.mjs';

export const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];

export const PER_RULE_BASIS =
  'controls both annotators independently labelled as personal-name controls at stage one';

const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

function index(file) {
  const byPage = new Map();
  for (const page of file?.pages ?? []) {
    const byControl = new Map();
    for (const control of page.controls ?? []) byControl.set(control.controlId, control);
    byPage.set(page.pageId, byControl);
  }
  return byPage;
}

/**
 * @returns {{ agreement: object|null, problems: string[], text: string|null, sha256: string|null }}
 */
export function computeAgreement({ annotationA, annotationB, inventory }) {
  const problems = [];

  if (!Array.isArray(inventory?.pages)) {
    return {
      agreement: null,
      problems: ['the frozen inventory is required: it fixes which controls are compared, and their order'],
      text: null,
      sha256: null,
    };
  }
  if (annotationA?.annotator && annotationA.annotator === annotationB?.annotator) {
    problems.push('both annotation files name the same annotator; agreement needs two');
  }

  const a = index(annotationA);
  const b = index(annotationB);

  // Order comes from the inventory, so the vectors, and therefore the figures, do not
  // depend on the order either annotator happened to submit.
  const stageOneA = [];
  const stageOneB = [];
  const perRuleA = Object.fromEntries(RULES.map((r) => [r, []]));
  const perRuleB = Object.fromEntries(RULES.map((r) => [r, []]));
  let stageOneDisagreements = 0;
  let controlsInPerRuleBasis = 0;

  for (const page of [...inventory.pages].sort((x, y) => (x.pageId < y.pageId ? -1 : 1))) {
    for (const record of page.controls) {
      const controlA = a.get(page.pageId)?.get(record.controlId);
      const controlB = b.get(page.pageId)?.get(record.controlId);
      const labelA = controlA?.stageOne?.label;
      const labelB = controlB?.stageOne?.label;

      if (labelA === undefined || labelB === undefined) {
        problems.push(
          `${page.pageId}/${record.controlId}: in the frozen inventory but not labelled by ` +
            'both annotators, so agreement cannot be computed over the whole corpus'
        );
        continue;
      }

      stageOneA.push(labelA);
      stageOneB.push(labelB);
      if (labelA !== labelB) {
        stageOneDisagreements += 1;
        continue;
      }
      if (labelA !== 'positive') continue;

      controlsInPerRuleBasis += 1;
      for (const rule of RULES) {
        perRuleA[rule].push(controlA?.rules?.[rule]?.label);
        perRuleB[rule].push(controlB?.rules?.[rule]?.label);
      }
    }
  }

  if (problems.length > 0) return { agreement: null, problems, text: null, sha256: null };

  const pooledA = RULES.flatMap((r) => perRuleA[r]);
  const pooledB = RULES.flatMap((r) => perRuleB[r]);

  const agreement = {
    instrument: 'evaluation-v1.0.0',
    computedFrom: {
      annotatorA: annotationA?.annotator ?? null,
      annotatorB: annotationB?.annotator ?? null,
      basis: 'the original independent labels, before adjudication',
    },
    perRuleBasis: PER_RULE_BASIS,
    stageOneDisagreements,
    controlsInPerRuleBasis,
    stageOne: cohensKappa(stageOneA, stageOneB),
    perRule: Object.fromEntries(RULES.map((r) => [r, cohensKappa(perRuleA[r], perRuleB[r])])),
    pooled: cohensKappa(pooledA, pooledB),
  };

  const text = JSON.stringify(agreement, null, 2) + '\n';
  return { agreement, problems, text, sha256: sha256(text) };
}

/** The protocol's calibration threshold. Reported, never enforced silently. */
export const REQUIRED_KAPPA = 0.7;

export function belowThreshold(agreement) {
  const under = [];
  const check = (name, result) => {
    if (result?.estimable === true && result.kappa < REQUIRED_KAPPA) {
      under.push(`${name}: ${result.kappa.toFixed(3)}`);
    } else if (result?.estimable === false) {
      under.push(`${name}: not estimable (${result.reason})`);
    }
  };
  check('stage one', agreement.stageOne);
  for (const [rule, result] of Object.entries(agreement.perRule)) check(rule, result);
  return under;
}
