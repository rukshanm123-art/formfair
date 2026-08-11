/**
 * Fixture universe for the cultural rules.
 *
 * Characters are drawn from the CLDR exemplar sets for the declared locale list
 * below, supplemented by an explicit macron set for te reo Māori. The list is
 * versioned with the rule catalogue: detection is claimed only for characters in it.
 */

export const LOCALES = ['mi', 'sm', 'to', 'en', 'fr', 'de', 'es', 'pl', 'cs', 'tr', 'vi'] as const;

export const MACRONS = ['ā', 'ē', 'ī', 'ō', 'ū', 'Ā', 'Ē', 'Ī', 'Ō', 'Ū'] as const;

/**
 * The character a code-point label names, derived from the label itself so that the
 * two cannot disagree.
 */
const fromLabel = (label: string): string =>
  String.fromCodePoint(Number.parseInt(label.slice(2), 16));

/** The letters in a name that fall outside U+0041-U+005A and U+0061-U+007A. */
const outsideBasicLatinLetters = (name: string): readonly string[] => [
  ...new Set([...name].filter((ch) => /\p{L}/u.test(ch) && !/[A-Za-z]/.test(ch))),
];

interface DiacriticName {
  readonly name: string;
  readonly locale: string;
  /** The characters that decide whether the name is admitted, derived from the name. */
  readonly characters: readonly string[];
}

const DIACRITIC_SOURCES: readonly { name: string; locale: string }[] = [
  { name: 'T\u0101whiao', locale: 'mi' },
  { name: 'Ng\u0101t\u0101', locale: 'mi' },
  { name: 'Fa\u02bbasamoa', locale: 'sm' },
  { name: '\u00c9mile', locale: 'fr' },
  { name: 'M\u00fcller', locale: 'de' },
  { name: 'N\u00fa\u00f1ez', locale: 'es' },
  { name: '\u0141ukasz', locale: 'pl' },
  { name: 'Dvo\u0159\u00e1k', locale: 'cs' },
  { name: 'G\u00fcltekin', locale: 'tr' },
  { name: 'Nguy\u1ec5n', locale: 'vi' },
];

/** Precomposed letters outside Basic Latin, one per declared locale where applicable. */
export const DIACRITIC_NAMES: readonly DiacriticName[] = DIACRITIC_SOURCES.map((d) => ({
  ...d,
  characters: outsideBasicLatinLetters(d.name),
}));

interface PunctuatedName {
  readonly name: string;
  readonly character: string;
  readonly codePoint: string;
  /** The character itself, derived from its code-point label. */
  readonly char: string;
}

const PUNCTUATION_SOURCES: readonly { name: string; character: string; codePoint: string }[] = [
  { name: "O'Brien", character: 'apostrophe', codePoint: 'U+0027' },
  { name: 'O\u2019Brien', character: 'right single quotation mark', codePoint: 'U+2019' },
  { name: 'Anne-Marie', character: 'hyphen-minus', codePoint: 'U+002D' },
  { name: 'van der Berg', character: 'space', codePoint: 'U+0020' },
];

/** Names whose validity depends on punctuation the ASCII letter range excludes. */
export const PUNCTUATED_NAMES: readonly PunctuatedName[] = PUNCTUATION_SOURCES.map((p) => ({
  ...p,
  char: fromLabel(p.codePoint),
}));

/** Single-letter given names, which a minimum length above one excludes. */
export const SHORT_NAMES = ['O', 'X'] as const;

export const ASCII_CONTROL = 'Smith';

const PAIR_SOURCES = ['T\u0101whiao', '\u00c9mile', 'M\u00fcller'] as const;

/**
 * Canonically equivalent pairs, derived rather than written literally so the two
 * forms cannot drift if this file is re-encoded. NFC is precomposed, NFD decomposed;
 * they render identically but are not byte-identical.
 */
export const NORMALISATION_PAIRS: readonly { nfc: string; nfd: string }[] = PAIR_SOURCES
  .map((name) => ({ nfc: name.normalize('NFC'), nfd: name.normalize('NFD') }))
  .filter((pair) => pair.nfc !== pair.nfd);
