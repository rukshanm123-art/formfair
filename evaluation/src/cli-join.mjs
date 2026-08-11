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

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { buildDataset } from './join.mjs';
import { loadInstrument, instrumentDirFromEnv } from './instrument-ref.mjs';
import { validateDataset } from './schema.mjs';
import { verifySeal, sealedFileMatches } from './seal.mjs';

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

if (!sealPath || !capturesDir || !inventoryPath || !truthPath || !outPath || !reportsOut || !closedSealOut) {
  fail(
    'usage: node src/cli-join.mjs --seal <pre-run-seal> --captures <dir> --inventory <file>\n' +
      '         --truth <file> --out <dataset> --reports <file> --closed-seal <file>\n\n' +
      'The seal is required. FormFair must not run before the annotations are sealed.'
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

const reports = {};
const pages = [];
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

  const detected = instrument.formfair.findNameControls(html);
  const report = provider
    ? instrument.formfair.toJsonWithDelegated(await instrument.formfair.analyseWith(html, provider))
    : instrument.formfair.toJson(instrument.formfair.analyse(html));

  reports[inventory.pageId] = report;
  pages.push({ inventory, truth: truthFile.pages?.[inventory.pageId] ?? {}, detected, report });
}

const reportsText = JSON.stringify(reports, null, 2) + '\n';
writeFileSync(reportsOut, reportsText);

// 4. Hashes come from the sealed files themselves, never from a caller-supplied list.
const hashOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sealedPath = (key) => resolve(sealBase, manifest.files[key].path);
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
if (problems.length > 0) fail('the join found inconsistencies and produced no dataset:', problems);

const { valid, problems: schemaProblems } = validateDataset(dataset);
if (!valid) fail('the joined dataset does not match the frozen schema:', schemaProblems);

const datasetText = JSON.stringify(dataset, null, 2) + '\n';
writeFileSync(outPath, datasetText);
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
    inventorySha256: hashes.inventory,
    groundTruthSha256: hashes.groundTruth,
    reportsSha256,
    datasetSha256,
    preRunSealSha256: hashOf(sealPath),
  },
};
if (existsSync(closedSealOut) && resolve(closedSealOut) === resolve(sealPath)) {
  fail('the closed seal must be a separate file; overwriting the pre-run seal would destroy it');
}
writeFileSync(closedSealOut, JSON.stringify(closed, null, 2) + '\n');

const delegatedCount = Object.values(reports).reduce((n, r) => n + (r.delegated?.findings?.length ?? 0), 0);
console.log(`instrument:  ${instrument.tag} (${instrument.commit.slice(0, 12)})`);
console.log(`pages:       ${dataset.pages.length}`);
console.log(`delegated:   ${delegatedCount} findings (reported, never scored)`);
console.log(`reports:     ${reportsOut}  ${reportsSha256}`);
console.log(`dataset:     ${outPath}  ${datasetSha256}`);
console.log(`closed seal: ${closedSealOut}`);
