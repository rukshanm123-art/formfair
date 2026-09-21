/**
 * The behavioural witness generator, and the guarantees that keep it honest.
 *
 * The oracle declares its own copy of the fixture set rather than importing the
 * analyser's, because an oracle that shares data with the thing it checks is not
 * independent. The cost of that choice is drift, so it is tested: the two declarations
 * must name the same fixtures, and divergence fails here rather than silently changing
 * what the evaluation means.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { behaviouralWitness, suggestedLabels, acceptorFor } from '../oracle/oracle.mjs';
import {
  DIACRITIC_NAMES,
  PUNCTUATED_NAMES,
  SHORT_NAMES,
  ASCII_CONTROL,
  NORMALISATION_PAIRS,
  MACRON_NAMES,
} from '../oracle/fixtures.mjs';
import { instrumentDirFromEnv } from '../src/instrument-ref.mjs';

describe('the oracle agrees with the frozen fixture set it does not import', () => {
  test('every fixture name it declares appears in the analyser fixtures', (t) => {
    const dir = instrumentDirFromEnv();
    const at = dir && join(dir, 'src', 'rules', 'fixtures.ts');
    if (!at || !existsSync(at)) {
      t.skip('FORMFAIR_INSTRUMENT_DIR not set; run scripts/setup-instrument.sh');
      return;
    }
    // The analyser writes its fixtures as \uXXXX escapes; decode before comparing so the
    // test is about the characters, not about how either file spells them.
    const source = readFileSync(at, 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );

    const declared = [
      ...DIACRITIC_NAMES.map((d) => d.name),
      ...PUNCTUATED_NAMES.map((p) => p.name),
      ...SHORT_NAMES,
      ASCII_CONTROL,
      ...MACRON_NAMES,
    ];
    for (const name of declared) {
      assert.ok(source.includes(name), `the analyser fixtures do not contain ${JSON.stringify(name)}`);
    }
    assert.equal(NORMALISATION_PAIRS.length, 3, 'three canonically equivalent pairs');
    for (const p of NORMALISATION_PAIRS) {
      assert.notEqual(p.nfc, p.nfd, 'a pair whose forms are identical proves nothing');
      assert.equal(p.nfc.normalize('NFD'), p.nfd);
    }
  });
});

describe('four counterexamples that stop this being called an oracle', () => {
  // Each of these diverged from the frozen catalogue before the probes were rewritten.
  // They are pinned here because every one was a fixture LENGTH or CASE artefact leaking
  // into a question about character admission, and the same mistake is easy to reintroduce.

  test('FF-01 is not decided by whether a five-letter name fits', () => {
    // Was negative: "Smith" is five units and the maxlength is three, so the all-ASCII
    // control was rejected for its LENGTH and read as excluding Basic Latin.
    const r = suggestedLabels({ pattern: '[A-Za-z]{1,3}' });
    assert.equal(r.rules['FF-01'], 'positive');
    assert.equal(r.bounded['FF-01'], true, 'and the reading is bounded, because absence cannot be probed');
  });

  test('FF-02 fires on any required fixture diacritic excluded, not on macrons alone', () => {
    // Was negative: the macron IS admitted, and only macrons were checked. The catalogue
    // fires when at least one diacritic a fixture name requires is admitted nowhere, and
    // this class excludes the French, German, Spanish, Polish, Czech, Turkish and
    // Vietnamese fixtures.
    const r = suggestedLabels({ pattern: '[A-Za-z\u0101]+' });
    assert.equal(r.rules['FF-02'], 'positive');
    const w = behaviouralWitness({ pattern: '[A-Za-z\u0101]+' }).witness;
    assert.ok(w.requiredDiacriticsAdmitted.includes('\u0101'), 'the macron is admitted');
    assert.ok(w.requiredDiacriticsNotWitnessed.length > 0, 'others are not');
  });

  test('FF-04 is not decided by whether a twelve-character name fits', () => {
    // Was positive: "van der Berg" is twelve units and the maxlength is three, so every
    // punctuated fixture was rejected for its LENGTH and read as excluding punctuation.
    // All four characters are admitted, so the rule does not fire.
    const r = suggestedLabels({ pattern: "[A-Za-z'\u2019 \\-]{1,3}" });
    assert.equal(r.rules['FF-04'], 'negative');
  });

  test('FF-05 is not decided by uppercase short names alone', () => {
    // Was positive: the short-name fixtures are "O" and "X", both uppercase, and this
    // class admits neither - so a CASE restriction was read as a minimum length above one.
    // A single lowercase character is accepted, so the minimum is one.
    const r = suggestedLabels({ pattern: '[a-z]{1}' });
    assert.equal(r.rules['FF-05'], 'negative');
    assert.ok(behaviouralWitness({ pattern: '[a-z]{1}' }).witness.singleCharacterAccepted);
  });

  test('FF-01 needs a Basic Latin letter admitted, not merely no outside letter', () => {
    // Was positive: a digits-only class admits no letter outside Basic Latin, and the
    // witness that would have caught it was computed, reported, and never gated on.
    const r = suggestedLabels({ pattern: '[0-9]{1,5}' });
    assert.equal(r.rules['FF-01'], 'negative');
    assert.equal(behaviouralWitness({ pattern: '[0-9]{1,5}' }).witness.basicLatinAccepted, null);
  });

  test('FF-05 probes digits and punctuation too, not letters alone', () => {
    // Was positive: "1" is accepted, so the minimum accepted length is one, but the
    // single-character probe only tried letters.
    const r = suggestedLabels({ pattern: '[0-9]{1,5}' });
    assert.equal(r.rules['FF-05'], 'negative');
  });

  test('it answers where FormFair declines, so it is not a drop-in for the tool', () => {
    // FormFair's UNSUPPORTED list in src/parse/pattern.ts declines alternation, groups and
    // lookaround. A regex engine executes all three happily, so the witness returns a
    // confident reading exactly where the tool refuses to give one. Pinned because this
    // asymmetry is the reason the two cannot be compared decision-for-decision.
    for (const pattern of ['(?:[A-Za-z]+ )?[A-Za-z]+', '^[A-Za-z]+$|^$', '[A-Za-z]+(?=x)']) {
      const r = suggestedLabels({ pattern });
      assert.equal(r.undecidable, false, `${pattern} is answered, though FormFair declines it`);
    }
  });

  test('its probe alphabet is finite and hand-written, and misses real orthographies', () => {
    // Danish uses o-slash and a-ring. Neither is in the probe list, so a class admitting
    // them shows no outside witness and FF-01 reads positive. The bound is not theoretical.
    const danish = suggestedLabels({ pattern: '[A-Za-z\u00f8\u00e5]+' });
    assert.equal(danish.rules['FF-01'], 'positive', 'wrongly, because the probe set is incomplete');
    assert.equal(danish.bounded['FF-01'], true, 'which is why a positive reading is always bounded');
  });

  test('a positive FF-01 is always marked bounded, because absence is not provable', () => {
    // The reason this is evidence and not an oracle. Finite probing exhibits a string that
    // IS accepted; it can never exhaust the alphabet to show none is. Every rule in the
    // catalogue fires on an exclusion, so the direction that cannot be proven is exactly
    // the direction the rules are defined in.
    for (const pattern of ['[A-Za-z]+', '[A-Za-z]{2,40}', '[A-Za-z]{1,3}']) {
      const r = suggestedLabels({ pattern });
      assert.equal(r.rules['FF-01'], 'positive');
      assert.equal(r.bounded['FF-01'], true, `${pattern} should be a bounded reading`);
    }
    // The negative direction IS established, by exhibiting an admitted outside letter.
    const neg = suggestedLabels({ pattern: '[A-Za-z\u00c0-\u00ff]+' });
    assert.equal(neg.rules['FF-01'], 'negative');
    assert.equal(neg.bounded['FF-01'], false, 'a witness proves admission outright');
  });
});

describe('the witness generator decides by executing, not by reading', () => {
  test('a Basic-Latin-only class fires FF-01 and suppresses FF-02', () => {
    const r = suggestedLabels({ pattern: '[A-Za-z]+' });
    assert.equal(r.rules['FF-01'], 'positive');
    assert.equal(r.rules['FF-02'], 'negative', 'FF-01 suppresses FF-02');
    assert.equal(r.witness.outsideBasicLatinAdmitted.length, 0);
  });

  test('character admission is probed, not inferred from whole fixture names', () => {
    // The case that forced probing: this class admits lowercase accents but accepts no
    // fixture NAME, because Emile carries uppercase U+00C9. Judged on names alone it
    // would look Basic-Latin-only. It is not.
    const r = suggestedLabels({ pattern: '[A-Za-zéèêëàâ]+' });
    assert.equal(r.rules['FF-01'], 'negative');
    assert.ok(r.witness.outsideBasicLatinAdmitted.includes('é'));
    assert.equal(r.witness.diacriticNamesAccepted.length, 0, 'no whole fixture name is accepted');
  });

  test('FF-03 turns on the frozen normalisation pairs, not on diacritics in general', () => {
    // Admits precomposed letters but no combining marks: the NFC form of a pair is
    // accepted and its NFD form is not.
    const asymmetric = suggestedLabels({ pattern: '[A-Za-zÀ-ÿ]+' });
    assert.equal(asymmetric.rules['FF-03'], 'positive');
    assert.ok(asymmetric.witness.normalisationAsymmetries.length > 0);

    // Admits both forms, so the pair is treated alike.
    const symmetric = suggestedLabels({ pattern: "[\\p{L}\\p{M}'’ \\-]+" });
    assert.equal(symmetric.rules['FF-03'], 'negative');
  });

  test('FF-04 fires when any one of the four punctuation fixtures is rejected', () => {
    const noQuote = suggestedLabels({ pattern: "[A-Za-z' \\-]+" });
    assert.equal(noQuote.rules['FF-04'], 'positive', 'U+2019 is excluded');
    assert.ok(noQuote.witness.punctuationNotWitnessed.some((s) => s.includes('U+2019')));

    const allFour = suggestedLabels({ pattern: "[A-Za-z'’ \\-]+" });
    assert.equal(allFour.rules['FF-04'], 'negative');
  });

  test('FF-05 is decided by whether single-letter names are rejected', () => {
    assert.equal(suggestedLabels({ pattern: '[A-Za-z]+' }).rules['FF-05'], 'negative');
    assert.equal(suggestedLabels({ pattern: '[A-Za-z]{2,40}' }).rules['FF-05'], 'positive');
    assert.equal(suggestedLabels({ pattern: '[A-Za-z]+', minlength: 2 }).rules['FF-05'], 'positive');
  });

  test('a pattern that will not compile under the v flag is undecidable, never guessed', () => {
    // The browser compiles `pattern` with the v flag, under which a bare hyphen inside a
    // character class is a syntax error. Labels are withheld rather than recompiling under
    // a laxer flag to answer a question the browser would not ask.
    const r = suggestedLabels({ pattern: "[A-Za-z' -]+" });
    assert.equal(r.undecidable, true);
    assert.match(r.reason, /v flag/);
    assert.equal(r.rules, undefined, 'no labels may be reachable on an undecidable control');
    // The browser does not reject every value in this case - it applies NO pattern, so the
    // field is MORE permissive than it appears. FormFair may still correctly decline.
    assert.equal(r.patternIgnoredByBrowser, true);
    assert.equal(r.effectiveConstraint, 'length attributes only');
  });

  test('length limits are applied alongside the pattern, as one set of constraints', () => {
    const acc = acceptorFor({ pattern: '[A-Za-z]+', maxlength: 4 });
    assert.equal(acc.ok, true);
    assert.equal(acc.accepts('Anne'), true);
    assert.equal(acc.accepts('Annette'), false, 'maxlength rejects it though the pattern admits it');
  });
});
