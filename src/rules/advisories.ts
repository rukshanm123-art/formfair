import type { Advisory, NameControl } from '../types.js';

/**
 * Advisory checks. These are reported but never scored.
 *
 * The distinction they preserve is the one the rule catalogue rests on. A rule fires
 * when the declared constraints demonstrably treat a supported real-name fixture
 * differently; an advisory fires when a constraint makes such treatment constructible
 * without any fixture witnessing it. Folding the second into the first would change
 * what the accuracy figures measure — a precision denominator counting how many
 * controls declare `maxlength` is not a measure of cultural exclusion.
 */
export interface AdvisoryCheck {
  readonly code: string;
  evaluate(control: NameControl): Advisory | null;
}

/**
 * `maxlength` counts UTF-16 code units (HTML Standard, via Infra's definition of string
 * length). Decomposing a name can add a combining mark, so for any finite maximum M at
 * least one value exists whose NFC form is M units and whose NFD form is M+1 — accepted
 * in one encoding and rejected in the other.
 *
 * This is valid for every M >= 1 and is therefore not evidence about a particular
 * control, which is why it is an advisory rather than an FF-03 finding. M = 0 is
 * excluded: it rejects every non-empty name in both encodings, so it is symmetric.
 */
const NORMALISATION_BOUNDARY: AdvisoryCheck = {
  code: 'ADV-NORM-BOUNDARY',
  evaluate(control) {
    if (control.maxLength === null || control.maxLength < 1) return null;
    return {
      code: 'ADV-NORM-BOUNDARY',
      message:
        `Potential normalisation boundary: maxlength="${control.maxLength}" can distinguish ` +
        'some canonically equivalent NFC and NFD inputs unless the value is normalised ' +
        'before validation. Not scored: no fixture witnessed this on this control.',
      basis: 'UTS #35 Part 8 and UAX #15 recommend normalising before validating.',
      source: control.source,
    };
  },
};

export const ADVISORIES: readonly AdvisoryCheck[] = [NORMALISATION_BOUNDARY];
