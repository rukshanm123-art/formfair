/**
 * The behavioural oracle, and the guarantee that keeps it honest.
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
import { oracleLabels, acceptorFor } from '../oracle/oracle.mjs';
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

describe('the oracle decides by executing, not by reading', () => {
  test('a Basic-Latin-only class fires FF-01 and suppresses FF-02', () => {
    const r = oracleLabels({ pattern: '[A-Za-z]+' });
    assert.equal(r.rules['FF-01'], 'positive');
    assert.equal(r.rules['FF-02'], 'negative', 'FF-01 suppresses FF-02');
    assert.equal(r.witness.outsideBasicLatinAdmitted.length, 0);
  });

  test('character admission is probed, not inferred from whole fixture names', () => {
    // The case that forced probing: this class admits lowercase accents but accepts no
    // fixture NAME, because Emile carries uppercase U+00C9. Judged on names alone it
    // would look Basic-Latin-only. It is not.
    const r = oracleLabels({ pattern: '[A-Za-zéèêëàâ]+' });
    assert.equal(r.rules['FF-01'], 'negative');
    assert.ok(r.witness.outsideBasicLatinAdmitted.includes('é'));
    assert.equal(r.witness.diacriticNamesAccepted.length, 0, 'no whole fixture name is accepted');
  });

  test('FF-03 turns on the frozen normalisation pairs, not on diacritics in general', () => {
    // Admits precomposed letters but no combining marks: the NFC form of a pair is
    // accepted and its NFD form is not.
    const asymmetric = oracleLabels({ pattern: '[A-Za-zÀ-ÿ]+' });
    assert.equal(asymmetric.rules['FF-03'], 'positive');
    assert.ok(asymmetric.witness.normalisationAsymmetries.length > 0);

    // Admits both forms, so the pair is treated alike.
    const symmetric = oracleLabels({ pattern: "[\\p{L}\\p{M}'’ \\-]+" });
    assert.equal(symmetric.rules['FF-03'], 'negative');
  });

  test('FF-04 fires when any one of the four punctuation fixtures is rejected', () => {
    const noQuote = oracleLabels({ pattern: "[A-Za-z' \\-]+" });
    assert.equal(noQuote.rules['FF-04'], 'positive', 'U+2019 is excluded');
    assert.ok(noQuote.witness.punctuationNamesRejected.some((s) => s.includes('U+2019')));

    const allFour = oracleLabels({ pattern: "[A-Za-z'’ \\-]+" });
    assert.equal(allFour.rules['FF-04'], 'negative');
  });

  test('FF-05 is decided by whether single-letter names are rejected', () => {
    assert.equal(oracleLabels({ pattern: '[A-Za-z]+' }).rules['FF-05'], 'negative');
    assert.equal(oracleLabels({ pattern: '[A-Za-z]{2,40}' }).rules['FF-05'], 'positive');
    assert.equal(oracleLabels({ pattern: '[A-Za-z]+', minlength: 2 }).rules['FF-05'], 'positive');
  });

  test('a pattern that will not compile under the v flag is undecidable, never guessed', () => {
    // The browser compiles `pattern` with the v flag, under which a bare hyphen inside a
    // character class is a syntax error. The oracle reports that rather than falling back
    // to a different flag and answering a question the browser would not ask.
    const r = oracleLabels({ pattern: "[A-Za-z' -]+" });
    assert.equal(r.undecidable, true);
    assert.match(r.reason, /v flag/);
    assert.equal(r.rules, undefined, 'no labels may be reachable on an undecidable control');
  });

  test('length limits are applied alongside the pattern, as one set of constraints', () => {
    const acc = acceptorFor({ pattern: '[A-Za-z]+', maxlength: 4 });
    assert.equal(acc.ok, true);
    assert.equal(acc.accepts('Anne'), true);
    assert.equal(acc.accepts('Annette'), false, 'maxlength rejects it though the pattern admits it');
  });
});
