import { describe, expect, it } from 'vitest';
import { analyse } from '../src/index.js';
import type { RuleId } from '../src/types.js';

function input(attrs: string): string {
  return `<form><label for="n">Full name</label><input id="n" name="name" ${attrs}></form>`;
}

function rulesFired(html: string): RuleId[] {
  return analyse(html).findings.map((f) => f.rule);
}

function declinedFor(html: string, rule: RuleId): boolean {
  return analyse(html).declined.some((d) => d.rule === rule);
}

describe('FF-01 Basic Latin only', () => {
  it('fires on an ASCII-letter-only class', () => {
    expect(rulesFired(input('pattern="[A-Za-z]+"'))).toContain('FF-01');
  });

  it('fires whether or not the author wrote redundant anchors', () => {
    expect(rulesFired(input('pattern="^[A-Za-z]+$"'))).toContain('FF-01');
  });

  it('does not fire on a Unicode-aware class', () => {
    expect(rulesFired(input('pattern="[\\p{L}\\u0027 -]+"'))).not.toContain('FF-01');
  });

  it('does not fire when no pattern is declared', () => {
    expect(rulesFired(input('type="text"'))).not.toContain('FF-01');
  });
});

describe('FF-02 rejects diacritics', () => {
  it('fires when a class admits some non-ASCII letters but excludes precomposed diacritics', () => {
    expect(rulesFired(input('pattern="[A-Za-zÀ-ÿ]+"'))).toContain('FF-02');
  });

  it('is subsumed by FF-01 on a Basic Latin class', () => {
    const fired = rulesFired(input('pattern="[A-Za-z]+"'));
    expect(fired).toContain('FF-01');
    expect(fired).not.toContain('FF-02');
  });

  it('does not fire when diacritics are admitted', () => {
    expect(rulesFired(input('pattern="[\\p{L}]+"'))).not.toContain('FF-02');
  });
});

describe('FF-04 rejects name punctuation', () => {
  it('fires when apostrophes and hyphens are excluded', () => {
    expect(rulesFired(input('pattern="[\\p{L}]+"'))).toContain('FF-04');
  });

  it('does not fire when punctuation is admitted', () => {
    expect(rulesFired(input('pattern="[\\p{L}\\u0027\\u2019 -]+"'))).not.toContain('FF-04');
  });

  it('is independent of FF-02 — a class may reject diacritics yet admit punctuation', () => {
    const fired = rulesFired(input('pattern="[A-Za-zÀ-ÿ\\u0027\\u2019 -]+"'));
    expect(fired).toContain('FF-02');
    expect(fired).not.toContain('FF-04');
  });
});

describe('FF-05 minimum length', () => {
  it('fires on minlength above one', () => {
    expect(rulesFired(input('minlength="2"'))).toContain('FF-05');
  });

  it('does not fire on minlength of one', () => {
    expect(rulesFired(input('minlength="1"'))).not.toContain('FF-05');
  });

  it('fires on a pattern whose minimum length exceeds one without a bounded quantifier', () => {
    expect(rulesFired(input('pattern="[A-Za-z][A-Za-z]"'))).toContain('FF-05');
  });

  it('fires on a bounded repetition with a lower bound above one', () => {
    expect(rulesFired(input('pattern="[A-Za-z]{2,40}"'))).toContain('FF-05');
  });

  it('does not fire when a single character is accepted', () => {
    expect(rulesFired(input('pattern="[A-Za-z]+"'))).not.toContain('FF-05');
  });

  it('declines when the class admits supplementary-plane characters', () => {
    expect(declinedFor(input('pattern="[\\p{L}]{2,40}"'), 'FF-05')).toBe(true);
  });
});

describe('decidability gate', () => {
  it('declines on alternation rather than guessing', () => {
    expect(declinedFor(input('pattern="[A-Za-z]+|[0-9]+"'), 'FF-01')).toBe(true);
  });

  it('declines on lookahead', () => {
    expect(declinedFor(input('pattern="(?=.{2,})[A-Za-z]+"'), 'FF-01')).toBe(true);
  });

  it('emits no finding for a declined control', () => {
    expect(rulesFired(input('pattern="[A-Za-z]+|[0-9]+"'))).toHaveLength(0);
  });
});
