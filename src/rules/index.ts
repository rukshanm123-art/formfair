import type { NameControl, Rule, RuleFinding, RuleId, RuleOutcome, Severity } from '../types.js';
import type { Atom } from '../parse/pattern.js';
import { analysePattern, letterProfile, patternAdmits } from '../parse/pattern.js';
import { utf16Bounds } from '../parse/length.js';
import { accepts, compile } from './accepts.js';
import { DIACRITIC_NAMES, NORMALISATION_PAIRS, PUNCTUATED_NAMES } from './fixtures.js';

export const CATALOGUE_VERSION = '1.0.0';

function finding(
  rule: RuleId,
  severity: Severity,
  control: NameControl,
  message: string,
  evidence: string,
  remediation: string
): RuleOutcome {
  const f: RuleFinding = { rule, severity, message, evidence, remediation, source: control.source };
  return { kind: 'finding', finding: f };
}

const declined = (reason: string): RuleOutcome => ({ kind: 'declined', reason });
const clean: RuleOutcome = { kind: 'clean' };

const UNDECIDED_CHARACTERS = 'cannot determine which characters the pattern admits';

interface Compiled {
  readonly atoms: readonly Atom[];
  readonly re: RegExp;
}

/**
 * Gate shared by every pattern-dependent rule. A control with no pattern is clean
 * for these rules rather than declined: absence of a constraint is a decidable fact.
 *
 * The pattern must both parse into the supported subset and compile under the `v`
 * flag. Nothing that fails either test is analysed under looser semantics.
 */
function gate(control: NameControl): Compiled | RuleOutcome {
  if (control.pattern === null) return clean;

  const analysis = analysePattern(control.pattern);
  if (analysis.kind === 'undecidable') return declined(analysis.reason);

  const re = compile(control.pattern);
  if (re === null) return declined('pattern does not compile as an HTML pattern');
  return { atoms: analysis.atoms, re };
}

function isOutcome(value: Compiled | RuleOutcome): value is RuleOutcome {
  return 'kind' in value;
}

/**
 * The characters in the list the pattern does not admit, tested one character at a
 * time. Null where any of them cannot be decided.
 *
 * Testing single characters rather than whole names is what keeps a length constraint
 * from being misread as a character constraint: a pattern such as `[A-Za-z]{1,3}`
 * rejects the name "Tāwhiao" for its length, not for its macron.
 */
function unadmitted(atoms: readonly Atom[], characters: readonly string[]): string[] | null {
  const missing: string[] = [];
  for (const ch of characters) {
    const admitted = patternAdmits(atoms, ch);
    if (admitted === null) return null;
    if (!admitted) missing.push(ch);
  }
  return missing;
}

const BASIC_LATIN_ONLY: Rule = {
  id: 'FF-01',
  severity: 'critical',
  basis: 'UTS #35 Part 8 advises drawing permitted characters from CLDR exemplar sets rather than restricting to ASCII.',
  evaluate(control) {
    const g = gate(control);
    if (isOutcome(g)) return g;

    const profile = letterProfile(g.atoms);
    if (profile === null) return declined('cannot determine which letters the pattern admits');

    // A pattern admitting no letter at all is not a Basic Latin restriction; a pattern
    // admitting a letter outside the range is not restricted to Basic Latin either.
    if (!profile.basicLatin || profile.outsideBasicLatin) return clean;

    return finding(
      'FF-01',
      'critical',
      control,
      'This field declares a constraint that rejects names outside the Basic Latin (ASCII) range.',
      `pattern="${control.pattern}" admits letters in U+0041-U+005A and U+0061-U+007A and no letter outside that range.`,
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
    if (isOutcome(g)) return g;

    const profile = letterProfile(g.atoms);
    if (profile === null) return declined('cannot determine which letters the pattern admits');

    // Where the class is Basic Latin only, FF-01 is the more general finding and
    // subsumes this one; FF-02 is then contributing evidence, not a separate finding.
    if (profile.basicLatin && !profile.outsideBasicLatin) return clean;

    const affected: { name: string; locale: string; missing: string[] }[] = [];
    for (const n of DIACRITIC_NAMES) {
      const missing = unadmitted(g.atoms, n.characters);
      if (missing === null) return declined(UNDECIDED_CHARACTERS);
      if (missing.length > 0) affected.push({ name: n.name, locale: n.locale, missing });
    }
    if (affected.length === 0) return clean;

    const sample = affected
      .map((a) => `${a.name} (${a.locale}, needs ${a.missing.join(' ')})`)
      .join(', ');
    return finding(
      'FF-02',
      'critical',
      control,
      'Names carrying macrons or other diacritics will be rejected.',
      `No position in pattern="${control.pattern}" admits the characters these names require: ${sample}.`,
      'Admit the precomposed letters used by the languages the form serves, and normalise to NFC before validating.'
    );
  },
};

/**
 * Whether a value is refused, and by which declared constraint. Returns null when the
 * value is admitted. `minlength` and `maxlength` count UTF-16 code units, which is what
 * `String.prototype.length` reports, so the two are directly comparable.
 */
function refusedBy(control: NameControl, re: RegExp | null, value: string): string | null {
  if (control.minLength !== null && value.length < control.minLength) {
    return `minlength="${control.minLength}"`;
  }
  if (control.maxLength !== null && value.length > control.maxLength) {
    return `maxlength="${control.maxLength}"`;
  }
  if (re !== null && !accepts(re, value)) return `pattern="${control.pattern}"`;
  return null;
}

/**
 * FF-03 fires when the complete set of statically observable constraints yields
 * different accept/reject outcomes for at least one canonically equivalent pair in the
 * frozen, versioned NFC/NFD fixture set. A clean result means no asymmetry was
 * witnessed within that set; it does not prove that arbitrary input is
 * normalisation-safe.
 *
 * The rule is deliberately not generalised to every finite `maxlength`, though the
 * argument that one could always be crossed is valid. See ADV-NORM-BOUNDARY in
 * ./advisories.ts, which reports that condition without scoring it.
 */
const NORMALISATION_ASYMMETRY: Rule = {
  id: 'FF-03',
  severity: 'high',
  basis: 'UAX #15; UTS #35 Part 8 recommends normalising before validation.',
  evaluate(control) {
    const g = gate(control);
    if (isOutcome(g) && g.kind === 'declined') return g;

    // A control with no pattern still reaches this rule: decomposing a name lengthens
    // it in UTF-16 code units, so a length bound alone can separate the two forms.
    const re = isOutcome(g) ? null : g.re;
    if (re === null && control.minLength === null && control.maxLength === null) return clean;

    const asymmetric = NORMALISATION_PAIRS.map((p) => ({
      pair: p,
      nfc: refusedBy(control, re, p.nfc),
      nfd: refusedBy(control, re, p.nfd),
    })).filter((r) => (r.nfc === null) !== (r.nfd === null));

    if (asymmetric.length === 0) return clean;

    // One clause per responsible constraint, rather than one per name, so a control
    // with several affected names does not repeat the same pattern three times.
    const group = (
      rows: typeof asymmetric,
      cause: (r: (typeof asymmetric)[number]) => string,
      phrase: (names: string, c: string) => string
    ): string[] =>
      [...new Set(rows.map(cause))].map((c) =>
        phrase(
          rows
            .filter((r) => cause(r) === c)
            .map((r) => `"${r.pair.nfc}"`)
            .join(', '),
          c
        )
      );

    const sample = [
      ...group(
        asymmetric.filter((r) => r.nfc === null),
        (r) => r.nfd!,
        (names, c) => `${names} accepted, but the decomposed form rejected by ${c}`
      ),
      ...group(
        asymmetric.filter((r) => r.nfd === null),
        (r) => r.nfc!,
        (names, c) => `${names} rejected by ${c}, but the decomposed form accepted`
      ),
    ].join('; ');

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
  basis: "UTS #35 Part 8; names such as O'Brien, Anne-Marie and van der Berg require these characters.",
  evaluate(control) {
    const g = gate(control);
    if (isOutcome(g)) return g;

    const missing = unadmitted(
      g.atoms,
      PUNCTUATED_NAMES.map((p) => p.char)
    );
    if (missing === null) return declined(UNDECIDED_CHARACTERS);
    if (missing.length === 0) return clean;

    const rejected = PUNCTUATED_NAMES.filter((p) => missing.includes(p.char));
    const sample = rejected.map((p) => `${p.character} ${p.codePoint} - "${p.name}"`).join('; ');
    return finding(
      'FF-04',
      'high',
      control,
      'Legitimate name punctuation is rejected.',
      `No position in pattern="${control.pattern}" admits: ${sample}.`,
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

    // Routed through the shared gate so that a pattern the browser would reject is
    // declined here too, rather than measured from a parse the browser never runs.
    const g = gate(control);
    if (isOutcome(g)) return g;

    const bounds = utf16Bounds(g.atoms);
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
