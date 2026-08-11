#!/usr/bin/env node
/** Reads frame.csv, writes draw-order.csv, prints both hashes. Protocol section 2. */

import { readFileSync, writeFileSync } from 'node:fs';
import { drawOrder, toCsv, sha256, firstField } from './draw-order.mjs';

const [framePath = 'data/frame.csv', outPath = 'data/draw-order.csv'] = process.argv.slice(2);

const frameText = readFileSync(framePath, 'utf8');
const frameSha = sha256(frameText);

const rows = frameText
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#'))
  .slice(1)
  .map(firstField)
  .filter(Boolean);

if (rows.length === 0) {
  console.error(`no agencies found in ${framePath}`);
  process.exit(1);
}

const order = drawOrder(rows, frameSha);
const csv = toCsv(order, frameSha);
writeFileSync(outPath, csv);

console.log(`frame:      ${framePath}`);
console.log(`frame hash: ${frameSha}`);
console.log(`agencies:   ${order.length}`);
console.log(`written:    ${outPath}`);
console.log(`order hash: ${sha256(csv)}`);
