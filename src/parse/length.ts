import type { Atom } from './pattern.js';
import { fullyEnumerable } from './pattern.js';

/**
 * `minlength` and `maxlength` are defined over UTF-16 code units, while quantifiers
 * in a Unicode-aware regular expression count code points. The two coincide only
 * within the Basic Multilingual Plane. Where an atom admits a supplementary-plane
 * character the units cannot be reconciled without approximation, so length is not
 * computed at all and the caller declines.
 */

const BMP_MAX = 0xffff;

export type LengthBounds =
  | { kind: 'bounds'; min: number; max: number }
  | { kind: 'unresolved'; reason: string };

function admitsSupplementary(atom: Atom): boolean {
  if (atom.set.properties.length > 0) return true;
  for (const cp of atom.set.codePoints) if (cp > BMP_MAX) return true;
  for (const [, hi] of atom.set.ranges) if (hi > BMP_MAX) return true;
  return atom.set.negated;
}

export function utf16Bounds(atoms: readonly Atom[]): LengthBounds {
  if (!fullyEnumerable(atoms)) {
    return { kind: 'unresolved', reason: 'atom admits an unenumerable property escape' };
  }
  for (const atom of atoms) {
    if (admitsSupplementary(atom)) {
      return { kind: 'unresolved', reason: 'atom admits supplementary-plane characters' };
    }
  }

  let min = 0;
  let max = 0;
  for (const atom of atoms) {
    min += atom.min;
    max += atom.max;
  }
  return { kind: 'bounds', min, max: Number.isFinite(max) ? max : Infinity };
}
