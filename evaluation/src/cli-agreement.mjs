#!/usr/bin/env node
/**
 * Protocol section 8, step 1. Derives agreement from both annotators' original
 * independent labels, before adjudication.
 *
 *   node src/cli-agreement.mjs --a data/annotatorA.json --b data/annotatorB.json \
 *     --inventory data/inventory.json --out data/kappa.json
 *
 * Run before sealing. The output is one of the files the pre-run seal covers, and the
 * join regenerates it from the sealed annotations and compares.
 *
 * A figure below the protocol's 0.70 threshold is reported, not suppressed. The protocol
 * requires a low held-out kappa to be published, so this exits 0 and says so.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { computeAgreement, belowThreshold, REQUIRED_KAPPA } from './agreement.mjs';
import { validateAnnotation } from './schema.mjs';

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

const aPath = flag('--a');
const bPath = flag('--b');
const invPath = flag('--inventory');
const outPath = flag('--out');

if (!aPath || !bPath || !invPath || !outPath) {
  fail(
    'usage: node src/cli-agreement.mjs --a <file> --b <file> --inventory <file> --out <file>\n\n' +
      'The inventory is required: it fixes which controls are compared, and their order.'
  );
}

const read = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read the ${what} at ${path}: ${error.message}`);
  }
};

const annotationA = read(aPath, 'first annotation');
const annotationB = read(bPath, 'second annotation');
const inventory = read(invPath, 'inventory');

for (const [file, path] of [[annotationA, aPath], [annotationB, bPath]]) {
  const { valid, problems } = validateAnnotation(file);
  if (!valid) fail(`${path} does not match the frozen annotation schema:`, problems);
}

const { agreement, problems, text, sha256 } = computeAgreement({ annotationA, annotationB, inventory });
if (!agreement) fail('agreement could not be computed:', problems);

writeFileSync(outPath, text);

const show = (name, r) => {
  const value = r.estimable ? r.kappa.toFixed(3) : `not estimable (${r.reason})`;
  const agreement =
    typeof r.percentageAgreement === 'number' ? `${(r.percentageAgreement * 100).toFixed(1)}%` : 'n/a';
  console.log(`  ${name.padEnd(10)} ${value}   agreement ${agreement}   n=${r.counts?.n ?? 0}`);
};

console.log(`annotators: ${agreement.computedFrom.annotatorA}, ${agreement.computedFrom.annotatorB}`);
console.log(`per-rule basis: ${agreement.perRuleBasis}`);
console.log(`  ${agreement.controlsInPerRuleBasis} controls, ${agreement.stageOneDisagreements} stage-one disagreements excluded`);
console.log('');
show('stage one', agreement.stageOne);
for (const [rule, r] of Object.entries(agreement.perRule)) show(rule, r);
show('pooled', agreement.pooled);
console.log('');
console.log(`written: ${outPath}`);
console.log(`sha256:  ${sha256}`);

const under = belowThreshold(agreement);
if (under.length > 0) {
  console.error('');
  console.error(`Below the protocol's ${REQUIRED_KAPPA} threshold, or not estimable:`);
  for (const line of under) console.error(`  - ${line}`);
  console.error('The protocol requires a low held-out figure to be reported, not suppressed.');
  console.error('For calibration, clarify the codebook and repeat with fresh synthetic cases.');
}
