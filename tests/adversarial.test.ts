/**
 * Cases where an earlier version of the catalogue reached the wrong verdict while
 * every other test still passed. Each one is kept because it discriminates between
 * deciding a rule from the parsed character sets and deciding it from whether whole
 * example names happen to match.
 */

import { describe, expect, it } from 'vitest';
import { analyse } from '../src/index.js';
import { compile } from '../src/rules/accepts.js';
import { analysePattern } from '../src/parse/pattern.js';

const control = (attrs: string): string => `<form><input name="firstName" ${attrs}></form>`;
const fired = (attrs: string): string[] => analyse(control(attrs)).findings.map((f) => f.rule);
const declines = (attrs: string, rule: string): string | undefined =>
  analyse(control(attrs)).declined.find((d) => d.rule === rule)?.reason;

describe('a length bound is not evidence about characters', () => {
  it('fires FF-01 on a Basic Latin class too short to admit the fixture names', () => {
    // Every fixture name is longer than three characters, so testing whole names
    // would show them all rejected and read that as a character restriction.
    expect(fired('pattern="[A-Za-z]{1,3}"')).toContain('FF-01');
  });

  it('does not fire FF-02 or FF-04 on a Unicode-aware class with a short bound', () => {
    const rules = fired('pattern="[\\p{L}\\p{M}\\u0027\\u2019 \\x2D]{1,5}"');
    expect(rules).not.toContain('FF-02');
    expect(rules).not.toContain('FF-04');
  });

  it('reports the excluded character rather than the rejected name', () => {
    const f = analyse(control('pattern="[A-Za-z]{1,3}"')).findings.find((x) => x.rule === 'FF-01');
    expect(f?.evidence).toContain('U+0041');
    expect(f?.evidence).not.toContain('Smith');
  });
});

describe('FF-01 is confined to Basic Latin restrictions', () => {
  it('does not fire where a non-Latin script is admitted', () => {
    // Greek is admitted, so the field is not restricted to Basic Latin, whatever it
    // does to the fixture names.
    expect(fired('pattern="[A-Za-z\\u0370-\\u03FF]+"')).not.toContain('FF-01');
  });

  it('still records the diacritic and punctuation exclusions that case does carry', () => {
    const rules = fired('pattern="[A-Za-z\\u0370-\\u03FF]+"');
    expect(rules).toEqual(expect.arrayContaining(['FF-02', 'FF-04']));
  });

  it('does not fire on a class admitting no letter at all', () => {
    expect(fired('pattern="[0-9]+"')).not.toContain('FF-01');
  });
});

describe('quantifiers', () => {
  it('reads a lazy quantifier as the language it matches, not as a further atom', () => {
    // `[A-Za-z]+?` accepts the same strings as `[A-Za-z]+`, so the minimum is one.
    expect(fired('pattern="[A-Za-z]+?"')).not.toContain('FF-05');
    expect(analysePattern('[A-Za-z]+?')).toEqual(analysePattern('[A-Za-z]+'));
  });

  it('declines a repetition whose maximum is below its minimum', () => {
    expect(analysePattern('[A-Za-z]{3,2}').kind).toBe('undecidable');
    for (const rule of ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05']) {
      expect(declines('pattern="[A-Za-z]{3,2}"', rule)).toBeTruthy();
    }
  });
});

describe('patterns are compiled the way a browser compiles them', () => {
  it('does not fall back to looser flags when the v flag rejects a pattern', () => {
    // A literal hyphen at the end of a class is a syntax error under `v`, so this is
    // not a valid HTML pattern. Reading it under `u` would describe an expression no
    // browser runs.
    expect(compile("[\\p{L}\\p{M}' -]+")).toBeNull();
    expect(new RegExp("^(?:[\\p{L}\\p{M}' -]+)$", 'u')).toBeInstanceOf(RegExp);
  });

  it('declines every rule on such a control rather than reporting it clean', () => {
    const result = analyse(control("pattern=\"[\\p{L}\\p{M}' -]+\""));
    expect(result.findings).toHaveLength(0);
    expect(result.declined).toHaveLength(5);
  });

  it('accepts the same class with the hyphen escaped', () => {
    expect(compile('[\\p{L}\\p{M}\\u0027 \\x2D]+')).toBeInstanceOf(RegExp);
    expect(fired('pattern="[\\p{L}\\p{M}\\u0027\\u2019 \\x2D]+"')).toHaveLength(0);
  });
});

describe('FF-03 weighs every declared constraint, not the pattern alone', () => {
  it('fires on a length bound with no pattern at all', () => {
    // Decomposing "Tāwhiao" adds a combining mark, taking it from seven UTF-16 code
    // units to eight, so the maximum separates two canonically equivalent forms.
    const f = analyse(control('maxlength="7"')).findings;
    expect(f.map((x) => x.rule)).toEqual(['FF-03']);
    expect(f[0]?.evidence).toContain('maxlength="7"');
  });

  it('names the constraint responsible', () => {
    const f = analyse(control('pattern="[\\p{L}\\u0027 \\x2D]+"')).findings.find(
      (x) => x.rule === 'FF-03'
    );
    expect(f?.evidence).toContain('pattern=');
  });

  it('stays clean where no constraint separates the two forms', () => {
    expect(fired('type="text"')).toHaveLength(0);
  });
});
