/**
 * A BEHAVIOURAL WITNESS GENERATOR for FF-01..FF-05.
 *
 * NOT an oracle, and after this rewrite it does not pretend to be one. The conclusion the
 * work reached is worth stating before the code, because it is what the code now encodes:
 *
 *   Where this module is DECISIVE it is not INDEPENDENT, and where it is INDEPENDENT it is
 *   not DECISIVE.
 *
 * FF-03 is fully decided here, because the catalogue scopes it to a frozen set of three
 * canonically equivalent pairs and three pairs can be exhausted - but deciding it means
 * comparing NFC and NFD acceptance, which is the same arithmetic FormFair does, so it is
 * no second opinion. The `minlength` branch of FF-05 is likewise decided by reading an
 * attribute, which is not an independent method either.
 *
 * FF-01, FF-02 and FF-04 are where genuinely independent reasoning happens, and all three
 * fire on an ABSENCE: no letter outside Basic Latin, no macron at any position, no
 * apostrophe anywhere. Finite probing exhibits a string that IS accepted and can never
 * exhaust an alphabet to show none is. So in the direction those rules fire, this module
 * can produce no established answer at all.
 *
 * Every result is therefore one of three states, and `unknown` is not a failure mode but
 * the honest answer for most positive readings:
 *
 *   established-negative  a witness proves the rule cannot fire
 *   established-positive  only where the rule's own scope is finite and exhaustible
 *   unknown               no witness found, which is not proof that none exists
 *
 * An earlier version claimed one exception: that "admits at least one Basic Latin letter"
 * is exhaustible because the set has 52 members. That was wrong. The ALPHABET is finite,
 * but each letter can only be tried in finitely many contexts, and a pattern such as
 * `[A-Za-z]{6,10}` accepts no probe shorter than six. Absence of a witness is never
 * establishable in any direction here, whatever the alphabet.
 *
 * HTML `pattern` semantics, per the HTML Standard: the value must match in full and the
 * expression is compiled with the `v` flag. An attribute that is PRESENT BUT EMPTY
 * compiles to an anchored empty expression and so rejects every non-empty value; only an
 * ABSENT attribute means no pattern is applied. Where the expression does not compile the
 * browser applies no pattern at all rather than rejecting everything, so the control is
 * more permissive than it looks; that is recorded and no rule state is reported.
 */

import {
  DIACRITIC_NAMES,
  PUNCTUATED_NAMES,
  NORMALISATION_PAIRS,
} from './fixtures.mjs';

export const ESTABLISHED_POSITIVE = 'established-positive';
export const ESTABLISHED_NEGATIVE = 'established-negative';
export const UNKNOWN = 'unknown';

/** UTF-16 code units, matching what minlength and maxlength count. */
const units = (s) => s.length;

/** All 52 Basic Latin letters. Finite and small, so absence here IS establishable. */
const BASIC_LATIN_LETTERS = [
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
];

/** Every printable ASCII character, for establishing that some one-unit value is accepted. */
const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

/**
 * A deliberately NON-exhaustive sample of letters outside Basic Latin, used only to find
 * witnesses of admission. Enlarging it buys a few more established negatives and can never
 * make absence provable, so it is not treated as complete and is not grown when a new
 * counterexample appears - the counterexample simply returns `unknown`.
 */
const OUTSIDE_SAMPLE = [
  ...'āēīōūĀĒĪŌŪ',
  ...'éèêëÉÈÊË',
  ...'üöäÜÖÄß',
  ...'úñÚÑáíó',
  ...'Łłřščžğış',
  ...'ễâàôʻ',
  ...'øåÆØÅæ',
];

/**
 * Compiles a control's constraints into an acceptance predicate, or reports why it cannot.
 *
 * Length limits are applied alongside the pattern, because the catalogue treats "the
 * complete set of statically observable constraints" as one thing.
 */
export function acceptorFor({ pattern, minlength, maxlength }) {
  let re = null;
  // An absent attribute means no pattern. A PRESENT attribute, even empty, is compiled -
  // `pattern=""` becomes /^(?:)$/v and rejects every non-empty value.
  if (pattern !== undefined && pattern !== null) {
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
 * Finds a string this control accepts that contains `ch`, or null.
 *
 * Probed across positions and lengths so that a length attribute is not mistaken for a
 * character restriction: `[A-Za-z]{1,3}` rejects "Smith" for its length, not its letters.
 * A returned string is a WITNESS. Null is weaker than it looks - it is consistent with the
 * character being excluded, and with it being admissible somewhere these probes did not
 * reach.
 */
function witnessFor(accepts, ch, lengths = []) {
  const probes = [ch, ch + ch, ch.repeat(3), 'A' + ch, ch + 'a', 'a' + ch + 'a', 'Sm' + ch + 'th', 'Ana' + ch];
  // Longer forms, including any length the control's own attributes demand. `[A-Za-z]{6,10}`
  // accepts no string shorter than six, so every probe above misses and the character looks
  // excluded. Extra lengths only find MORE witnesses; they never turn a miss into proof.
  for (const n of new Set([5, 6, 8, 10, 12, ...lengths])) {
    if (n > 0 && n <= 64) probes.push(ch.repeat(n), 'a'.repeat(Math.max(0, n - 1)) + ch);
  }
  for (const p of probes) if (accepts(p)) return p;
  return null;
}

const state = (s, why, witness) => ({ state: s, why, ...(witness ? { witness } : {}) });

/**
 * What can be established about each rule for one control, by execution alone.
 *
 * Every branch that would need to prove an absence over an unbounded alphabet returns
 * `unknown`. Nothing here is ground truth; it is evidence, and it says how good.
 */
export function behaviouralWitness(control) {
  const acc = acceptorFor(control);
  if (!acc.ok) {
    return {
      undecidable: true,
      reason: acc.reason,
      patternIgnoredByBrowser: true,
      effectiveConstraint: 'length attributes only',
    };
  }
  const accepts = acc.accepts;

  // Exhaustive over the 52 Basic Latin letters, so a null result here is established.
  // Lengths the control itself declares, so a minimum of six is probed at six.
  const declared = [control?.minlength, control?.maxlength].filter((n) => Number.isFinite(n) && n > 0);
  const probe = (ch) => witnessFor(accepts, ch, declared);

  const basicLatinWitness = BASIC_LATIN_LETTERS.map(probe).find(Boolean) ?? null;
  const outsideWitnesses = OUTSIDE_SAMPLE.map((ch) => [ch, probe(ch)]).filter(([, w]) => w);

  const requiredDiacritics = [
    ...new Set(
      DIACRITIC_NAMES.flatMap((d) => [...d.name].filter((ch) => /\p{L}/u.test(ch) && !/[A-Za-z]/.test(ch)))
    ),
  ];
  const requiredAdmitted = requiredDiacritics.filter((ch) => probe(ch));
  const allRequiredAdmitted = requiredAdmitted.length === requiredDiacritics.length;

  const punctuationAdmitted = PUNCTUATED_NAMES.filter((p) => probe(p.char));
  const allPunctuationAdmitted = punctuationAdmitted.length === PUNCTUATED_NAMES.length;

  const singleUnitWitness = [...PRINTABLE_ASCII, ...OUTSIDE_SAMPLE].find((ch) => accepts(ch)) ?? null;
  const asymmetric = NORMALISATION_PAIRS.filter((p) => accepts(p.nfc) !== accepts(p.nfd));

  const minlengthAboveOne = Number.isFinite(control?.minlength) && control.minlength > 1;

  return {
    undecidable: false,
    evidence: {
      // Cannot ever be established positive: that needs no letter outside Basic Latin,
      // over an alphabet probing cannot exhaust.
      // Only an outside-letter WITNESS can establish this. Trying all 52 Basic Latin
      // letters is not exhaustive either, because each is tried in finitely many contexts:
      // `[A-Za-z]{6,10}` accepts no probe shorter than six, so a missing Basic Latin
      // witness means nothing was found, never that nothing is admitted.
      'FF-01': outsideWitnesses.length > 0
        ? state(ESTABLISHED_NEGATIVE, 'a letter outside Basic Latin is accepted', outsideWitnesses[0][1])
        : state(UNKNOWN, 'no outside letter was witnessed, which is not proof that none is admitted'),

      'FF-02': allRequiredAdmitted
        ? state(ESTABLISHED_NEGATIVE, 'every diacritic the fixture names require is accepted')
        : state(UNKNOWN, 'firing needs a required diacritic admitted at NO position, which probing cannot establish'),

      // The one rule fully decided here, because the catalogue scopes it to three frozen
      // pairs. Decisive, and for that same reason not an independent method.
      'FF-03': asymmetric.length > 0
        ? state(ESTABLISHED_POSITIVE, 'a frozen pair is accepted in one normal form and rejected in the other', asymmetric[0].nfc)
        : state(ESTABLISHED_NEGATIVE, 'all three frozen pairs are treated alike, which is what the catalogue scopes clean to'),

      'FF-04': allPunctuationAdmitted
        ? state(ESTABLISHED_NEGATIVE, 'all four punctuation characters are accepted')
        : state(UNKNOWN, 'firing needs a punctuation character admitted at NO position, which probing cannot establish'),

      // Read from the attribute, not probed - and therefore not independent either.
      'FF-05': minlengthAboveOne
        ? state(ESTABLISHED_POSITIVE, `minlength is ${control.minlength}, which the catalogue makes sufficient on its own`)
        : singleUnitWitness !== null
          ? state(ESTABLISHED_NEGATIVE, 'a one-unit value is accepted, so the minimum accepted length is one', singleUnitWitness)
          : state(UNKNOWN, 'no one-unit value was witnessed, which is not proof that none is accepted'),
    },
    witness: {
      basicLatinAccepted: basicLatinWitness,
      outsideBasicLatinAdmitted: outsideWitnesses.map(([ch]) => ch),
      requiredDiacriticsAdmitted: requiredAdmitted,
      requiredDiacriticsNotWitnessed: requiredDiacritics.filter((ch) => !requiredAdmitted.includes(ch)),
      punctuationAdmitted: punctuationAdmitted.map((p) => `${p.name} (${p.codePoint})`),
      punctuationNotWitnessed: PUNCTUATED_NAMES.filter((p) => !punctuationAdmitted.includes(p)).map(
        (p) => `${p.name} (${p.codePoint})`
      ),
      singleUnitAccepted: singleUnitWitness,
      normalisationAsymmetries: asymmetric.map((p) => p.nfc),
    },
  };
}

/** The three states per rule, for comparison. There is deliberately no binary form. */
export function witnessStates(control) {
  const r = behaviouralWitness(control);
  if (r.undecidable) return r;
  return {
    undecidable: false,
    states: Object.fromEntries(Object.entries(r.evidence).map(([k, v]) => [k, v.state])),
    why: Object.fromEntries(Object.entries(r.evidence).map(([k, v]) => [k, v.why])),
    witness: r.witness,
  };
}
