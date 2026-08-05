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

function readQuantifier(src: string, i: number): { min: number; max: number; next: number } {
  const c = src[i];
  if (c === '*') return { min: 0, max: Infinity, next: i + 1 };
  if (c === '+') return { min: 1, max: Infinity, next: i + 1 };
  if (c === '?') return { min: 0, max: 1, next: i + 1 };
  if (c === '{') {
    const close = src.indexOf('}', i);
    if (close !== -1) {
      const body = src.slice(i + 1, close);
      const m = /^(\d+)(,(\d*)?)?$/.exec(body);
      if (m) {
        const min = Number(m[1]);
        const max = m[2] === undefined ? min : m[3] === '' || m[3] === undefined ? Infinity : Number(m[3]);
        return { min, max, next: close + 1 };
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

    const q = readQuantifier(src, i);
    i = q.next;
    atoms.push({ set, min: q.min, max: q.max });
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
