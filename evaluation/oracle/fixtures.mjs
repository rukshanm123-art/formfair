/**
 * The oracle's OWN declaration of the frozen fixture set.
 *
 * Deliberately not imported from the analyser. The oracle exists to be an independent
 * check on FormFair, and an oracle that imports FormFair's data shares state with the
 * thing it checks. These are declared here from catalogue-v1.0.0 and a test asserts they
 * are identical to src/rules/fixtures.ts, so divergence is caught rather than silent.
 */

/** Precomposed letters outside Basic Latin, one per declared locale. */
export const DIACRITIC_NAMES = [
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

/** The macron names specifically. FF-02 turns on whether these are admitted. */
export const MACRON_NAMES = ['Tāwhiao', 'Ngātā'];

/** Names whose validity depends on punctuation an ASCII letter range excludes. */
const PUNCTUATION_SOURCES = [
  { name: "O'Brien", codePoint: 'U+0027' },
  { name: 'O’Brien', codePoint: 'U+2019' },
  { name: 'Anne-Marie', codePoint: 'U+002D' },
  { name: 'van der Berg', codePoint: 'U+0020' },
];

/** The character each label names, derived from the label so the two cannot disagree. */
export const PUNCTUATED_NAMES = PUNCTUATION_SOURCES.map((p) => ({
  ...p,
  char: String.fromCodePoint(Number.parseInt(p.codePoint.slice(2), 16)),
}));

/** Single-letter given names, which a minimum length above one excludes. */
export const SHORT_NAMES = ['O', 'X'];

/** An all-ASCII control that any usable name field must accept. */
export const ASCII_CONTROL = 'Smith';

/** Canonically equivalent pairs, derived so the two forms cannot drift. */
export const NORMALISATION_PAIRS = ['Tāwhiao', 'Émile', 'Müller']
  .map((n) => ({ nfc: n.normalize('NFC'), nfd: n.normalize('NFD') }))
  .filter((p) => p.nfc !== p.nfd);
