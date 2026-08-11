import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drawOrder, drawKey, toCsv, sha256, firstField } from '../src/draw-order.mjs';
import { verifySeal, hashFile } from '../src/seal.mjs';

const AGENCIES = [
  'Ministry of Education',
  'Department of Conservation',
  'Te Whatu Ora',
  'Statistics New Zealand',
  'Land Information New Zealand',
];
const FRAME_SHA = 'a'.repeat(64);

describe('draw order (protocol section 2)', () => {
  test('is deterministic', () => {
    assert.deepEqual(drawOrder(AGENCIES, FRAME_SHA), drawOrder(AGENCIES, FRAME_SHA));
  });

  test('does not depend on the order agencies appear in the frame', () => {
    const shuffled = [...AGENCIES].reverse();
    assert.deepEqual(
      drawOrder(AGENCIES, FRAME_SHA).map((r) => r.agency),
      drawOrder(shuffled, FRAME_SHA).map((r) => r.agency)
    );
  });

  test('changes completely if the frame changes, so it cannot be quietly re-rolled', () => {
    const a = drawOrder(AGENCIES, FRAME_SHA).map((r) => r.agency);
    const b = drawOrder(AGENCIES, 'b'.repeat(64)).map((r) => r.agency);
    assert.notDeepEqual(a, b);
  });

  test('is not alphabetical - that is the whole point', () => {
    const drawn = drawOrder(AGENCIES, FRAME_SHA).map((r) => r.agency);
    assert.notDeepEqual(drawn, [...AGENCIES].sort());
  });

  test('includes every agency exactly once, numbered from one', () => {
    const rows = drawOrder(AGENCIES, FRAME_SHA);
    assert.equal(rows.length, AGENCIES.length);
    assert.deepEqual(new Set(rows.map((r) => r.agency)), new Set(AGENCIES));
    assert.deepEqual(rows.map((r) => r.position), [1, 2, 3, 4, 5]);
  });

  test('de-duplicates repeated agency names in the frame', () => {
    assert.equal(drawOrder([...AGENCIES, AGENCIES[0]], FRAME_SHA).length, AGENCIES.length);
  });

  test('binds the key to the tag, the frame and the name together', () => {
    assert.notEqual(drawKey('A', FRAME_SHA), drawKey('A', FRAME_SHA, 'other-tag'));
    assert.notEqual(drawKey('A', FRAME_SHA), drawKey('B', FRAME_SHA));
  });

  test('the CSV records the provenance needed to recompute it', () => {
    const csv = toCsv(drawOrder(AGENCIES, FRAME_SHA), FRAME_SHA);
    assert.match(csv, /# tag=evaluation-v1\.0\.0/);
    assert.match(csv, new RegExp(`# frame_sha256=${FRAME_SHA}`));
    assert.match(csv, /position,agency,draw_key/);
  });

  test('quotes agency names containing a comma', () => {
    const csv = toCsv(drawOrder(['Ministry of Health, Manatū Hauora'], FRAME_SHA), FRAME_SHA);
    assert.match(csv, /"Ministry of Health, Manatū Hauora"/);
  });
});

describe('reading agency names back out of frame.csv', () => {
  test('keeps a quoted name containing commas intact', () => {
    // Splitting on the first comma truncated this to "Ministry of Business", which
    // changed its draw key and so its position in the frozen order.
    const line = '"Ministry of Business, Innovation and Employment",MBIE,https://mbie.govt.nz/,90';
    assert.equal(firstField(line), 'Ministry of Business, Innovation and Employment');
  });

  test('reads an unquoted name', () => {
    assert.equal(firstField('Stats NZ,Stats NZ,https://stats.govt.nz/,100'), 'Stats NZ');
  });

  test('unescapes a doubled quote inside a quoted name', () => {
    assert.equal(firstField('"The ""Agency""",x,y'), 'The "Agency"');
  });

  test('round-trips every name through toCsv and back', () => {
    const names = ['Stats NZ', 'Ministry of Business, Innovation and Employment', 'Te Puni Kōkiri'];
    const csv = toCsv(drawOrder(names, FRAME_SHA), FRAME_SHA);
    const read = csv
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .slice(1)
      .map((l) => firstField(l.slice(l.indexOf(',') + 1)));
    assert.deepEqual(new Set(read), new Set(names));
  });
});

describe('evaluation seal (protocol section 10)', () => {
  const withSealDir = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'formfair-seal-'));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const buildManifest = (dir, overrides = {}) => {
    const files = {};
    for (const key of ['annotatorA', 'annotatorB', 'kappa', 'adjudication']) {
      const path = join(dir, `${key}.json`);
      writeFileSync(path, JSON.stringify({ key }));
      files[key] = { path: `${key}.json`, sha256: hashFile(path) };
    }
    return { instrument: 'evaluation-v1.0.0', files, ...overrides };
  };

  test('passes when every required file is present and unchanged', () => {
    withSealDir((dir) => {
      const r = verifySeal(buildManifest(dir), (p) => join(dir, p));
      assert.equal(r.sealed, true, r.failures.join('; '));
    });
  });

  test('fails when an annotation file is missing', () => {
    withSealDir((dir) => {
      const manifest = buildManifest(dir);
      delete manifest.files.annotatorB;
      const r = verifySeal(manifest, (p) => join(dir, p));
      assert.equal(r.sealed, false);
      assert.match(r.failures.join(' '), /annotatorB/);
    });
  });

  test('fails when a sealed file has been edited after sealing', () => {
    withSealDir((dir) => {
      const manifest = buildManifest(dir);
      writeFileSync(join(dir, 'annotatorA.json'), JSON.stringify({ key: 'tampered' }));
      const r = verifySeal(manifest, (p) => join(dir, p));
      assert.equal(r.sealed, false);
      assert.match(r.failures.join(' '), /hash mismatch/);
    });
  });

  test('fails when the instrument is not the frozen tag', () => {
    withSealDir((dir) => {
      const r = verifySeal(buildManifest(dir, { instrument: 'main' }), (p) => join(dir, p));
      assert.equal(r.sealed, false);
      assert.match(r.failures.join(' '), /evaluation-v1\.0\.0/);
    });
  });

  test('refuses to re-seal once a run has been recorded', () => {
    withSealDir((dir) => {
      const manifest = buildManifest(dir, { formfairRun: { at: '2026-08-20T00:00:00Z' } });
      const r = verifySeal(manifest, (p) => join(dir, p));
      assert.equal(r.sealed, false);
      assert.match(r.failures.join(' '), /seal is closed/);
    });
  });

  test('reports every problem at once rather than the first', () => {
    withSealDir((dir) => {
      const manifest = buildManifest(dir, { instrument: 'main' });
      delete manifest.files.kappa;
      const r = verifySeal(manifest, (p) => join(dir, p));
      assert.ok(r.failures.length >= 2);
    });
  });
});

describe('hashing', () => {
  test('sha256 is stable and 64 hex characters', () => {
    assert.equal(sha256('formfair'), sha256('formfair'));
    assert.match(sha256('formfair'), /^[0-9a-f]{64}$/);
  });
});
