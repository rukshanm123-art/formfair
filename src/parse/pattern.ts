/**
 * Analysis of the `pattern` attribute over a deliberately restricted subset.
 *
 * The attribute compiles as a JavaScript regular expression with the `v` flag and
 * matches the entire value, so a pattern is treated as fully anchored. Expressions
 * outside the supported subset are declined rather than approximated: emitting a
 * finding from a partial reading of a pattern is worse than emitting nothing.
 */

export interface CharSet {
  /** Explicit code points admitted by an enumerated class. */
  readonly codePoints: ReadonlySet<number>;
  /** Ranges admitted by an enumerated class, inclusive. */
  readonly ranges: readonly (readonly [number, number])[];
  /** Unicode property escapes such as \p{L}, which admit sets we do not enumerate. */
  readonly properties: readonly string[];
  readonly negated: boolean;
}

export interface Atom {
  readonly set: CharSet;
  /** The atom's own regex source, without its quantifier, for membership testing. */
  readonly source: string;
  readonly min: number;
  readonly max: number;
}

export type PatternAnalysis =
  | { kind: 'decidable'; atoms: readonly Atom[] }
  | { kind: 'undecidable'; reason: string };

const UNSUPPORTED: readonly (readonly [RegExp, string])[] = [
  [/\|/, 'alternation'],
  [/\(\?[=!<]/, 'lookaround'],
  [/\\[1-9]/, 'backreference'],
  [/\\q\{/, 'v-flag string disjunction'],
  [/--|&&/, 'v-flag set operation'],
  [/\((?![?]:)/, 'capturing group'],
  [/\(\?:/, 'group'],
];

const PREDEFINED: Readonly<Record<string, string>> = {
  d: 'Nd',
  w: 'Word',
  s: 'White_Space',
};

function stripAnchors(pattern: string): string {
  let p = pattern;
  if (p.startsWith('^')) p = p.slice(1);
  if (p.endsWith('$') && !p.endsWith('\\$')) p = p.slice(0, -1);
  return p;
}

function readEscape(src: string, i: number): { set: CharSet; next: number } | null {
  const c = src[i + 1];
  if (c === undefined) return null;

  if (c === 'p' || c === 'P') {
    const close = src.indexOf('}', i + 2);
    if (src[i + 2] !== '{' || close === -1) return null;
    return {
      set: {
        codePoints: new Set(),
        ranges: [],
        properties: [src.slice(i + 3, close)],
        negated: c === 'P',
      },
      next: close + 1,
    };
  }

  if (c === 'u' || c === 'x') {
    if (c === 'u' && src[i + 2] === '{') {
      const close = src.indexOf('}', i + 3);
      if (close === -1) return null;
      const cp = Number.parseInt(src.slice(i + 3, close), 16);
      if (!Number.isFinite(cp)) return null;
      return {
        set: { codePoints: new Set([cp]), ranges: [], properties: [], negated: false },
        next: close + 1,
      };
    }
    const width = c === 'u' ? 4 : 2;
    const hex = src.slice(i + 2, i + 2 + width);
    if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) return null;
    return {
      set: {
        codePoints: new Set([Number.parseInt(hex, 16)]),
        ranges: [],
        properties: [],
        negated: false,
      },
      next: i + 2 + width,
    };
  }

  const predefined = PREDEFINED[c.toLowerCase()];
  if (predefined !== undefined) {
    return {
      set: {
        codePoints: new Set(),
        ranges: [],
        properties: [predefined],
        negated: c === c.toUpperCase(),
      },
      next: i + 2,
    };
  }

  return {
    set: { codePoints: new Set([c.codePointAt(0)!]), ranges: [], properties: [], negated: false },
    next: i + 2,
  };
}

function readClass(src: string, i: number): { set: CharSet; next: number } | null {
  let j = i + 1;
  const negated = src[j] === '^';
  if (negated) j++;

  const codePoints = new Set<number>();
  const ranges: [number, number][] = [];
  const properties: string[] = [];

  while (j < src.length && src[j] !== ']') {
    let lo: number;

    if (src[j] === '\\') {
      const esc = readEscape(src, j);
      if (!esc) return null;
      if (esc.set.properties.length > 0) {
        properties.push(...esc.set.properties);
        j = esc.next;
        continue;
      }
      lo = [...esc.set.codePoints][0]!;
      j = esc.next;
    } else {
      lo = src.codePointAt(j)!;
      j += String.fromCodePoint(lo).length;
    }

    if (src[j] === '-' && src[j + 1] !== undefined && src[j + 1] !== ']') {
      let hi: number;
      if (src[j + 1] === '\\') {
        const esc = readEscape(src, j + 1);
        if (!esc || esc.set.properties.length > 0) return null;
        hi = [...esc.set.codePoints][0]!;
        j = esc.next;
      } else {
        hi = src.codePointAt(j + 1)!;
        j += 1 + String.fromCodePoint(hi).length;
      }
      ranges.push([lo, hi]);
    } else {
      codePoints.add(lo);
    }
  }

  if (src[j] !== ']') return null;
  return { set: { codePoints, ranges, properties, negated }, next: j + 1 };
}

type Quantifier = { min: number; max: number; next: number } | { invalid: string };

/**
 * A lazy or possessive suffix changes matching strategy, not the language matched,
 * so it is consumed rather than read as a further atom. `[A-Za-z]+?` accepts the
 * same strings as `[A-Za-z]+`.
 */
function readQuantifier(src: string, i: number): Quantifier {
  const consumeLazy = (n: number): number => (src[n] === '?' || src[n] === '+' ? n + 1 : n);

  const c = src[i];
  if (c === '*') return { min: 0, max: Infinity, next: consumeLazy(i + 1) };
  if (c === '+') return { min: 1, max: Infinity, next: consumeLazy(i + 1) };
  if (c === '?') return { min: 0, max: 1, next: consumeLazy(i + 1) };
  if (c === '{') {
    const close = src.indexOf('}', i);
    if (close !== -1) {
      const body = src.slice(i + 1, close);
      const m = /^(\d+)(,(\d*)?)?$/.exec(body);
      if (m) {
        const min = Number(m[1]);
        const max = m[2] === undefined ? min : m[3] === '' || m[3] === undefined ? Infinity : Number(m[3]);
        if (max < min) return { invalid: 'quantifier maximum below its minimum' };
        return { min, max, next: consumeLazy(close + 1) };
      }
    }
  }
  return { min: 1, max: 1, next: i };
}

export function analysePattern(pattern: string): PatternAnalysis {
  for (const [probe, label] of UNSUPPORTED) {
    if (probe.test(pattern)) return { kind: 'undecidable', reason: label };
  }

  const src = stripAnchors(pattern);
  const atoms: Atom[] = [];
  let i = 0;

  while (i < src.length) {
    let set: CharSet;
    const atomStart = i;

    if (src[i] === '[') {
      const cls = readClass(src, i);
      if (!cls) return { kind: 'undecidable', reason: 'malformed character class' };
      set = cls.set;
      i = cls.next;
    } else if (src[i] === '\\') {
      const esc = readEscape(src, i);
      if (!esc) return { kind: 'undecidable', reason: 'unsupported escape' };
      set = esc.set;
      i = esc.next;
    } else if (src[i] === '.') {
      set = { codePoints: new Set(), ranges: [], properties: ['Any'], negated: false };
      i += 1;
    } else {
      const cp = src.codePointAt(i)!;
      set = { codePoints: new Set([cp]), ranges: [], properties: [], negated: false };
      i += String.fromCodePoint(cp).length;
    }

    const source = src.slice(atomStart, i);
    const q = readQuantifier(src, i);
    if ('invalid' in q) return { kind: 'undecidable', reason: q.invalid };
    i = q.next;
    atoms.push({ set, source, min: q.min, max: q.max });
  }

  if (atoms.length === 0) return { kind: 'undecidable', reason: 'empty pattern' };
  return { kind: 'decidable', atoms };
}

export function admits(set: CharSet, codePoint: number): boolean | null {
  if (set.properties.length > 0) return null;

  let inSet = set.codePoints.has(codePoint);
  if (!inSet) {
    for (const [lo, hi] of set.ranges) {
      if (codePoint >= lo && codePoint <= hi) {
        inSet = true;
        break;
      }
    }
  }
  return set.negated ? !inSet : inSet;
}

/** True when every atom is enumerable, i.e. no atom rests on a Unicode property escape. */
export function fullyEnumerable(atoms: readonly Atom[]): boolean {
  return atoms.every((a) => a.set.properties.length === 0);
}

/**
 * Whether an atom admits a single character, decided by the regular-expression
 * engine itself rather than by re-implementing class semantics. Returns null when
 * the atom cannot be compiled under `v`, which the caller treats as undecidable.
 *
 * Length never enters this question: exactly one character is tested, so a
 * quantifier on the atom cannot confound the answer.
 */
export function atomAdmits(atom: Atom, ch: string): boolean | null {
  try {
    return new RegExp(`^(?:${atom.source})$`, 'v').test(ch);
  } catch {
    return null;
  }
}

/** Whether any atom in the pattern admits the character. Null if any atom is undecidable. */
export function patternAdmits(atoms: readonly Atom[], ch: string): boolean | null {
  let unknown = false;
  for (const atom of atoms) {
    const r = atomAdmits(atom, ch);
    if (r === null) unknown = true;
    else if (r) return true;
  }
  return unknown ? null : false;
}

const BASIC_LATIN_LETTERS: readonly (readonly [number, number])[] = [
  [0x41, 0x5a],
  [0x61, 0x7a],
];

function withinBasicLatinLetters(cp: number): boolean {
  return BASIC_LATIN_LETTERS.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/** Letters standing in for the writing systems the catalogue claims coverage of. */
const OUTSIDE_PROBES = ['\u0101', '\u00e9', '\u00fc', '\u0142', '\u1ec5', '\u02bb'] as const;

/** Enumeration budget. A class wider than this is declined rather than walked. */
const MAX_ENUMERATION = 20_000;

const isLetter = (cp: number): boolean => /\p{L}/u.test(String.fromCodePoint(cp));

export interface LetterProfile {
  /** The pattern admits at least one letter in U+0041-U+005A or U+0061-U+007A. */
  readonly basicLatin: boolean;
  /** The pattern admits at least one letter outside that range. */
  readonly outsideBasicLatin: boolean;
}

/**
 * Which letters a pattern admits, derived from the parsed character sets rather than
 * from whether whole example names match. Length cannot confound the answer, because
 * no name is ever tested: each character is considered on its own.
 *
 * Enumerable sets are walked exactly. A set resting on a property escape is put to
 * the regular-expression engine one character at a time, which can establish that a
 * letter outside Basic Latin is admitted but never that none is; where that cannot be
 * established the result is null and the caller declines.
 */
export function letterProfile(atoms: readonly Atom[]): LetterProfile | null {
  let basicLatin = false;
  let outsideBasicLatin = false;
  let unknown = false;
  let budget = MAX_ENUMERATION;

  for (const atom of atoms) {
    const { set } = atom;

    if (set.negated || set.properties.length > 0) {
      if (OUTSIDE_PROBES.some((ch) => atomAdmits(atom, ch) === true)) outsideBasicLatin = true;
      else unknown = true;
      if (atomAdmits(atom, 'a') === true) basicLatin = true;
      continue;
    }

    const visit = (cp: number): void => {
      if (withinBasicLatinLetters(cp)) basicLatin = true;
      else if (isLetter(cp)) outsideBasicLatin = true;
    };

    for (const cp of set.codePoints) {
      if (budget-- <= 0) return null;
      visit(cp);
    }
    for (const [lo, hi] of set.ranges) {
      if (hi - lo + 1 > budget) return null;
      budget -= hi - lo + 1;
      for (let cp = lo; cp <= hi; cp++) visit(cp);
    }
  }

  // An admitted outside letter is decisive on its own: the remaining uncertainty
  // could only add further admitted characters, never withdraw this one.
  if (outsideBasicLatin) return { basicLatin, outsideBasicLatin: true };
  return unknown ? null : { basicLatin, outsideBasicLatin: false };
}
