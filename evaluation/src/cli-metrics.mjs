#!/usr/bin/env node
/**
 * Protocol section 9. Computes the metrics from a joined dataset.
 *
 *   node src/cli-metrics.mjs <dataset.json> [--out report.json] [--seal data/seal.json]
 *
 * The dataset is validated before anything is computed. Scoring a malformed dataset
 * would produce numbers that look like results, and a figure that is wrong is worse
 * than a run that refused to start.
 *
 * With --seal, the protocol section 10 gate is checked first: metrics are computed after
 * FormFair has run, so the seal should already be closed, and a metrics run against an
 * unsealed evaluation is a sign the ordering went wrong.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { report } from './metrics.mjs';
import { validateDataset } from './schema.mjs';
import { verifySeal } from './seal.mjs';

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
const datasetPath = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);

if (!datasetPath) {
  fail('usage: node src/cli-metrics.mjs <dataset.json> [--out report.json] [--seal data/seal.json]');
}

const sealPath = flag('--seal');
if (sealPath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(sealPath, 'utf8'));
  } catch (error) {
    fail(`cannot read the seal manifest at ${sealPath}: ${error.message}`);
  }
  const base = dirname(sealPath);
  const { sealed, failures } = verifySeal(manifest, (p) => resolve(base, p));
  // A closed seal records the run, which verifySeal reports as a failure when sealing.
  // Here that is the expected state, so only the other faults matter.
  const real = failures.filter((f) => !f.includes('seal is closed'));
  if (!sealed && real.length > 0) fail('seal is not valid, so these metrics would not be trustworthy:', real);
}

let dataset;
try {
  dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
} catch (error) {
  fail(`cannot read the dataset at ${datasetPath}: ${error.message}`);
}

const { valid, problems } = validateDataset(dataset);
if (!valid) fail(`the dataset at ${datasetPath} does not match the frozen schema:`, problems);

const result = report(dataset.pages);
const output = JSON.stringify(result, null, 2) + '\n';

const outPath = flag('--out');
if (outPath) {
  writeFileSync(outPath, output);
  console.log(`written: ${outPath}`);
} else {
  process.stdout.write(output);
}

const pct = (r) => (r?.estimable ? `${(r.point * 100).toFixed(1)}%` : `not estimable (${r?.reason ?? 'n/a'})`);
console.error(`pages:            ${dataset.pages.length}`);
console.error(`stage one recall: ${pct(result.stageOne.recall)}`);
console.error(`end to end F1:    ${result.micro.endToEnd.f1?.estimable ? result.micro.endToEnd.f1.point.toFixed(3) : 'not estimable'}`);
