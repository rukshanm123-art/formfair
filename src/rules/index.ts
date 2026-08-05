import type { Finding, NameControl, Rule, RuleId, RuleOutcome, Severity } from '../types.js';
import { analysePattern } from '../parse/pattern.js';
import { utf16Bounds } from '../parse/length.js';
import { accepts, compile } from './accepts.js';
import {
  ASCII_CONTROL,
  DIACRITIC_NAMES,
  NORMALISATION_PAIRS,
  PUNCTUATED_NAMES,
} from './fixtures.js';

export const CATALOGUE_VERSION = '0.1.0';

function finding(
  rule: RuleId,
  severity: Severity,
  control: NameControl,
  message: string,
  evidence: string,
  remediation: string
): RuleOutcome {
  const f: Finding = { rule, severity, message, evidence, remediation, source: control.source };
  return { kind: 'finding', finding: f };
}

const declined = (reason: string): RuleOutcome => ({ kind: 'declined', reason });
const clean: RuleOutcome = { kind: 'clean' };

/**
 * Gate shared by every pattern-dependent rule. A control with no pattern is clean
 * for these rules rather than declined: absence of a constraint is a decidable fact.
 */
function gate(control: NameControl): { re: RegExp } | RuleOutcome {
  if (control.pattern === null) return clean;

  const analysis = analysePattern(control.pattern);
  if (analysis.kind === 'undecidable') return declined(analysis.reason);

  const re = compile(control.pattern);
  if (re === null) return declined('pattern does not compile');
  return { re };
}

function isGate(value: { re: RegExp } | RuleOutcome): value is RuleOutcome {
  return 'kind' in value;
}

const BASIC_LATIN_ONLY: Rule = {
  id: 'FF-01',
  severity: 'critical',
  basis: 'UTS #35 Part 8 advises drawing permitted characters from CLDR exemplar sets rather than restricting to ASCII.',
  evaluate(control) {
    const g = gate(control);
    if (isGate(g)) return g;

    if (!accepts(g.re, ASCII_CONTROL)) return clean;

    const rejected = DIACRITIC_NAMES.filter((n) => !accepts(g.re, n.name));
    if (rejected.length !== DIACRITIC_NAMES.length) return clean;

    return finding(
      'FF-01',
      'critical',
      control,
      'This field declares a constraint that rejects names outside the Basic Latin (ASCII) range.',
      `pattern="${control.pattern}" accepts "${ASCII_CONTROL}" but rejects every tested name containing a letter outside U+0041–U+005A and U+0061–U+007A.`,
      'Draw the permitted characters from the CLDR exemplar sets for the languages the form serves, or use a Unicode-aware class such as \\p{L} with the punctuation names require.'
    );
  },
};

const REJECTS_DIACRITICS: Rule = {
  id: 'FF-02',
  severity: 'critical',
  basis: 'UTS #35 Part 8; diacritics are ordinary letters in te reo Māori and many other orthographies.',
  evaluate(control) {
    const g = gate(control);
    if (isGate(g)) return g;

    const rejected = DIACRITIC_NAMES.filter((n) => !accepts(g.re, n.name));
    if (rejected.length === 0) return clean;

    // Where the class is Basic Latin only, FF-01 is the more general finding and
    // subsumes this one; FF-02 is then listed as contributing evidence, not emitted.
    if (rejected.length === DIACRITIC_NAMES.length && accepts(g.re, ASCII_CONTROL)) return clean;

    const sample = rejected.map((n) => `${n.name} (${n.locale})`).join(', ');
    return finding(
      'FF-02',
      'critical',
      control,
      'Names carrying macrons or other diacritics will be rejected.',
      `pattern="${control.pattern}" rejects: ${sample}.`,
      'Admit the precomposed letters used by the languages the form serves, and normalise to NFC before validating.'
    );
  },
};

const NORMALISATION_ASYMMETRY: Rule = {
  id: 'FF-03',
  severity: 'high',
  basis: 'UAX #15; UTS #35 Part 8 recommends normalising before validation.',
  evaluate(control) {
    const g = gate(control);
    if (isGate(g)) return g;

    const asymmetric = NORMALISATION_PAIRS.filter(
      (p) => accepts(g.re, p.nfc) !== accepts(g.re, p.nfd)
    );
    if (asymmetric.length === 0) return clean;

    const sample = asymmetric
      .map((p) => `"${p.nfc}" ${accepts(g.re, p.nfc) ? 'accepted' : 'rejected'} but its decomposed form ${accepts(g.re, p.nfd) ? 'accepted' : 'rejected'}`)
      .join('; ');

    return finding(
      'FF-03',
      'high',
      control,
      'The constraint treats two identical-looking encodings of the same name differently.',
      `${sample}. The forms are canonically equivalent under UAX #15.`,
      'Normalise the value before validating it, typically to NFC, so that canonically equivalent inputs are treated alike.'
    );
  },
};

const REJECTS_PUNCTUATION: Rule = {
  id: 'FF-04',
  severity: 'high',
  basis: 'UTS #35 Part 8; names such as O’Brien, Anne-Marie and van der Berg require these characters.',
  evaluate(control) {
    const g = gate(control);
    if (isGate(g)) return g;

    const rejected = PUNCTUATED_NAMES.filter((n) => !accepts(g.re, n.name));
    if (rejected.length === 0) return clean;

    const sample = rejected.map((n) => `${n.character} ${n.codePoint} — "${n.name}"`).join('; ');
    return finding(
      'FF-04',
      'high',
      control,
      'Legitimate name punctuation is rejected.',
      `pattern="${control.pattern}" rejects: ${sample}.`,
      'Admit apostrophes, hyphens and internal spaces. Escaping on output is the defence against injection; input restriction is not.'
    );
  },
};

const MINIMUM_LENGTH: Rule = {
  id: 'FF-05',
  severity: 'medium',
  basis: 'Ishida (2011) records that people can have single-letter names.',
  evaluate(control) {
    if (control.minLength !== null && control.minLength > 1) {
      return finding(
        'FF-05',
        'medium',
        control,
        'The field declares a minimum length that excludes short legitimate names.',
        `minlength="${control.minLength}" rejects single-letter names.`,
        'Set the minimum to one, or remove the attribute.'
      );
    }

    if (control.pattern === null) return clean;

    const analysis = analysePattern(control.pattern);
    if (analysis.kind === 'undecidable') return declined(analysis.reason);

    const bounds = utf16Bounds(analysis.atoms);
    if (bounds.kind === 'unresolved') return declined(bounds.reason);
    if (bounds.min <= 1) return clean;

    return finding(
      'FF-05',
      'medium',
      control,
      'The field declares a minimum length that excludes short legitimate names.',
      `pattern="${control.pattern}" accepts nothing shorter than ${bounds.min} characters.`,
      'Allow a single character, or remove the lower bound from the pattern.'
    );
  },
};

export const RULES: readonly Rule[] = [
  BASIC_LATIN_ONLY,
  REJECTS_DIACRITICS,
  NORMALISATION_ASYMMETRY,
  REJECTS_PUNCTUATION,
  MINIMUM_LENGTH,
];
