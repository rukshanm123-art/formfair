import { describe, expect, it } from 'vitest';
import { analysePattern } from '../src/parse/pattern.js';
import { utf16Bounds } from '../src/parse/length.js';

function bounds(pattern: string) {
  const analysis = analysePattern(pattern);
  if (analysis.kind !== 'decidable') throw new Error(`expected decidable: ${pattern}`);
  return utf16Bounds(analysis.atoms);
}

describe('UTF-16 length bounds', () => {
  it('counts a concatenation of single characters', () => {
    expect(bounds('[A-Za-z][A-Za-z]')).toEqual({ kind: 'bounds', min: 2, max: 2 });
  });

  it('reads a bounded repetition', () => {
    expect(bounds('[A-Za-z]{2,40}')).toEqual({ kind: 'bounds', min: 2, max: 40 });
  });

  it('treats an unbounded quantifier as infinite above', () => {
    expect(bounds('[A-Za-z]+')).toEqual({ kind: 'bounds', min: 1, max: Infinity });
  });

  it('refuses to compute when an atom admits supplementary-plane characters', () => {
    const result = bounds('[\\u{10000}-\\u{10FFF}]{2}');
    expect(result.kind).toBe('unresolved');
  });

  it('refuses to compute across a property escape', () => {
    const result = bounds('\\p{L}{2,40}');
    expect(result.kind).toBe('unresolved');
  });
});

describe('pattern decidability', () => {
  it.each([
    ['[A-Za-z]+', 'enumerated class'],
    ['\\p{L}+', 'property escape'],
    ['[A-Za-z]{1,40}', 'bounded repetition'],
    ['ab[cd]?', 'literals with an optional class'],
  ])('accepts %s (%s)', (pattern) => {
    expect(analysePattern(pattern).kind).toBe('decidable');
  });

  it.each([
    ['a|b', 'alternation'],
    ['(?=x)a', 'lookaround'],
    ['(ab)+', 'capturing group'],
    ['(?:ab)+', 'group'],
    ['[\\p{L}--[aeiou]]', 'v-flag set operation'],
  ])('declines %s (%s)', (pattern) => {
    expect(analysePattern(pattern).kind).toBe('undecidable');
  });

  it('strips redundant anchors, which authors commonly write', () => {
    expect(analysePattern('^[A-Za-z]+$')).toEqual(analysePattern('[A-Za-z]+'));
  });
});
