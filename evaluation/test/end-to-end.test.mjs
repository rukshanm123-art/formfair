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
  const agreement = cli('cli-agreement.mjs', [
    '--a', aPath, '--b', bPath, '--inventory', inventoryPath, '--out', kappaPath,
  ]);
  assert.equal(agreement.code, 0, agreement.stderr);

  const truthPath = join(dir, 'ground-truth.json');
  const gt = cli('cli-ground-truth.mjs', [
    '--a', aPath, '--b', bPath, '--adjudication', adjPath, '--inventory', inventoryPath, '--out', truthPath,
  ]);

  return {
    dir, captures, inventoryPath, aPath, bPath, adjPath, kappaPath, truthPath,
    groundTruth: gt, runs: join(dir, 'runs'),
  };
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
      const again = cli('cli-ground-truth.mjs', [
        '--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath,
        '--inventory', p.inventoryPath, '--out', p.truthPath,
      ]);
      assert.equal(again.code, 0, again.stderr);
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
        '--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath,
        '--inventory', p.inventoryPath, '--out', join(dir, 'x.json'),
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
      assert.equal(existsSync(join(dir, 'x.json')), false, 'nothing is written on refusal');
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
    '--run-records', p.runs,
  ];

  test('without --seal it will not start', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const r = cli('cli-join.mjs', [
        '--captures', p.captures, '--inventory', p.inventoryPath, '--truth', p.truthPath,
        '--out', join(dir, 'd.json'), '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
        '--run-records', p.runs,
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
      '--run-records', p.runs,
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
        '--run-records', p.runs,
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

describe('a pre-run seal is good for exactly one run', () => {
  const args = (p, sealPath, suffix = '') => [
    '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath, '--truth', p.truthPath,
    '--out', join(p.dir, `dataset${suffix}.json`),
    '--reports', join(p.dir, `reports${suffix}.json`),
    '--closed-seal', join(p.dir, `seal.closed${suffix}.json`),
    '--run-records', p.runs,
  ];

  test('a second run against the same seal is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      assert.equal(cli('cli-join.mjs', args(p, sealPath)).code, 0);

      const second = cli('cli-join.mjs', args(p, sealPath, '-2'));
      assert.equal(second.code, 1, 'the seal must not be reusable');
      assert.match(second.stderr, /already been used for a run/);
      assert.equal(existsSync(join(dir, 'dataset-2.json')), false, 'no second dataset');
      assert.equal(existsSync(join(dir, 'seal.closed-2.json')), false, 'no second closed seal');
    }));

  test('the claim is written before the analyser runs', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      cli('cli-join.mjs', args(p, sealPath));
      const sealSha = sha256(readFileSync(sealPath, 'utf8'));
      const lock = JSON.parse(readFileSync(join(p.runs, `${sealSha}.json`), 'utf8'));
      assert.equal(lock.status, 'completed');
      assert.equal(lock.sealSha256, sealSha, 'the record is keyed by the seal contents');
      assert.equal(lock.instrumentCommit.length, 40);
      assert.ok(lock.startedAt && lock.completedAt);
    }));

  test('the same seal under a different filename is still refused', () =>
    withDir((dir) => {
      // Keying the record on the filename secured nothing: a copy under another name
      // produced a different lock path and a second run of the same evaluation.
      const p = prepare(dir);
      const sealPath = seal(p);
      assert.equal(cli('cli-join.mjs', args(p, sealPath)).code, 0);

      const copy = join(dir, 'seal.copy.json');
      writeFileSync(copy, readFileSync(sealPath, 'utf8'));
      const second = cli('cli-join.mjs', args(p, copy, '-copy'));
      assert.equal(second.code, 1, 'identical bytes under another name must not run again');
      assert.match(second.stderr, /keyed by the seal's contents/);
      assert.equal(existsSync(join(dir, 'dataset-copy.json')), false);
    }));

  test('a failed run is preserved, and blocks a silent retry', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const sealSha = sha256(readFileSync(sealPath, 'utf8'));
      mkdirSync(p.runs, { recursive: true });
      writeFileSync(
        join(p.runs, `${sealSha}.json`),
        JSON.stringify({ status: 'failed', reason: 'synthetic failure', startedAt: '2026-09-01T00:00:00Z' }, null, 2)
      );

      const r = cli('cli-join.mjs', args(p, sealPath));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /That run failed/);
      assert.match(r.stderr, /Delete the lock deliberately/);
    }));
});

describe('output paths cannot destroy the evidence', () => {
  const base = (p, sealPath) => [
    '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath,
    '--truth', p.truthPath, '--run-records', p.runs,
  ];

  test('an output pointing at the seal is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const before = readFileSync(sealPath, 'utf8');
      const r = cli('cli-join.mjs', [
        ...base(p, sealPath),
        '--out', sealPath, '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /same path/);
      assert.equal(readFileSync(sealPath, 'utf8'), before, 'the seal is untouched');
    }));

  test('an output pointing at the sealed ground truth is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const before = readFileSync(p.truthPath, 'utf8');
      const r = cli('cli-join.mjs', [
        ...base(p, sealPath),
        '--out', join(dir, 'd.json'), '--reports', p.truthPath, '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /same path/);
      assert.equal(readFileSync(p.truthPath, 'utf8'), before);
    }));

  test('two outputs pointing at each other are refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const same = join(dir, 'both.json');
      const r = cli('cli-join.mjs', [
        ...base(p, sealPath), '--out', same, '--reports', same, '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /same path/);
    }));

  test('an output inside the captures directory is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const r = cli('cli-join.mjs', [
        ...base(p, sealPath),
        '--out', join(p.captures, 'd.json'), '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /inside the captures directory/);
    }));

  test('an output that already exists is refused rather than overwritten', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const existing = join(dir, 'reports.json');
      writeFileSync(existing, 'previous results\n');
      const r = cli('cli-join.mjs', [
        ...base(p, sealPath),
        '--out', join(dir, 'd.json'), '--reports', existing, '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /already exists/);
      assert.equal(readFileSync(existing, 'utf8'), 'previous results\n');
    }));
});

describe('the sealed agreement must be derived too', () => {
  test('a hand-written kappa file sealed alongside the annotations is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      writeFileSync(p.kappaPath, JSON.stringify({ stageOne: { kappa: 0.99 } }, null, 2) + '\n');
      const sealPath = seal(p);
      const r = cli('cli-join.mjs', [
        '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath,
        '--truth', p.truthPath, '--run-records', p.runs,
        '--out', join(dir, 'd.json'), '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /not what the sealed annotations produce/);
      assert.equal(existsSync(join(dir, 'r.json')), false, 'nothing written');
    }));

  test('agreement covers stage one, every rule and the pooled pairs', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const kappa = JSON.parse(readFileSync(p.kappaPath, 'utf8'));
      assert.ok('estimable' in kappa.stageOne);
      for (const rule of ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05']) {
        assert.ok(kappa.perRule[rule], `${rule} is present`);
        assert.ok('percentageAgreement' in kappa.perRule[rule]);
        assert.ok('counts' in kappa.perRule[rule]);
      }
      assert.ok('estimable' in kappa.pooled);
      assert.match(kappa.perRuleBasis, /both annotators independently labelled/);
      assert.equal(typeof kappa.stageOneDisagreements, 'number');
      assert.equal(typeof kappa.controlsInPerRuleBasis, 'number');
    }));

  test('a stage-one disagreement is excluded from per-rule agreement, and counted', () =>
    withDir((dir) => {
      const p = prepare(dir);
      // Flip one stage-one label so the annotators disagree about what the control is.
      const b = JSON.parse(readFileSync(p.bPath, 'utf8'));
      b.pages[0].controls[0].stageOne.label = 'negative';
      delete b.pages[0].controls[0].rules;
      writeFileSync(p.bPath, JSON.stringify(b, null, 2));

      const out = join(dir, 'kappa2.json');
      const r = cli('cli-agreement.mjs', ['--a', p.aPath, '--b', p.bPath, '--inventory', p.inventoryPath, '--out', out]);
      assert.equal(r.code, 0, r.stderr);
      const kappa = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(kappa.stageOneDisagreements, 1);
      // The disputed control contributes to stage one but to no per-rule figure: the
      // annotator who called it a non-name never formed a view on FF-01 for it.
      assert.equal(kappa.stageOne.counts.n, JSON.parse(readFileSync(p.kappaPath, 'utf8')).stageOne.counts.n);
      assert.ok(kappa.controlsInPerRuleBasis < JSON.parse(readFileSync(p.kappaPath, 'utf8')).controlsInPerRuleBasis);
    }));

  test('agreement is deterministic', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const again = join(dir, 'kappa-again.json');
      cli('cli-agreement.mjs', ['--a', p.aPath, '--b', p.bPath, '--inventory', p.inventoryPath, '--out', again]);
      assert.equal(readFileSync(again, 'utf8'), readFileSync(p.kappaPath, 'utf8'));
    }));
});

describe('delegated analysis cannot be skipped in an official run', () => {
  test('--no-delegated alone is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const r = cli('cli-join.mjs', [
        '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath, '--truth', p.truthPath,
        '--out', join(dir, 'd.json'), '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
        '--no-delegated',
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /available only together with --synthetic/);
      assert.equal(existsSync(join(dir, 'c.json')), false, 'no closed seal may be produced');
    }));

  test('--no-delegated with --synthetic marks everything it produces', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const sealPath = seal(p);
      const datasetPath = join(dir, 'd.json');
      const closedPath = join(dir, 'c.json');
      const r = cli('cli-join.mjs', [
        '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath, '--truth', p.truthPath,
        '--out', datasetPath, '--reports', join(dir, 'r.json'), '--closed-seal', closedPath,
        '--run-records', p.runs, '--no-delegated', '--synthetic',
      ]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(JSON.parse(readFileSync(datasetPath, 'utf8')).synthetic, true);
      assert.equal(JSON.parse(readFileSync(closedPath, 'utf8')).synthetic, true);

      // And the metrics refuse it through the sealed path, so it cannot become a figure.
      const m = cli('cli-metrics.mjs', [datasetPath, '--seal', closedPath]);
      assert.equal(m.code, 1);
      assert.match(m.stderr, /marked synthetic cannot be scored through the sealed path/);
    }));
});

describe('the ground truth must be derived from the sealed inputs', () => {
  test('a hand-written ground truth sealed alongside the annotations is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      // Flip a label, then seal that file as if it were derived.
      const truth = JSON.parse(readFileSync(p.truthPath, 'utf8'));
      const page = truth.pages['synthetic-a'];
      const first = Object.keys(page)[0];
      page[first].isNameControl = !page[first].isNameControl;
      delete page[first].rules;
      writeFileSync(p.truthPath, JSON.stringify(truth, null, 2) + '\n');
      const sealPath = seal(p);

      const r = cli('cli-join.mjs', [
        '--seal', sealPath, '--captures', p.captures, '--inventory', p.inventoryPath, '--truth', p.truthPath,
        '--out', join(dir, 'd.json'), '--reports', join(dir, 'r.json'), '--closed-seal', join(dir, 'c.json'),
        '--run-records', p.runs,
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /not what the sealed annotations and adjudication derive/);
      assert.equal(existsSync(join(dir, 'r.json')), false, 'no report written');
      assert.equal(existsSync(`${sealPath}.run`), false, 'and no run was claimed');
    }));

  test('a page in the inventory that neither annotator opened is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      for (const path of [p.aPath, p.bPath]) {
        const file = JSON.parse(readFileSync(path, 'utf8'));
        file.pages = file.pages.filter((page) => page.pageId !== 'synthetic-b');
        writeFileSync(path, JSON.stringify(file, null, 2));
      }
      const r = cli('cli-ground-truth.mjs', [
        '--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath,
        '--inventory', p.inventoryPath, '--out', join(dir, 'x.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /not annotated by both annotators/);
    }));

  test('a control labelled that is not in the inventory is refused', () =>
    withDir((dir) => {
      const p = prepare(dir);
      for (const path of [p.aPath, p.bPath]) {
        const file = JSON.parse(readFileSync(path, 'utf8'));
        file.pages[0].controls.push({
          controlId: 'invented#c999',
          inputType: 'text',
          stageOne: { label: 'positive', reason: 'r', evidence: 'e' },
          rules: Object.fromEntries(['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'].map((r) => [r, { label: 'negative', reason: 'r', evidence: 'e' }])),
        });
        writeFileSync(path, JSON.stringify(file, null, 2));
      }
      const r = cli('cli-ground-truth.mjs', [
        '--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath,
        '--inventory', p.inventoryPath, '--out', join(dir, 'x.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /absent from the frozen inventory/);
    }));

  test('the inventory is not optional', () =>
    withDir((dir) => {
      const p = prepare(dir);
      const r = cli('cli-ground-truth.mjs', [
        '--a', p.aPath, '--b', p.bPath, '--adjudication', p.adjPath, '--out', join(dir, 'x.json'),
      ]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /inventory is required/);
    }));
});
