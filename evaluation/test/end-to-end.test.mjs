/**
 * The whole protocol, driven through the actual command-line entry points on synthetic
 * HTML: inventory, annotation, ground truth, pre-run seal, evaluation, join, closed seal,
 * metrics.
 *
 * Library-level tests cannot catch a command that runs the analyser without checking the
 * seal, or one that quietly never asks for delegated findings. Both shipped here.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { instrumentDirFromEnv } from '../src/instrument-ref.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/**
 * Synthetic pages. The second carries an input with no label at all, which axe-core's
 * `label` rule reports: without it, a delegated count of zero would be indistinguishable
 * from never having asked.
 */
const PAGES = {
  'synthetic-a': `<!doctype html><html><body>
<form>
  <label for="fn">First name</label>
  <input id="fn" name="firstName" type="text" pattern="[A-Za-z]{2,40}" minlength="2" maxlength="40">
  <input type="search" name="q" aria-label="Search this site">
</form>
</body></html>`,
  'synthetic-b': `<!doctype html><html><body>
<form>
  <input name="firstName" pattern="[A-Za-z]+">
  <input name="company_name" type="text">
</form>
</body></html>`,
};

let instrumentDir;

before(() => {
  instrumentDir = instrumentDirFromEnv();
  if (!instrumentDir) throw new Error('FORMFAIR_INSTRUMENT_DIR is not set; run scripts/setup-instrument.sh');
});

function cli(script, args, cwd = root) {
  const r = spawnSync('node', [join(root, 'src', script), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORMFAIR_INSTRUMENT_DIR: instrumentDir },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-e2e-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Runs inventory, writes annotations that agree, derives ground truth, and seals. */
function prepare(dir, { disagree = false } = {}) {
  const captures = join(dir, 'captures');
  mkdirSync(captures);
  for (const [pageId, html] of Object.entries(PAGES)) writeFileSync(join(captures, `${pageId}.html`), html);

  const inventoryPath = join(dir, 'inventory.json');
  const inv = cli('cli-inventory.mjs', [captures, '--out', inventoryPath]);
  assert.equal(inv.code, 0, inv.stderr);
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));

  // Both annotators label every control in the inventory. The first input on each page is
  // the personal-name control; the rest are not.
  const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];
  const label = (l) => ({ label: l, reason: 'synthetic fixture', evidence: '<input>' });
  const annotationFor = (annotator, flip) => ({
    annotator,
    instrument: 'evaluation-v1.0.0',
    pages: inventory.pages.map((page) => ({
      pageId: page.pageId,
      controls: page.controls.map((c) => {
        const isName = c.ordinal === 0;
        const control = {
          controlId: c.controlId,
          inputType: c.inputType,
          stageOne: label(isName ? 'positive' : 'negative'),
        };
        if (isName) {
          control.rules = Object.fromEntries(
            RULES.map((r) => [
              r,
              label(r === 'FF-03' ? 'negative' : flip && r === 'FF-02' ? 'positive' : r === 'FF-02' ? 'negative' : 'positive'),
            ])
          );
        }
        return control;
      }),
    })),
  });

  const aPath = join(dir, 'annotatorA.json');
  const bPath = join(dir, 'annotatorB.json');
  writeFileSync(aPath, JSON.stringify(annotationFor('annotator-a', false), null, 2));
  writeFileSync(bPath, JSON.stringify(annotationFor('annotator-b', disagree), null, 2));

  const adjPath = join(dir, 'adjudication.json');
  const decisions = disagree
    ? inventory.pages.map((page) => ({
        pageId: page.pageId,
        controlId: page.controls[0].controlId,
        rule: 'FF-02',
        decision: 'negative',
        reason: 'FF-01 fires, so FF-02 is contributing evidence',
        catalogueClause: 'FF-02 Interaction: subsumed by FF-01',
      }))
    : [];
  writeFileSync(adjPath, JSON.stringify({ adjudicator: 'adjudicator-c', instrument: 'evaluation-v1.0.0', decisions }, null, 2));

  const kappaPath = join(dir, 'kappa.json');
  writeFileSync(kappaPath, JSON.stringify({ stageOne: { kappa: 1 } }, null, 2));

  const truthPath = join(dir, 'ground-truth.json');
  const gt = cli('cli-ground-truth.mjs', [
    '--a', aPath, '--b', bPath, '--adjudication', adjPath, '--inventory', inventoryPath, '--out', truthPath,
  ]);

  return { dir, captures, inventoryPath, aPath, bPath, adjPath, kappaPath, truthPath, groundTruth: gt };
}

/** Writes a valid pre-run seal over the prepared files. */
function seal(prepared, { omit } = {}) {
  const entry = (key, path) => [key, { path, sha256: sha256(readFileSync(join(prepared.dir, path), 'utf8')) }];
  const files = Object.fromEntries(
    [
      entry('annotatorA', 'annotatorA.json'),
      entry('annotatorB', 'annotatorB.json'),
      entry('kappa', 'kappa.json'),
      entry('adjudication', 'adjudication.json'),
      entry('inventory', 'inventory.json'),
      entry('groundTruth', 'ground-truth.json'),
    ].filter(([key]) => key !== omit)
  );
  const sealPath = join(prepared.dir, 'seal.pre-run.json');
  writeFileSync(sealPath, JSON.stringify({ instrument: 'evaluation-v1.0.0', files }, null, 2));
  return sealPath;
}

describe('ground truth is derived, not assembled', () => {
  test('agreeing annotators produce it deterministically', () =>
    withDir((dir) => {
      const p = prepare(dir);
      assert.equal(p.groundTruth.code, 0, p.groundTruth.stderr);
      const first = readFileSync(p.truthPath, 'utf8');
      cli('cli-ground-truth.mjs', ['--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath, '--out', p.truthPath]);
      assert.equal(readFileSync(p.truthPath, 'utf8'), first, 'the same inputs must give byte-identical output');
    }));

  test('a disagreement is resolved only by the adjudicator', () =>
    withDir((dir) => {
      const p = prepare(dir, { disagree: true });
      assert.equal(p.groundTruth.code, 0, p.groundTruth.stderr);
      const truth = JSON.parse(readFileSync(p.truthPath, 'utf8'));
      const page = truth.pages['synthetic-a'];
      const control = Object.values(page).find((c) => c.isNameControl);
      assert.equal(control.rules['FF-02'], 'negative', 'the adjudicated decision must win');
    }));

  test('an unadjudicated disagreement is refused', () =>
    withDir((dir) => {
      const p = prepare(dir, { disagree: true });
      writeFileSync(p.adjPath, JSON.stringify({ adjudicator: 'adjudicator-c', decisions: [] }, null, 2));
      const r = cli('cli-ground-truth.mjs', [
        '--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath, '--out', join(dir, 'x.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no adjudicated decision/);
    }));

  test('a control in the inventory that was not labelled is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const a = JSON.parse(readFileSync(p.aPath, 'utf8'));
      a.pages[0].controls.pop();
      writeFileSync(p.aPath, JSON.stringify(a, null, 2));
      const r = cli('cli-ground-truth.mjs', [
        '--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath,
        '--inventory', p.inventoryPath, '--out', join(dir, 'x.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /not labelled by both/);
    }));
});

describe('the join refuses to run FormFair outside the seal', () => {
  const joinArgs = (p, sealPath, over = {}) => [
    '--seal', over.seal ?? sealPath,
    '--captures', over.captures ?? p.captures,
    '--inventory', over.inventory ?? p.inventoryPath,
    '--truth', over.truth ?? p.truthPath,
    '--out', join(p.dir, 'dataset.json'),
    '--reports', join(p.dir, 'reports.json'),
    '--closed-seal', join(p.dir, 'seal.closed.json'),
  ];

  test('without --seal it will not start', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const r = cli('cli-join.mjs', [
        '--captures', p.captures, '--inventory', p.inventoryPath, '--truth', p.truthPath,
        '--out', join(dir, 'd.json'), '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /FormFair must not run before the annotations are sealed/);
      assert.equal(existsSync(join(dir, 'r.json')), false, 'no report may be produced');
    }));

  test('an incomplete seal will not do', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p, { omit: 'groundTruth' });
      const r = cli('cli-join.mjs', joinArgs(p, sealPath));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /missing from the manifest: groundTruth/);
    }));

  test('a ground truth that is not the sealed one is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const edited = join(dir, 'edited-truth.json');
      const truth = JSON.parse(readFileSync(p.truthPath, 'utf8'));
      const page = truth.pages['synthetic-a'];
      Object.values(page)[0].isNameControl = false;
      writeFileSync(edited, JSON.stringify(truth, null, 2) + '\n');

      const r = cli('cli-join.mjs', joinArgs(p, sealPath, { truth: edited }));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /not the sealed ground truth/);
    }));

  test('an inventory that is not the sealed one is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const edited = join(dir, 'edited-inventory.json');
      writeFileSync(edited, readFileSync(p.inventoryPath, 'utf8').replace('"ordinal": 0', '"ordinal": 9'));
      const r = cli('cli-join.mjs', joinArgs(p, sealPath, { inventory: edited }));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /not the sealed inventory/);
    }));

  test('a seal that already records a run is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const manifest = JSON.parse(readFileSync(sealPath, 'utf8'));
      manifest.formfairRun = { runAt: '2026-09-01T00:00:00Z' };
      writeFileSync(sealPath, JSON.stringify(manifest, null, 2));
      const r = cli('cli-join.mjs', joinArgs(p, sealPath));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /already been run/);
    }));

  test('a capture whose bytes changed after sealing is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      writeFileSync(join(p.captures, 'synthetic-a.html'), PAGES['synthetic-a'].replace('First name', 'Given name'));
      const r = cli('cli-join.mjs', joinArgs(p, sealPath));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /bytes analysed are not the bytes annotated/);
    }));
});

describe('a sealed run, end to end', () => {
  const run = (dir) => {
    const p = prepare(dir);
    const sealPath = seal(p);
    const datasetPath = join(dir, 'dataset.json');
    const reportsPath = join(dir, 'reports.json');
    const closedPath = join(dir, 'seal.closed.json');
    const joined = cli('cli-join.mjs', [
      '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath,
      '--truth', p.truthPath, '--out', datasetPath, '--reports', reportsPath, '--closed-seal', closedPath,
    ]);
    return { p, sealPath, datasetPath, reportsPath, closedPath, joined };
  };

  test('produces a dataset, reports and a closed seal', () =>
    withDir((dir) => {
      const { joined, datasetPath, reportsPath, closedPath } = run(dir);
      assert.equal(joined.code, 0, joined.stderr);
      for (const path of [datasetPath, reportsPath, closedPath]) assert.ok(existsSync(path), `${path} written`);
    }));

  test('leaves the pre-run seal exactly as it was', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const before = readFileSync(sealPath, 'utf8');
      cli('cli-join.mjs', [
        '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath, '--truth', p.truthPath,
        '--out', join(dir, 'd.json'), '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(readFileSync(sealPath, 'utf8'), before, 'the evidence of pre-run sealing must survive');
      assert.equal(JSON.parse(before).formfairRun, undefined);
    }));

  test('the closed seal records the run and hashes what it produced', () =>
    withDir((dir) => {
      const { closedPath, datasetPath, reportsPath, sealPath } = run(dir);
      const closed = JSON.parse(readFileSync(closedPath, 'utf8'));
      assert.equal(closed.formfairRun.instrument, 'evaluation-v1.0.0');
      assert.equal(closed.formfairRun.datasetSha256, sha256(readFileSync(datasetPath, 'utf8')));
      assert.equal(closed.formfairRun.reportsSha256, sha256(readFileSync(reportsPath, 'utf8')));
      assert.equal(closed.formfairRun.preRunSealSha256, sha256(readFileSync(sealPath, 'utf8')));
      assert.equal(closed.formfairRun.delegatedEngine, 'axe-core');
    }));

  test('the metrics accept the closed seal and the dataset it covers', () =>
    withDir((dir) => {
      const { closedPath, datasetPath } = run(dir);
      const r = cli('cli-metrics.mjs', [datasetPath, '--seal', closedPath]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, /seal: closed, and bound to this dataset/);
      const report = JSON.parse(r.stdout);
      assert.ok(report.stageOne.counts.tp >= 1);
    }));

  test('delegated findings are present, counted, and unscored', () =>
    withDir((dir) => {
      const { joined, datasetPath, reportsPath } = run(dir);
      assert.equal(joined.code, 0, joined.stderr);

      // synthetic-b has an input with no label, which axe-core's `label` rule reports.
      const reports = JSON.parse(readFileSync(reportsPath, 'utf8'));
      const delegated = Object.values(reports).flatMap((r) => r.delegated?.findings ?? []);
      assert.ok(delegated.length > 0, 'a zero here would mean the provider was never asked');
      assert.ok(delegated.some((f) => f.ruleId === 'label'));
      for (const r of Object.values(reports)) {
        if (r.delegated) assert.equal(r.delegated.scored, false);
      }

      const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
      const inDataset = dataset.pages.flatMap((p) => p.delegatedFindings ?? []);
      assert.ok(inDataset.length > 0, 'the joined dataset must carry them through');

      assert.match(joined.stdout, /delegated:\s+[1-9]/);
    }));

  test('delegated findings stay out of the accuracy figures', () =>
    withDir((dir) => {
      const { closedPath, datasetPath } = run(dir);
      const report = JSON.parse(cli('cli-metrics.mjs', [datasetPath, '--seal', closedPath]).stdout);
      assert.equal(report.unscored.scored, false);
      assert.ok(report.unscored.delegated.total > 0, 'they are reported');
      const scored = report.stageOne.counts;
      assert.equal(scored.tp + scored.fp + scored.fn + scored.tn, 4, 'four supported inputs, none added');
    }));
});
