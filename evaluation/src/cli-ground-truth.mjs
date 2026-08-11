#!/usr/bin/env node
/**
 * Protocol section 8. Derives the final ground truth from both primary annotations and
 * the adjudication, deterministically.
 *
 *   node src/cli-ground-truth.mjs --a data/annotatorA.json --b data/annotatorB.json \
 *     --adjudication data/adjudication.json --inventory data/inventory.json \
 *     --out data/ground-truth.json
 *
 * Run before sealing. The output is one of the files the pre-run seal covers.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { buildGroundTruth } from './ground-truth.mjs';
import { validateAnnotation, validateAdjudication } from './schema.mjs';

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
const adjPath = flag('--adjudication');
const invPath = flag('--inventory');
const outPath = flag('--out');

if (!aPath || !bPath || !adjPath || !outPath) {
  fail(
    'usage: node src/cli-ground-truth.mjs --a <file> --b <file> --adjudication <file>\n' +
      '         [--inventory <file>] --out <file>'
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
const adjudication = read(adjPath, 'adjudication');
const inventory = invPath ? read(invPath, 'inventory') : null;

for (const [file, path] of [[annotationA, aPath], [annotationB, bPath]]) {
  const { valid, problems } = validateAnnotation(file);
  if (!valid) fail(`${path} does not match the frozen annotation schema:`, problems);
}
const adj = validateAdjudication(adjudication);
if (!adj.valid) fail(`${adjPath} does not match the frozen adjudication schema:`, adj.problems);

const { groundTruth, problems, text, sha256 } = buildGroundTruth({
  annotationA,
  annotationB,
  adjudication,
  inventory,
});
if (!groundTruth) fail('the ground truth could not be derived:', problems);

writeFileSync(outPath, text);

const pages = Object.keys(groundTruth.pages).length;
const controls = Object.values(groundTruth.pages).reduce((n, p) => n + Object.keys(p).length, 0);
const nameControls = Object.values(groundTruth.pages).reduce(
  (n, p) => n + Object.values(p).filter((c) => c.isNameControl).length,
  0
);
console.log(`annotators:     ${groundTruth.derivedFrom.annotatorA}, ${groundTruth.derivedFrom.annotatorB}`);
console.log(`adjudicator:    ${groundTruth.derivedFrom.adjudicator}`);
console.log(`pages:          ${pages}`);
console.log(`controls:       ${controls} (${nameControls} personal-name controls)`);
console.log(`written:        ${outPath}`);
console.log(`sha256:         ${sha256}`);
