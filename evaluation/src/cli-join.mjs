#!/usr/bin/env node
/**
 * Runs the frozen instrument over the captured pages and joins the result into the
 * dataset the metrics read.
 *
 *   node src/cli-join.mjs --seal data/seal.pre-run.json --captures data/captures \
 *     --inventory data/inventory.json --truth data/ground-truth.json \
 *     --out data/dataset.json --reports data/reports.json \
 *     --closed-seal data/seal.closed.json
 *
 * This is the command that runs FormFair, so this is where protocol section 10 has to be
 * enforced. The seal is not optional: without it, the analyser could be run before the
 * annotations were locked, which is the leakage the section exists to prevent.
 *
 * The inventory and the ground truth are checked against the seal by hash, not by path.
 * Sealing one file and analysing another is the obvious way round a seal.
 *
 * The closed seal is written to a separate file. Overwriting the pre-run seal would
 * destroy the evidence that annotation finished before the tool was seen.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { buildDataset } from './join.mjs';
import { loadInstrument, instrumentDirFromEnv } from './instrument-ref.mjs';
import { validateDataset, validateAnnotation, validateAdjudication } from './schema.mjs';
import { verifySeal, sealedFileMatches } from './seal.mjs';
import { buildGroundTruth } from './ground-truth.mjs';
import { computeAgreement } from './agreement.mjs';
import { claimRun, completeRun, failRun, describeRefusal } from './run-lock.mjs';

function fail(message, details = []) {
  console.error(message);
  for (const d of details) console.error(`  - ${d}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const sealPath = flag('--seal');
const capturesDir = flag('--captures');
const inventoryPath = flag('--inventory');
const truthPath = flag('--truth');
const outPath = flag('--out');
const reportsOut = flag('--reports');
const closedSealOut = flag('--closed-seal');
const noDelegated = args.includes('--no-delegated');
const synthetic = args.includes('--synthetic');
/**
 * One fixed place for run records. A caller-chosen directory would undo the whole point:
 * an official run could use one directory and the identical seal could then be run again
 * pointing somewhere else. The override exists only so the synthetic fixtures can be
 * isolated from each other, and it is refused without --synthetic.
 */
const OFFICIAL_RUN_RECORDS = join(dirname(new URL(import.meta.url).pathname), '..', 'data', 'runs');
const runRecordsOverride = flag('--run-records');

if (!sealPath || !capturesDir || !inventoryPath || !truthPath || !outPath || !reportsOut || !closedSealOut) {
  fail(
    'usage: node src/cli-join.mjs --seal <pre-run-seal> --captures <dir> --inventory <file>\n' +
      '         --truth <file> --out <dataset> --reports <file> --closed-seal <file>\n\n' +
      'The seal is required. FormFair must not run before the annotations are sealed.'
  );
}

if (runRecordsOverride && !synthetic) {
  fail(
    '--run-records is available only together with --synthetic.\n' +
      'An official run keeps its record in one fixed place. Letting the caller choose\n' +
      'would allow the same seal to be run again against a different directory, which is\n' +
      'exactly what the one-run record exists to prevent.'
  );
}
const runRecordsDir = runRecordsOverride ?? OFFICIAL_RUN_RECORDS;

// Output paths must not be able to destroy the evidence. Every input and output is
// resolved and compared: an --out or --reports pointing at the seal, the inventory, the
// ground truth, an annotation, a capture, or at each other would overwrite the material
// the figures rest on, and the seal would then verify against whatever replaced it.
const inputs = {
  '--seal': sealPath,
  '--captures': capturesDir,
  '--inventory': inventoryPath,
  '--truth': truthPath,
};
const outputs = { '--out': outPath, '--reports': reportsOut, '--closed-seal': closedSealOut };

const seen = new Map();
for (const [flagName, path] of Object.entries({ ...inputs, ...outputs })) {
  const key = resolve(path);
  if (seen.has(key)) {
    fail(`${flagName} and ${seen.get(key)} are the same path (${key}). Every path must be distinct.`);
  }
  seen.set(key, flagName);
}
for (const [flagName, path] of Object.entries(outputs)) {
  if (existsSync(path)) {
    fail(
      `${flagName} already exists at ${path}.\n` +
        'Outputs are never overwritten: a rerun that quietly replaced a previous result ' +
        'would leave no trace that there had been one.'
    );
  }
  const within = resolve(path).startsWith(resolve(capturesDir) + '/');
  if (within) fail(`${flagName} is inside the captures directory, which holds sealed evidence`);
}

// A run without the delegated engine is not the evaluation the protocol describes, so it
// cannot produce official output. The bypass exists to keep the synthetic fixtures fast.
if (noDelegated && !synthetic) {
  fail(
    '--no-delegated would skip the delegated accessibility checks the protocol reports\n' +
      'separately, so the run would not be the evaluation the protocol describes.\n' +
      'It is available only together with --synthetic, which marks everything it produces\n' +
      'as synthetic and unusable for official figures.'
  );
}

// 1. The pre-run seal must be valid, and must NOT already record a run.
let manifest;
try {
  manifest = JSON.parse(readFileSync(sealPath, 'utf8'));
} catch (error) {
  fail(`cannot read the seal manifest at ${sealPath}: ${error.message}`);
}
const sealBase = dirname(sealPath);
const { sealed, failures } = verifySeal(manifest, (p) => resolve(sealBase, p));
if (!sealed) {
  fail(
    'the pre-run seal is not valid, so FormFair must not be run:',
    failures.concat(
      failures.some((f) => f.includes('seal is closed'))
        ? ['This evaluation has already been run. A second run would be post hoc.']
        : []
    )
  );
}

// 2. The files handed to this command must be the sealed ones.
const inventoryCheck = sealedFileMatches(manifest, 'inventory', inventoryPath);
if (!inventoryCheck.ok) fail('the inventory supplied is not the sealed inventory:', [inventoryCheck.reason]);
const truthCheck = sealedFileMatches(manifest, 'groundTruth', truthPath);
if (!truthCheck.ok) fail('the ground truth supplied is not the sealed ground truth:', [truthCheck.reason]);

const instrumentDir = instrumentDirFromEnv();
if (!instrumentDir) fail('FORMFAIR_INSTRUMENT_DIR is not set. Run evaluation/scripts/setup-instrument.sh.');

let instrument;
try {
  instrument = await loadInstrument(instrumentDir);
} catch (error) {
  fail(error.message);
}

// 3. Delegated accessibility checks come from the frozen instrument's pinned axe-core.
let provider = null;
if (!noDelegated) {
  try {
    const node = await import(join(instrument.dir, 'dist', 'node.js'));
    provider = node.axeProvider();
  } catch (error) {
    fail(
      'could not load the delegated provider from the frozen instrument. The protocol ' +
        'reports delegated findings separately, so a run without them is not the ' +
        'evaluation the protocol describes.\n  ' +
        error.message
    );
  }
}

const inventoryFile = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const truthFile = JSON.parse(readFileSync(truthPath, 'utf8'));

const hashOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sealedPath = (key) => resolve(sealBase, manifest.files[key].path);

// PREFLIGHT. Everything checkable is checked before the analyser is touched, so a fault
// in the material cannot be discovered halfway through a run that has already written
// reports. Nothing below this point writes anything until the join has succeeded.

// The sealed files must still satisfy the schemas they were written against. Deriving
// the agreement and the ground truth reads only the labels, so reasons, evidence and
// input types could be stripped after derivation, resealed, and still regenerate
// identically. Revalidating here is what closes that.
const sealedAnnotationA = JSON.parse(readFileSync(sealedPath('annotatorA'), 'utf8'));
const sealedAnnotationB = JSON.parse(readFileSync(sealedPath('annotatorB'), 'utf8'));
const sealedAdjudication = JSON.parse(readFileSync(sealedPath('adjudication'), 'utf8'));

for (const [file, name] of [[sealedAnnotationA, 'annotatorA'], [sealedAnnotationB, 'annotatorB']]) {
  const { valid, problems } = validateAnnotation(file);
  if (!valid) fail(`the sealed ${name} no longer matches the frozen annotation schema:`, problems);
}
{
  const { valid, problems } = validateAdjudication(sealedAdjudication);
  if (!valid) fail('the sealed adjudication no longer matches the frozen schema:', problems);
}

// The sealed ground truth must be exactly what the sealed annotations and adjudication
// produce. Sealing a file does not make it derived: without regenerating it, an arbitrary
// ground truth could be sealed alongside annotations that do not imply it.
const regenerated = buildGroundTruth({
  annotationA: sealedAnnotationA,
  annotationB: sealedAnnotationB,
  adjudication: sealedAdjudication,
  inventory: inventoryFile,
});
if (!regenerated.groundTruth) {
  fail('the sealed annotations and adjudication do not derive a ground truth:', regenerated.problems);
}
if (regenerated.text !== readFileSync(truthPath, 'utf8')) {
  fail(
    'the sealed ground truth is not what the sealed annotations and adjudication derive.',
    [
      `derived:  ${regenerated.sha256}`,
      `sealed:   ${truthCheck.sha256}`,
      'A ground truth must be produced by cli-ground-truth from the sealed inputs, not ' +
        'written by hand and sealed alongside them.',
    ]
  );
}

// The sealed agreement must be what the sealed annotations produce, for the same reason
// as the ground truth: sealing a file does not make it derived.
const regeneratedAgreement = computeAgreement({
  annotationA: sealedAnnotationA,
  annotationB: sealedAnnotationB,
  inventory: inventoryFile,
});
if (!regeneratedAgreement.agreement) {
  fail('the sealed annotations do not produce an agreement record:', regeneratedAgreement.problems);
}
if (regeneratedAgreement.text !== readFileSync(sealedPath('kappa'), 'utf8')) {
  fail('the sealed agreement is not what the sealed annotations produce.', [
    `derived: ${regeneratedAgreement.sha256}`,
    `sealed:  ${hashOf(sealedPath('kappa'))}`,
    'It must be produced by cli-agreement from the sealed annotations and inventory.',
  ]);
}

// Every capture must exist and be the bytes the inventory records.
const capturesFor = [];
for (const inventory of inventoryFile.pages) {
  const capture = join(capturesDir, `${inventory.pageId}.html`);
  if (!existsSync(capture)) fail(`${inventory.pageId}: no capture at ${capture}`);
  const html = readFileSync(capture, 'utf8');
  const actual = createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex');
  if (actual !== inventory.htmlSha256) {
    fail(
      `${inventory.pageId}: the captured file hashes to ${actual} but the sealed inventory ` +
        `records ${inventory.htmlSha256}. The bytes analysed are not the bytes annotated.`
    );
  }
  capturesFor.push({ inventory, html });
}

// The ground truth must cover exactly the inventory.
for (const { inventory } of capturesFor) {
  const truthPage = truthFile.pages?.[inventory.pageId];
  if (!truthPage) fail(`${inventory.pageId}: the sealed ground truth has no entry for this page`);
  for (const control of inventory.controls) {
    if (!(control.controlId in truthPage)) {
      fail(`${inventory.pageId}/${control.controlId}: in the inventory but not in the ground truth`);
    }
  }
  for (const controlId of Object.keys(truthPage)) {
    if (!inventory.controls.some((c) => c.controlId === controlId)) {
      fail(`${inventory.pageId}/${controlId}: in the ground truth but not in the inventory`);
    }
  }
}

// CLAIM. Exclusive and durable, written before the analyser runs.
const preRunSealSha256 = hashOf(sealPath);
const claim = claimRun(runRecordsDir, preRunSealSha256, {
  startedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  instrument: instrument.tag,
  instrumentCommit: instrument.commit,
  synthetic,
  outputs: { reports: reportsOut, dataset: outPath, closedSeal: closedSealOut },
});
if (!claim.claimed) fail(describeRefusal(claim.path, claim.existing));

const abort = (message, details = []) => {
  failRun(claim.path, message, { details, failedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  fail(`${message}\nThe run is recorded as failed at ${claim.path} and will not repeat silently.`, details);
};

// ANALYSE.
const reports = {};
const pages = [];
for (const { inventory, html } of capturesFor) {
  const detected = instrument.formfair.findNameControls(html);
  const report = provider
    ? instrument.formfair.toJsonWithDelegated(await instrument.formfair.analyseWith(html, provider))
    : instrument.formfair.toJson(instrument.formfair.analyse(html));
  reports[inventory.pageId] = report;
  pages.push({ inventory, truth: truthFile.pages?.[inventory.pageId] ?? {}, detected, report });
}

const reportsText = JSON.stringify(reports, null, 2) + '\n';

// Hashes come from the sealed files themselves, never from a caller-supplied list.
const hashes = {
  inventory: inventoryCheck.sha256,
  groundTruth: truthCheck.sha256,
  annotationA: hashOf(sealedPath('annotatorA')),
  annotationB: hashOf(sealedPath('annotatorB')),
  kappa: hashOf(sealedPath('kappa')),
  adjudication: hashOf(sealedPath('adjudication')),
  reports: createHash('sha256').update(Buffer.from(reportsText, 'utf8')).digest('hex'),
};

const { dataset, problems } = buildDataset({ pages, hashes });
if (problems.length > 0) abort('the join found inconsistencies, so nothing was written:', problems);
if (synthetic) dataset.synthetic = true;

const { valid, problems: schemaProblems } = validateDataset(dataset);
if (!valid) abort('the joined dataset does not match the frozen schema, so nothing was written:', schemaProblems);

// Only now is anything written.
writeFileSync(reportsOut, reportsText, { flag: 'wx' });
const datasetText = JSON.stringify(dataset, null, 2) + '\n';
writeFileSync(outPath, datasetText, { flag: 'wx' });
const datasetSha256 = createHash('sha256').update(Buffer.from(datasetText, 'utf8')).digest('hex');
const reportsSha256 = hashes.reports;

// 5. A separate closed seal. The pre-run seal is left exactly as it was.
const relativeTo = dirname(closedSealOut);
const rel = (path) => (path.startsWith(relativeTo) ? path.slice(relativeTo.length + 1) : path);
const closed = {
  ...manifest,
  files: {
    ...manifest.files,
    reports: { path: rel(reportsOut), sha256: reportsSha256 },
    dataset: { path: rel(outPath), sha256: datasetSha256 },
  },
  formfairRun: {
    runAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    instrument: instrument.tag,
    instrumentCommit: instrument.commit,
    delegatedEngine: provider ? 'axe-core' : null,
    synthetic,
    inventorySha256: hashes.inventory,
    groundTruthSha256: hashes.groundTruth,
    reportsSha256,
    datasetSha256,
    preRunSealSha256,
  },
};
if (existsSync(closedSealOut) && resolve(closedSealOut) === resolve(sealPath)) {
  fail('the closed seal must be a separate file; overwriting the pre-run seal would destroy it');
}
if (synthetic) closed.synthetic = true;
writeFileSync(closedSealOut, JSON.stringify(closed, null, 2) + '\n', { flag: 'wx' });

completeRun(claim.path, {
  completedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  instrument: instrument.tag,
  instrumentCommit: instrument.commit,
  synthetic,
  reportsSha256,
  datasetSha256,
  closedSealSha256: hashOf(closedSealOut),
});

const delegatedCount = Object.values(reports).reduce((n, r) => n + (r.delegated?.findings?.length ?? 0), 0);
console.log(`instrument:  ${instrument.tag} (${instrument.commit.slice(0, 12)})`);
console.log(`pages:       ${dataset.pages.length}`);
console.log(`delegated:   ${delegatedCount} findings (reported, never scored)`);
console.log(`reports:     ${reportsOut}  ${reportsSha256}`);
console.log(`dataset:     ${outPath}  ${datasetSha256}`);
console.log(`closed seal: ${closedSealOut}`);
