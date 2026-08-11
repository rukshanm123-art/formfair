#!/usr/bin/env node
/**
 * Runs the frozen instrument over the captured pages and joins the result with the
 * inventory and the adjudicated ground truth into the dataset the metrics read.
 *
 *   node src/cli-join.mjs --captures data/captures --inventory data/inventory.json \
 *     --truth data/ground-truth.json --out data/dataset.json \
 *     --reports data/reports.json --hashes data/hashes.json
 *
 * This is the step that must not happen before the seal closes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { buildDataset } from './join.mjs';
import { loadInstrument, instrumentDirFromEnv } from './instrument-ref.mjs';
import { validateDataset } from './schema.mjs';

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

const capturesDir = flag('--captures');
const inventoryPath = flag('--inventory');
const truthPath = flag('--truth');
const outPath = flag('--out');
const reportsOut = flag('--reports');
const hashesPath = flag('--hashes');

if (!capturesDir || !inventoryPath || !truthPath || !outPath || !reportsOut) {
  fail(
    'usage: node src/cli-join.mjs --captures <dir> --inventory <file> --truth <file> ' +
      '--out <file> --reports <file> [--hashes <file>]'
  );
}

const instrumentDir = instrumentDirFromEnv();
if (!instrumentDir) fail('FORMFAIR_INSTRUMENT_DIR is not set. Run evaluation/scripts/setup-instrument.sh.');

let instrument;
try {
  instrument = await loadInstrument(instrumentDir);
} catch (error) {
  fail(error.message);
}

const inventoryFile = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const truthFile = JSON.parse(readFileSync(truthPath, 'utf8'));
const hashes = hashesPath ? JSON.parse(readFileSync(hashesPath, 'utf8')) : {};

const reports = {};
const pages = inventoryFile.pages.map((inventory) => {
  const html = readFileSync(join(capturesDir, `${inventory.pageId}.html`), 'utf8');
  const actual = createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex');
  if (actual !== inventory.htmlSha256) {
    fail(
      `${inventory.pageId}: the captured file hashes to ${actual} but the inventory records ` +
        `${inventory.htmlSha256}. The bytes analysed are not the bytes annotated.`
    );
  }
  const detected = instrument.formfair.findNameControls(html);
  const report = instrument.formfair.toJson(instrument.formfair.analyse(html));
  reports[inventory.pageId] = report;
  return { inventory, truth: truthFile[inventory.pageId] ?? {}, detected, report };
});

const reportsText = JSON.stringify(reports, null, 2) + '\n';
writeFileSync(reportsOut, reportsText);
hashes.reports = createHash('sha256').update(reportsText).digest('hex');
hashes.inventory = createHash('sha256').update(readFileSync(inventoryPath)).digest('hex');

const { dataset, problems } = buildDataset({ pages, hashes });
if (problems.length > 0) fail('the join found inconsistencies and produced no dataset:', problems);

const { valid, problems: schemaProblems } = validateDataset(dataset);
if (!valid) fail('the joined dataset does not match the frozen schema:', schemaProblems);

const text = JSON.stringify(dataset, null, 2) + '\n';
writeFileSync(outPath, text);

console.log(`instrument: ${instrument.tag} (${instrument.commit.slice(0, 12)})`);
console.log(`pages:      ${dataset.pages.length}`);
console.log(`reports:    ${reportsOut}  sha256 ${hashes.reports}`);
console.log(`dataset:    ${outPath}  sha256 ${createHash('sha256').update(text).digest('hex')}`);
