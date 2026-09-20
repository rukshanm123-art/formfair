/**
 * A BEHAVIOURAL oracle for FF-01..FF-05.
 *
 * FormFair decides these rules STRUCTURALLY: it parses the pattern and enumerates the
 * character sets it admits. This oracle decides them BEHAVIOURALLY: it executes the
 * control's constraints against the frozen fixture names and observes what is accepted.
 * Same question, different method, no shared code - which is what makes disagreement
 * between them informative rather than tautological.
 *
 * It is also closer to the research construct. The claim under study is "this form would
 * reject this person's name", and that is what acceptance testing measures directly;
 * enumerating character sets is the shortcut being validated.
 *
 * HTML `pattern` semantics, per the HTML Standard: the value must match the pattern in
 * full, and the expression is compiled with the `v` flag. A pattern that does not compile
 * under `v` is not evaluated here - the oracle reports `undecidable`, which is its own
 * analogue of FormFair's decline and is reported, never guessed.
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
 * FF-01 and FF-02 are defined over character admission, not over whole names, and the
 * fixture names do not isolate every character: "Emile" carries uppercase U+00C9 but no
 * lowercase U+00E9, so a class admitting only lowercase accents accepts no fixture name
 * and would look Basic-Latin-only if judged on names alone. It is not.
 *
 * So each character is probed in several positions. This inherits exactly the bound the
 * catalogue already states for FF-01: probing can establish that a letter outside Basic
 * Latin IS admitted, but never that none is. Where nothing is found, the conclusion is
 * bounded rather than certain, and `establishedClean` records which it was.
 */
function admitsCharacter(accepts, ch) {
  const probes = [ch, ch + ch, ch.repeat(3), 'A' + ch, ch + 'a', 'Sm' + ch + 'th', 'Ana' + ch];
  return probes.some((p) => accepts(p));
}

/** Letters outside Basic Latin drawn from the declared locales, plus the macron set. */
const OUTSIDE_BASIC_LATIN = [
  ...'\u0101\u0113\u012b\u014d\u016b\u0100\u0112\u012a\u014c\u016a',
  ...'\u00e9\u00e8\u00ea\u00eb\u00c9\u00c8\u00ca\u00cb',
  ...'\u00fc\u00f6\u00e4\u00dc\u00d6\u00c4\u00df',
  ...'\u00fa\u00f1\u00da\u00d1\u00e1\u00ed\u00f3',
  ...'\u0141\u0142\u0159\u0161\u010d\u017e\u011f\u0131\u015f',
  ...'\u1ec5\u00e2\u00e0\u00f4\u02bb',
];

/**
 * Rule labels for one control, derived only from what its constraints accept.
 *
 * Returns positive/negative per rule, or `undecidable` where the pattern will not
 * compile. FF-02 carries the catalogue's suppression: where FF-01 fires, FF-02 adds no
 * information and is not emitted separately.
 */
export function oracleLabels(control) {
  const acc = acceptorFor(control);
  if (!acc.ok) {
    return { undecidable: true, reason: acc.reason };
  }
  const accepts = acc.accepts;

  const admitsAscii = accepts(ASCII_CONTROL);
  const diacriticAccepted = DIACRITIC_NAMES.filter((d) => accepts(d.name));
  const macronAccepted = MACRON_NAMES.filter((n) => accepts(n));

  // Character admission, which is what FF-01 and FF-02 are defined over.
  const outsideAdmitted = OUTSIDE_BASIC_LATIN.filter((ch) => admitsCharacter(accepts, ch));
  const macronCharsAdmitted = [...'\u0101\u0113\u012b\u014d\u016b'].filter((ch) =>
    admitsCharacter(accepts, ch)
  );

  // FF-01: admits Basic Latin letters and NO letter outside that range.
  const ff01 = admitsAscii && outsideAdmitted.length === 0;

  // FF-02: admits letters beyond Basic Latin but no macron. Suppressed by FF-01.
  const ff02 = !ff01 && outsideAdmitted.length > 0 && macronCharsAdmitted.length === 0;

  // FF-03: a canonically equivalent pair treated differently.
  const asymmetric = NORMALISATION_PAIRS.filter((p) => accepts(p.nfc) !== accepts(p.nfd));
  const ff03 = asymmetric.length > 0;

  // FF-04: at least one of the four punctuation fixtures rejected.
  const punctuationRejected = PUNCTUATED_NAMES.filter((p) => !accepts(p.name));
  const ff04 = punctuationRejected.length > 0;

  // FF-05: every single-letter name rejected - which is what a minimum above one means
  // to a person, and what the catalogue cites Ishida (2011) for.
  const ff05 = SHORT_NAMES.every((n) => !accepts(n));

  const label = (b) => (b ? 'positive' : 'negative');
  return {
    undecidable: false,
    rules: {
      'FF-01': label(ff01),
      'FF-02': label(ff02),
      'FF-03': label(ff03),
      'FF-04': label(ff04),
      'FF-05': label(ff05),
    },
    witness: {
      asciiControlAccepted: admitsAscii,
      diacriticNamesAccepted: diacriticAccepted.map((d) => d.name),
      macronNamesAccepted: macronAccepted,
      outsideBasicLatinAdmitted: outsideAdmitted,
      macronCharactersAdmitted: macronCharsAdmitted,
      // False only where no outside letter was found, which probing cannot prove.
      establishedClean: outsideAdmitted.length > 0,
      normalisationAsymmetries: asymmetric.map((p) => p.nfc),
      punctuationNamesRejected: punctuationRejected.map((p) => `${p.name} (${p.codePoint})`),
      shortNamesRejected: SHORT_NAMES.filter((n) => !accepts(n)),
    },
  };
}
