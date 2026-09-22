/**
 * The behavioural witness generator.
 *
 * These tests exist mostly to pin what it CANNOT do. Six defects were found in it by
 * review rather than by the corpus, and every one was the same mistake: converting "no
 * witness found" into a label. The three-state model exists so that mistake is not
 * expressible, and the counterexamples are kept here so it cannot return.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  behaviouralWitness,
  witnessStates,
  acceptorFor,
  ESTABLISHED_POSITIVE,
  ESTABLISHED_NEGATIVE,
  UNKNOWN,
} from '../oracle/oracle.mjs';
import {
  DIACRITIC_NAMES,
  PUNCTUATED_NAMES,
  SHORT_NAMES,
  ASCII_CONTROL,
  NORMALISATION_PAIRS,
  MACRON_NAMES,
} from '../oracle/fixtures.mjs';
import { instrumentDirFromEnv } from '../src/instrument-ref.mjs';

const states = (pattern, extra = {}) => witnessStates({ pattern, ...extra }).states;

describe('the fixture set it declares matches the one it does not import', () => {
  test('every declared fixture appears in the analyser fixtures', (t) => {
    const dir = instrumentDirFromEnv();
    const at = dir && join(dir, 'src', 'rules', 'fixtures.ts');
    if (!at || !existsSync(at)) {
      t.skip('FORMFAIR_INSTRUMENT_DIR not set; run scripts/setup-instrument.sh');
      return;
    }
    const source = readFileSync(at, 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
    for (const name of [
      ...DIACRITIC_NAMES.map((d) => d.name),
      ...PUNCTUATED_NAMES.map((p) => p.name),
      ...SHORT_NAMES,
      ASCII_CONTROL,
      ...MACRON_NAMES,
    ]) {
      assert.ok(source.includes(name), `the analyser fixtures do not contain ${JSON.stringify(name)}`);
    }
    assert.equal(NORMALISATION_PAIRS.length, 3);
    for (const p of NORMALISATION_PAIRS) assert.equal(p.nfc.normalize('NFD'), p.nfd);
  });
});

describe('uncertainty is never converted into a label', () => {
  test('a positive FF-01 is not expressible, because it needs an absence', () => {
    // The commonest pattern in the corpus. FormFair reports FF-01 by enumerating the
    // parsed class; execution cannot, because it would have to exhaust the alphabet.
    // `unknown` is the correct answer, not `positive`.
    for (const p of ['[A-Za-z]+', '[A-Za-z]{2,40}', '[A-Za-z]{1,3}']) {
      assert.equal(states(p)['FF-01'], UNKNOWN, `${p} must not claim a positive FF-01`);
    }
  });

  test('a Danish class returns unknown rather than a wrong positive', () => {
    // Enlarging the probe sample can buy a few more established negatives and can never
    // make absence provable, so an unrecognised orthography must degrade to unknown - not
    // to a confident positive, which is what the previous model produced.
    assert.notEqual(states('[A-Za-zđħ]+')['FF-01'], ESTABLISHED_POSITIVE);
    assert.equal(states('[A-Za-zđħ]+')['FF-01'], UNKNOWN);
  });

  test('FF-02 and FF-04 can only ever be established negative', () => {
    // Both fire on a character being admitted at NO position.
    for (const p of ['[A-Za-z]+', '[A-Za-zÀ-ÿ]+', '[0-9]+']) {
      assert.notEqual(states(p)['FF-02'], ESTABLISHED_POSITIVE);
      assert.notEqual(states(p)['FF-04'], ESTABLISHED_POSITIVE);
    }
    const permissive = states("[\\p{L}\\p{M}'’ \\-]+");
    assert.equal(permissive['FF-02'], ESTABLISHED_NEGATIVE, 'every required diacritic is accepted');
    assert.equal(permissive['FF-04'], ESTABLISHED_NEGATIVE, 'all four punctuation characters are accepted');
  });

  test('there is no binary accessor to fall back on', () => {
    const r = witnessStates({ pattern: '[A-Za-z]+' });
    assert.equal(r.rules, undefined, 'a binary `rules` map must not exist');
    assert.equal(r.bounded, undefined, 'nor a boolean that invites ignoring it');
    assert.ok(Object.values(r.states).every((s) => [ESTABLISHED_POSITIVE, ESTABLISHED_NEGATIVE, UNKNOWN].includes(s)));
  });
});

describe('six counterexamples that stop this being called an oracle', () => {
  test('FF-01 is not decided by whether a five-letter name fits', () => {
    assert.equal(states('[A-Za-z]{1,3}')['FF-01'], UNKNOWN);
  });

  test('FF-02 is not decided by macrons alone', () => {
    // Admits the macron, excludes the French, German, Spanish, Polish, Czech, Turkish and
    // Vietnamese fixtures. Not every required diacritic is accepted, so no negative can be
    // established - and the positive direction is not establishable at all.
    assert.equal(states('[A-Za-zā]+')['FF-02'], UNKNOWN);
    const w = behaviouralWitness({ pattern: '[A-Za-zā]+' }).witness;
    assert.ok(w.requiredDiacriticsAdmitted.includes('ā'));
    assert.ok(w.requiredDiacriticsNotWitnessed.length > 0);
  });

  test('FF-04 is not decided by whether a twelve-character name fits', () => {
    // "van der Berg" is twelve units. Probed per character, all four are accepted.
    assert.equal(states("[A-Za-z'’ \\-]{1,3}")['FF-04'], ESTABLISHED_NEGATIVE);
  });

  test('FF-05 is not decided by uppercase short names alone', () => {
    assert.equal(states('[a-z]{1}')['FF-05'], ESTABLISHED_NEGATIVE);
    assert.ok(behaviouralWitness({ pattern: '[a-z]{1}' }).witness.singleUnitAccepted);
  });

  test('a digits-only class cannot fire FF-01, and all 52 letters are tried', () => {
    // FF-01 needs at least one Basic Latin letter admitted. That set is finite and small,
    // so absence there IS establishable - unlike absence outside it.
    assert.equal(states('[0-9]{1,5}')['FF-01'], ESTABLISHED_NEGATIVE);
    assert.equal(states('[0-9]{1,5}')['FF-05'], ESTABLISHED_NEGATIVE, '"1" is accepted');
    // And a single letter outside the old hand-picked sample is now found.
    assert.equal(states('[d]')['FF-01'], UNKNOWN, 'd IS admitted, so the rule is not ruled out');
    assert.equal(states('[d]')['FF-05'], ESTABLISHED_NEGATIVE, '"d" is a one-unit accepted value');
  });

  test('it answers where FormFair declines, so it is not a drop-in for the tool', () => {
    // src/parse/pattern.ts declines alternation, groups and lookaround; a regex engine
    // executes all three. The two cannot be compared decision for decision.
    for (const pattern of ['(?:[A-Za-z]+ )?[A-Za-z]+', '^[A-Za-z]+$|^$', '[A-Za-z]+(?=x)']) {
      assert.equal(witnessStates({ pattern }).undecidable, false);
    }
  });
});

describe('HTML pattern semantics', () => {
  test('a present but empty pattern rejects every non-empty value', () => {
    // Per the HTML Standard the attribute is compiled when present, so `pattern=""`
    // becomes /^(?:)$/v. Only an ABSENT attribute means no pattern is applied. The
    // previous version treated the empty string as absent and accepted everything.
    const empty = acceptorFor({ pattern: '' });
    assert.equal(empty.ok, true);
    assert.equal(empty.accepts('A'), false);
    assert.equal(empty.accepts('7'), false);
    assert.equal(empty.accepts(''), true);

    const absent = acceptorFor({});
    assert.equal(absent.accepts('A'), true, 'an absent attribute applies no pattern');
  });

  test('an uncompilable pattern is ignored by the browser, not treated as rejecting all', () => {
    const r = witnessStates({ pattern: "[A-Za-z' -]+" });
    assert.equal(r.undecidable, true);
    assert.match(r.reason, /v flag/);
    assert.equal(r.states, undefined);
    assert.equal(r.patternIgnoredByBrowser, true);
    assert.equal(r.effectiveConstraint, 'length attributes only');
  });

  test('length limits apply alongside the pattern, as one set of constraints', () => {
    const acc = acceptorFor({ pattern: '[A-Za-z]+', maxlength: 4 });
    assert.equal(acc.accepts('Anne'), true);
    assert.equal(acc.accepts('Annette'), false);
  });
});

describe('where it is decisive it is not independent', () => {
  test('FF-03 is fully decided, by the same arithmetic FormFair uses', () => {
    // The catalogue scopes FF-03 to three frozen pairs, and three can be exhausted - so
    // this is the one rule with no `unknown`. Deciding it means comparing NFC and NFD
    // acceptance, which is what the analyser does, so it is no second opinion.
    assert.equal(states('[A-Za-zÀ-ÿ]+')['FF-03'], ESTABLISHED_POSITIVE);
    assert.equal(states('[A-Za-z]+')['FF-03'], ESTABLISHED_NEGATIVE);
    assert.equal(states("[\\p{L}\\p{M}'’ \\-]+")['FF-03'], ESTABLISHED_NEGATIVE);
  });

  test('FF-05 via minlength is read from the attribute, not probed', () => {
    assert.equal(states('[A-Za-z]+', { minlength: 2 })['FF-05'], ESTABLISHED_POSITIVE);
    // Without the attribute, the pattern's own minimum is beyond what execution can
    // establish: no one-unit value is accepted, and that is not proof that none is.
    assert.equal(states('[A-Za-z]{2,40}')['FF-05'], UNKNOWN);
  });
});
