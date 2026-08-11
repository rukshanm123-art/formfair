import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateAnnotation,
  validateAdjudication,
  validateCapture,
  validateDataset,
  RULES,
} from '../src/schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, '..', 'fixtures', 'synthetic', name), 'utf8'));

describe('annotation schema', () => {
  test('accepts a well-formed annotation file', () => {
    const r = validateAnnotation(fixture('annotation.valid.json'));
    assert.equal(r.valid, true, r.problems.join('; '));
  });

  test('refuses "declined" as a ground-truth label', () => {
    // A FormFair outcome, not a human label. Admitting it would let a hard case be
    // recorded as agreement with the tool rather than sent to adjudication.
    const r = validateAnnotation(fixture('annotation.invalid.json'));
    assert.equal(r.valid, false);
    assert.match(r.problems.join(' '), /"declined" is a FormFair outcome/);
  });

  test('rejects an input type outside the supported set', () => {
    const r = validateAnnotation(fixture('annotation.invalid.json'));
    assert.match(r.problems.join(' '), /inputType "email" is outside the supported set/);
  });

  test('requires all five rule labels on a personal-name control', () => {
    const file = fixture('annotation.valid.json');
    delete file.pages[0].controls[0].rules['FF-03'];
    const r = validateAnnotation(file);
    assert.equal(r.valid, false);
    assert.match(r.problems.join(' '), /needs a label for FF-03/);
  });

  test('rejects rule labels on a control that is not a personal-name control', () => {
    const r = validateAnnotation(fixture('annotation.invalid.json'));
    assert.match(r.problems.join(' '), /only controls labelled personal-name controls carry rule labels/);
  });

  test('requires a reason and evidence on every label', () => {
    // Taken from the valid file so the rule branch is actually reached: a control whose
    // stage-one label is malformed never gets as far as its rule labels.
    const file = fixture('annotation.valid.json');
    file.pages[0].controls[0].rules['FF-01'].reason = '';
    file.pages[0].controls[0].rules['FF-02'].evidence = '   ';
    const r = validateAnnotation(file);
    assert.equal(r.valid, false);
    assert.match(r.problems.join(' '), /FF-01: a label must carry a short reason/);
    assert.match(r.problems.join(' '), /FF-02: a label must carry the markup evidence/);
  });

  test('requires a reason on the stage-one label too', () => {
    const file = fixture('annotation.valid.json');
    file.pages[0].controls[1].stageOne.reason = '';
    assert.match(validateAnnotation(file).problems.join(' '), /stageOne: a label must carry a short reason/);
  });

  test('rejects a file bound to the wrong instrument', () => {
    const file = fixture('annotation.valid.json');
    file.instrument = 'main';
    assert.match(validateAnnotation(file).problems.join(' '), /evaluation-v1\.0\.0/);
  });

  test('rejects a duplicated controlId, which would double-count a label', () => {
    const file = fixture('annotation.valid.json');
    file.pages[0].controls.push({ ...file.pages[0].controls[1] });
    assert.match(validateAnnotation(file).problems.join(' '), /duplicate controlId/);
  });

  test('reports every fault in one pass rather than the first', () => {
    assert.ok(validateAnnotation(fixture('annotation.invalid.json')).problems.length >= 4);
  });
});

describe('dataset schema', () => {
  test('accepts the synthetic dataset', () => {
    const r = validateDataset(fixture('dataset.valid.json'));
    assert.equal(r.valid, true, r.problems.join('; '));
  });

  test('requires detected on every control', () => {
    // Without it, stage-one recall cannot be computed: a control FormFair identified and
    // found nothing on leaves no other trace.
    const r = validateDataset(fixture('dataset.invalid.json'));
    assert.equal(r.valid, false);
    assert.match(r.problems.join(' '), /detected must be a boolean/);
  });

  test('requires a ground-truth label for every rule on a name control', () => {
    assert.match(validateDataset(fixture('dataset.invalid.json')).problems.join(' '), /missing the ground-truth label for FF-02/);
  });

  test('rejects a duplicate page, which would count it twice', () => {
    const file = fixture('dataset.valid.json');
    file.pages.push(structuredClone(file.pages[0]));
    const r = validateDataset(file);
    assert.equal(r.valid, false);
    assert.match(r.problems.join(' '), /duplicate pageId .* count that page twice/);
  });

  test('rejects a duplicate control, even across different pages', () => {
    const file = fixture('dataset.valid.json');
    file.pages[1].controls.push(structuredClone(file.pages[0].controls[0]));
    assert.match(validateDataset(file).problems.join(' '), /duplicate controlId/);
  });

  test('requires exactly five outcomes on a detected name control', () => {
    const file = fixture('dataset.valid.json');
    delete file.pages[0].controls[0].outcomes['FF-03'];
    const r = validateDataset(file);
    assert.equal(r.valid, false);
    assert.match(r.problems.join(' '), /outcomes: missing the outcome for FF-03/);
  });

  test('requires exactly five ground-truth labels', () => {
    const file = fixture('dataset.valid.json');
    delete file.pages[0].controls[0].rules['FF-05'];
    assert.match(validateDataset(file).problems.join(' '), /rules: missing the ground-truth label for FF-05/);
  });

  test('rejects an extra rule that would double-count', () => {
    const file = fixture('dataset.valid.json');
    file.pages[0].controls[0].outcomes['FF-06'] = 'finding';
    assert.match(validateDataset(file).problems.join(' '), /unknown rules FF-06/);
  });

  test('rejects outcomes on a control that was never detected', () => {
    const file = fixture('dataset.valid.json');
    file.pages[0].controls[1].outcomes = { 'FF-01': 'clean' };
    assert.match(validateDataset(file).problems.join(' '), /not detected cannot carry outcomes/);
  });

  test('rejects an unknown outcome', () => {
    const file = fixture('dataset.valid.json');
    file.pages[0].controls[0].outcomes['FF-01'] = 'maybe';
    assert.match(validateDataset(file).problems.join(' '), /outcome must be one of finding, clean, declined/);
  });
});

describe('capture schema', () => {
  test('accepts a captured page and an excluded agency', () => {
    for (const [i, record] of fixture('capture.valid.json').captures.entries()) {
      const r = validateCapture(record, i);
      assert.equal(r.valid, true, r.problems.join('; '));
    }
  });

  test('rejects a capture at any other viewport', () => {
    const record = fixture('capture.valid.json').captures[0];
    record.viewport = { width: 1920, height: 1080 };
    assert.match(validateCapture(record).problems.join(' '), /viewport must be 1280x800/);
  });

  test('requires a reason when an agency is excluded', () => {
    const record = { agency: 'A', website: 'W', originalUrl: 'https://x.invalid/', status: 'excluded' };
    assert.match(validateCapture(record).problems.join(' '), /must record why/);
  });

  test('requires a page hash on a captured page', () => {
    const record = fixture('capture.valid.json').captures[0];
    delete record.htmlSha256;
    assert.match(validateCapture(record).problems.join(' '), /htmlSha256/);
  });

  test('rejects a category outside the four in the protocol', () => {
    const record = fixture('capture.valid.json').captures[0];
    record.category = 'something-else';
    assert.match(validateCapture(record).problems.join(' '), /category must be one of/);
  });
});

describe('adjudication schema', () => {
  test('accepts well-formed decisions', () => {
    const r = validateAdjudication(fixture('adjudication.valid.json'));
    assert.equal(r.valid, true, r.problems.join('; '));
  });

  test('requires the catalogue clause a decision rests on', () => {
    const file = fixture('adjudication.valid.json');
    delete file.decisions[0].catalogueClause;
    assert.match(validateAdjudication(file).problems.join(' '), /catalogueClause/);
  });

  test('rejects a decision that is not positive or negative', () => {
    const file = fixture('adjudication.valid.json');
    file.decisions[0].decision = 'declined';
    assert.match(validateAdjudication(file).problems.join(' '), /decision must be one of/);
  });

  test('rejects an unknown rule', () => {
    const file = fixture('adjudication.valid.json');
    file.decisions[0].rule = 'FF-99';
    assert.match(validateAdjudication(file).problems.join(' '), /rule must be one of/);
  });
});

describe('the rule list is the frozen catalogue', () => {
  test('is exactly FF-01 to FF-05', () => {
    assert.deepEqual(RULES, ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05']);
  });
});
