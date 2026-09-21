/**
 * A BEHAVIOURAL WITNESS GENERATOR for FF-01..FF-05.
 *
 * NOT a ground-truth oracle, and the distinction is load-bearing. FormFair decides these
 * rules STRUCTURALLY - it parses the pattern and enumerates the character sets it admits,
 * which can establish that a class contains no letter outside a range. This module works
 * behaviourally: it compiles the control's constraints the way a browser does and observes
 * what is accepted. Finite probing can establish that a character IS admitted, by
 * exhibiting a string that is accepted. It can never establish that NONE is, because no
 * finite set of probes exhausts the alphabet.
 *
 * Every rule in the catalogue fires on an EXCLUSION - no letter outside Basic Latin, no
 * macron at any position, no apostrophe anywhere, no accepted string of length one. So the
 * direction this module cannot prove is exactly the direction the rules are defined in.
 * What it produces is independent behavioural EVIDENCE: concrete strings this control
 * accepts and rejects, and a bounded reading of what they suggest. An exact independent
 * oracle would need a second regex-language analyser, which is a different artefact.
 *
 * Labels carry `bounded: true` wherever the reading rests on an absence that probing
 * cannot prove. They are evidence to weigh, never ground truth to score against.
 *
 * HTML `pattern` semantics, per the HTML Standard: the value must match in full and the
 * expression is compiled with the `v` flag. Where it does not compile, the browser applies
 * NO pattern at all rather than rejecting every value (MDN, `pattern`), so the control's
 * effective constraint is its length attributes alone. That is recorded; the rule labels
 * are withheld, because FormFair may still correctly decline to classify such a control.
 */

import {
  DIACRITIC_NAMES,
  MACRON_NAMES,
  PUNCTUATED_NAMES,
  SHORT_NAMES,
  ASCII_CONTROL,
  NORMALISATION_PAIRS,
} from './fixtures.mjs';

/** UTF-16 code units, matching what minlength and maxlength count. */
const units = (s) => s.length;

/**
 * Compiles a control's constraints into an acceptance predicate, or reports why it
 * cannot. Length limits are applied alongside the pattern because the catalogue treats
 * "the complete set of statically observable constraints" as one thing.
 */
export function acceptorFor({ pattern, minlength, maxlength }) {
  let re = null;
  if (pattern !== undefined && pattern !== null && pattern !== '') {
    try {
      re = new RegExp(`^(?:${pattern})$`, 'v');
    } catch (error) {
      return { ok: false, reason: `pattern does not compile under the v flag: ${error.message}` };
    }
  }
  const min = Number.isFinite(minlength) ? minlength : 0;
  const max = Number.isFinite(maxlength) ? maxlength : Infinity;

  return {
    ok: true,
    accepts(value) {
      if (units(value) < min || units(value) > max) return false;
      return re === null ? true : re.test(value);
    },
  };
}

/**
 * Does this control admit a given CHARACTER anywhere?
 *
 * Probed across several positions and lengths, because a length attribute would otherwise
 * be mistaken for a character restriction: `[A-Za-z]{1,3}` rejects "Smith" for its length,
 * not because it excludes any letter in it.
 *
 * A true result is a WITNESS - a string this control accepts that contains the character.
 * A false result means no probe succeeded, which is weaker: it is consistent with the
 * character being excluded, and also with it being admissible only in a position or length
 * these probes did not try.
 */
function admitsCharacter(accepts, ch) {
  const probes = [
    ch,
    ch + ch,
    ch.repeat(3),
    'A' + ch,
    ch + 'a',
    'a' + ch + 'a',
    'Sm' + ch + 'th',
    'Ana' + ch,
  ];
  for (const p of probes) if (accepts(p)) return p;
  return null;
}

/** Basic Latin letters, probed individually rather than through a five-letter name. */
const BASIC_LATIN_SAMPLE = [...'abcmnxyzABCMNXYZ'];

/** Letters outside Basic Latin drawn from the declared locales, plus the macron set. */
const OUTSIDE_BASIC_LATIN = [
  ...'\u0101\u0113\u012b\u014d\u016b\u0100\u0112\u012a\u014c\u016a',
  ...'\u00e9\u00e8\u00ea\u00eb\u00c9\u00c8\u00ca\u00cb',
  ...'\u00fc\u00f6\u00e4\u00dc\u00d6\u00c4\u00df',
  ...'\u00fa\u00f1\u00da\u00d1\u00e1\u00ed\u00f3',
  ...'\u0141\u0142\u0159\u0161\u010d\u017e\u011f\u0131\u015f',
  ...'\u1ec5\u00e2\u00e0\u00f4\u02bb',
];

export function behaviouralWitness(control) {
  const acc = acceptorFor(control);
  if (!acc.ok) {
    return {
      undecidable: true,
      reason: acc.reason,
      // The browser applies no pattern in this case, so the effective constraint is the
      // length attributes alone - the field is MORE permissive than it looks, not less.
      patternIgnoredByBrowser: true,
      effectiveConstraint: 'length attributes only',
    };
  }
  const accepts = acc.accepts;

  const basicLatinWitness = BASIC_LATIN_SAMPLE.map((ch) => admitsCharacter(accepts, ch)).find(Boolean);
  const outsideWitnesses = OUTSIDE_BASIC_LATIN.map((ch) => [ch, admitsCharacter(accepts, ch)]).filter(
    ([, w]) => w
  );

  // The characters each fixture name needs, which is what FF-02 is defined over - not
  // macrons alone. A class admitting the macron but excluding the French or German
  // fixtures still excludes a required diacritic.
  const requiredDiacritics = [
    ...new Set(DIACRITIC_NAMES.flatMap((d) => [...d.name].filter((ch) => /\p{L}/u.test(ch) && !/[A-Za-z]/.test(ch)))),
  ];
  const requiredAdmitted = requiredDiacritics.filter((ch) => admitsCharacter(accepts, ch));
  const requiredNotWitnessed = requiredDiacritics.filter((ch) => !admitsCharacter(accepts, ch));

  // Punctuation is probed per CHARACTER, so a short maxlength cannot masquerade as a
  // punctuation restriction: "van der Berg" is twelve units long.
  const punctuationNotWitnessed = PUNCTUATED_NAMES.filter((p) => !admitsCharacter(accepts, p.char));

  // A single accepted character of ANY case establishes a minimum length of one. Probing
  // only uppercase O and X would read `[a-z]{1}` as having a minimum above one.
  const singleCharWitness = [...BASIC_LATIN_SAMPLE, ...OUTSIDE_BASIC_LATIN, ...'0123456789', ..."'\u2019 -."].find((ch) =>
    accepts(ch)
  );

  const asymmetric = NORMALISATION_PAIRS.filter((p) => accepts(p.nfc) !== accepts(p.nfd));

  const bounded = (label, isBounded, why) => ({ label, bounded: isBounded, ...(isBounded ? { why } : {}) });

  return {
    undecidable: false,
    // Evidence, not ground truth. `bounded` marks a reading that rests on an absence
    // finite probing cannot prove.
    evidence: {
      // The catalogue requires a pattern that admits AT LEAST ONE Basic Latin letter. A
      // digits-only class admits none, so the rule cannot fire however few outside letters
      // are witnessed. This witness was computed and reported but not gated on, and
      // `[0-9]{1,5}` came back positive.
      'FF-01': !basicLatinWitness
        ? bounded('negative', false)
        : outsideWitnesses.length > 0
          ? bounded('negative', false)
          : bounded('positive', true, 'no outside letter was witnessed, which probing cannot turn into proof that none is admitted'),
      'FF-02': outsideWitnesses.length === 0
        ? bounded('negative', true, 'suppressed by FF-01, whose own reading is bounded')
        : requiredNotWitnessed.length > 0
          ? bounded('positive', true, 'rests on a required fixture diacritic not being witnessed')
          : bounded('negative', false),
      'FF-03': asymmetric.length > 0
        ? bounded('positive', false)
        : bounded('negative', true, 'no asymmetry witnessed within the frozen pair set'),
      'FF-04': punctuationNotWitnessed.length > 0
        ? bounded('positive', true, 'rests on a punctuation character not being witnessed')
        : bounded('negative', false),
      'FF-05': singleCharWitness
        ? bounded('negative', false)
        : bounded('positive', true, 'no accepted single character was witnessed'),
    },
    witness: {
      basicLatinAccepted: basicLatinWitness ?? null,
      outsideBasicLatinAdmitted: outsideWitnesses.map(([ch]) => ch),
      requiredDiacriticsAdmitted: requiredAdmitted,
      requiredDiacriticsNotWitnessed: requiredNotWitnessed,
      punctuationNotWitnessed: punctuationNotWitnessed.map((p) => `${p.name} (${p.codePoint})`),
      singleCharacterAccepted: singleCharWitness ?? null,
      normalisationAsymmetries: asymmetric.map((p) => p.nfc),
      diacriticNamesAccepted: DIACRITIC_NAMES.filter((d) => accepts(d.name)).map((d) => d.name),
    },
  };
}

/** Flattens the evidence to bare labels, for comparison only. Never ground truth. */
export function suggestedLabels(control) {
  const r = behaviouralWitness(control);
  if (r.undecidable) return r;
  return {
    undecidable: false,
    rules: Object.fromEntries(Object.entries(r.evidence).map(([k, v]) => [k, v.label])),
    bounded: Object.fromEntries(Object.entries(r.evidence).map(([k, v]) => [k, v.bounded])),
    witness: r.witness,
  };
}
