/**
 * The seal must bind the numbers to the material they came from.
 *
 * These are regression tests for a real bypass: a seal whose run hashes were sixty-four
 * zeros, presented alongside a dataset with a completely different hash, was accepted and
 * produced metrics. Validating that a digest looks like a digest is not a check.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyClosedSeal, bindDataset, INSTRUMENT_COMMIT } from '../src/seal.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const ZEROS = '0'.repeat(64);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** spawnSync, not execFileSync: the latter discards stderr on success, and the seal
 *  confirmation this asserts on is written there. */
function runMetrics(args) {
  const r = spawnSync('node', [join(root, 'src', 'cli-metrics.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-seal-bind-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A complete, genuinely closed seal over real files, plus the dataset it covers. */
function sealedEvaluation(dir, { tamper } = {}) {
  const dataset = JSON.parse(readFileSync(join(root, 'fixtures', 'synthetic', 'dataset.valid.json'), 'utf8'));
  delete dataset.synthetic;

  const files = {};
  const write = (key, contents) => {
    const path = join(dir, `${key}.json`);
    writeFileSync(path, contents);
    files[key] = { path: `${key}.json`, sha256: sha256(contents) };
    return files[key].sha256;
  };

  const inventorySha = write('inventory', JSON.stringify({ pages: [] }));
  const groundTruthSha = write('groundTruth', JSON.stringify({ pages: {} }));
  const reportsSha = write('reports', JSON.stringify({}));
  const annotationA = write('annotatorA', JSON.stringify({ annotator: 'a' }));
  const annotationB = write('annotatorB', JSON.stringify({ annotator: 'b' }));
  const kappa = write('kappa', JSON.stringify({ stageOne: 0.8 }));
  const adjudication = write('adjudication', JSON.stringify({ adjudicator: 'c' }));

  dataset.builtFrom = {
    inventorySha256: inventorySha,
    groundTruthSha256: groundTruthSha,
    reportsSha256: reportsSha,
    annotationASha256: annotationA,
    annotationBSha256: annotationB,
    kappaSha256: kappa,
    adjudicationSha256: adjudication,
    htmlSha256ByPage: {},
  };
  if (tamper) tamper(dataset);

  const datasetText = JSON.stringify(dataset, null, 2) + '\n';
  const datasetPath = join(dir, 'dataset.json');
  writeFileSync(datasetPath, datasetText);
  files.dataset = { path: 'dataset.json', sha256: sha256(datasetText) };

  const manifest = {
    instrument: 'evaluation-v1.0.0',
    files,
    formfairRun: {
      runAt: '2026-09-01T00:00:00Z',
      instrument: 'evaluation-v1.0.0',
      instrumentCommit: INSTRUMENT_COMMIT,
      inventorySha256: inventorySha,
      groundTruthSha256: groundTruthSha,
      reportsSha256: reportsSha,
      datasetSha256: files.dataset.sha256,
    },
  };
  const sealPath = join(dir, 'seal.json');
  writeFileSync(sealPath, JSON.stringify(manifest, null, 2));
  return { sealPath, datasetPath, manifest, dataset, files };
}

describe('a genuinely closed seal', () => {
  test('verifies, binds, and scores', () =>
    withDir((dir) => {
      const { sealPath, datasetPath } = sealedEvaluation(dir);
      const r = runMetrics([datasetPath, '--seal', sealPath]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, /seal: closed, and bound to this dataset/);
      assert.ok(JSON.parse(r.stdout).stageOne);
    }));
});

describe('the zero-hash bypass', () => {
  test('a seal of sixty-four zeros is refused', () =>
    withDir((dir) => {
      const { sealPath, datasetPath, manifest } = sealedEvaluation(dir);
      manifest.formfairRun.inventorySha256 = ZEROS;
      manifest.formfairRun.reportsSha256 = ZEROS;
      manifest.formfairRun.datasetSha256 = ZEROS;
      writeFileSync(sealPath, JSON.stringify(manifest, null, 2));

      const r = runMetrics([datasetPath, '--seal', sealPath]);
      assert.equal(r.code, 1, 'a seal that records nothing real must not score');
      assert.match(r.stderr, /run record and the sealed artefact disagree/);
    }));

  test('a sealed file whose contents changed is refused', () =>
    withDir((dir) => {
      const { sealPath, datasetPath } = sealedEvaluation(dir);
      writeFileSync(join(dir, 'annotatorA.json'), JSON.stringify({ annotator: 'relabelled' }));
      const r = runMetrics([datasetPath, '--seal', sealPath]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /A sealed file must not change/);
    }));

  test('a different dataset presented against a valid seal is refused', () =>
    withDir((dir) => {
      const { sealPath, datasetPath } = sealedEvaluation(dir);
      const other = JSON.parse(readFileSync(datasetPath, 'utf8'));
      other.pages[0].pageId = 'a-different-evaluation';
      const otherPath = join(dir, 'other.json');
      writeFileSync(otherPath, JSON.stringify(other, null, 2) + '\n');

      const r = runMetrics([otherPath, '--seal', sealPath]);
      assert.equal(r.code, 1, 'the seal must cover this dataset, not merely be valid');
      assert.match(r.stderr, /would describe a different evaluation from the one that was sealed/);
    }));

  test('a dataset not built from the sealed material is refused', () =>
    withDir((dir) => {
      const { sealPath, datasetPath } = sealedEvaluation(dir, {
        tamper: (d) => {
          d.builtFrom.adjudicationSha256 = ZEROS;
        },
      });
      const r = runMetrics([datasetPath, '--seal', sealPath]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /was not built from the sealed material/);
    }));

  test('a synthetic dataset cannot be scored through the sealed path', () =>
    withDir((dir) => {
      const { sealPath, datasetPath } = sealedEvaluation(dir, {
        tamper: (d) => {
          d.synthetic = true;
        },
      });
      const r = runMetrics([datasetPath, '--seal', sealPath]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /marked synthetic cannot be scored through the sealed path/);
    }));

  test('a run at the wrong instrument commit is refused', () =>
    withDir((dir) => {
      const { sealPath, datasetPath, manifest } = sealedEvaluation(dir);
      manifest.formfairRun.instrumentCommit = 'f'.repeat(40);
      writeFileSync(sealPath, JSON.stringify(manifest, null, 2));
      const r = runMetrics([datasetPath, '--seal', sealPath]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /instrumentCommit must be 9f43862/);
    }));
});

describe('bindDataset in isolation', () => {
  test('reports every mismatch at once', () => {
    const manifest = {
      files: {
        dataset: { sha256: 'a'.repeat(64) },
        inventory: { sha256: 'b'.repeat(64) },
        annotatorA: { sha256: 'c'.repeat(64) },
      },
    };
    const { bound, failures } = bindDataset(manifest, { builtFrom: {} }, ZEROS);
    assert.equal(bound, false);
    assert.ok(failures.length >= 3);
  });

  test('a seal with no dataset entry cannot silently pass', () =>
    withDir((dir) => {
      const { manifest, datasetPath } = sealedEvaluation(dir);
      delete manifest.files.dataset;
      const { sealed, failures } = verifyClosedSeal(manifest, (p) => join(dir, p));
      assert.equal(sealed, false);
      assert.match(failures.join(' '), /missing from the manifest: dataset/);
      assert.ok(datasetPath);
    }));
});
