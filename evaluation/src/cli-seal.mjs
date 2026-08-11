#!/usr/bin/env node
/** Protocol section 10 gate. Exits non-zero unless the seal holds. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verifySeal } from './seal.mjs';

const manifestPath = process.argv[2] ?? 'data/seal.json';
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`cannot read the seal manifest at ${manifestPath}: ${error.message}`);
  console.error('FormFair must not be run on a held-out page until the seal is in place.');
  process.exit(1);
}

const base = dirname(manifestPath);
const { sealed, failures } = verifySeal(manifest, (p) => resolve(base, p));

if (!sealed) {
  console.error('SEAL NOT VALID. FormFair must not be run on a held-out page.\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('seal valid: annotation, agreement and adjudication are locked.');
console.log('FormFair may now be run once, at evaluation-v1.0.0.');
