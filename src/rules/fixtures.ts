/**
 * Fixture universe for the cultural rules.
 *
 * Characters are drawn from the CLDR exemplar sets for the declared locale list
 * below, supplemented by an explicit macron set for te reo Māori. The list is
 * versioned with the rule catalogue: detection is claimed only for characters in it.
 */

export const LOCALES = ['mi', 'sm', 'to', 'en', 'fr', 'de', 'es', 'pl', 'cs', 'tr', 'vi'] as const;

export const MACRONS = ['ā', 'ē', 'ī', 'ō', 'ū', 'Ā', 'Ē', 'Ī', 'Ō', 'Ū'] as const;

/** Precomposed letters outside Basic Latin, one per declared locale where applicable. */
export const DIACRITIC_NAMES: readonly { name: string; locale: string }[] = [
  { name: 'Tāwhiao', locale: 'mi' },
  { name: 'Ngātā', locale: 'mi' },
  { name: 'Faʻasamoa', locale: 'sm' },
  { name: 'Émile', locale: 'fr' },
  { name: 'Müller', locale: 'de' },
  { name: 'Núñez', locale: 'es' },
  { name: 'Łukasz', locale: 'pl' },
  { name: 'Dvořák', locale: 'cs' },
  { name: 'Gültekin', locale: 'tr' },
  { name: 'Nguyễn', locale: 'vi' },
];

/** Names whose validity depends on punctuation the ASCII letter range excludes. */
export const PUNCTUATED_NAMES: readonly { name: string; character: string; codePoint: string }[] = [
  { name: "O'Brien", character: 'apostrophe', codePoint: 'U+0027' },
  { name: 'O’Brien', character: 'right single quotation mark', codePoint: 'U+2019' },
  { name: 'Anne-Marie', character: 'hyphen-minus', codePoint: 'U+002D' },
  { name: 'van der Berg', character: 'space', codePoint: 'U+0020' },
];

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
