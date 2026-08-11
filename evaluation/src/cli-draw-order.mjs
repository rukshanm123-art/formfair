#!/usr/bin/env node
/**
 * Protocol section 2.
 *
 * By default this **verifies** that the committed order is the one the frame produces,
 * and changes nothing. The order is frozen and tagged; a command that silently rewrote
 * it would be able to re-roll the draw without leaving a trace, which is the one thing
 * this artefact exists to prevent. Pass --write to create it, which is a one-time act.
 *
 *   node src/cli-draw-order.mjs                       verify frame/draw-order.csv
 *   node src/cli-draw-order.mjs --write               create it
 *   node src/cli-draw-order.mjs <frame.csv> <out.csv> explicit paths
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { drawOrder, toCsv, sha256, firstField } from './draw-order.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const paths = args.filter((a) => !a.startsWith('--'));
const [framePath = 'frame/frame.csv', outPath = 'frame/draw-order.csv'] = paths;

if (!existsSync(framePath)) {
  console.error(`no frame at ${framePath}`);
  process.exit(1);
}

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

console.log(`frame:      ${framePath}`);
console.log(`frame hash: ${frameSha}`);
console.log(`agencies:   ${order.length}`);

if (!write) {
  if (!existsSync(outPath)) {
    console.error(`\nno draw order at ${outPath}. Pass --write to create it.`);
    process.exit(1);
  }
  const committed = readFileSync(outPath, 'utf8');
  if (committed !== csv) {
    console.error(`\nMISMATCH: ${outPath} is not what this frame produces.`);
    console.error(`  committed: ${sha256(committed)}`);
    console.error(`  recomputed: ${sha256(csv)}`);
    console.error('The frozen order and the frame disagree. Neither is changed here.');
    process.exit(1);
  }
  console.log(`order hash: ${sha256(csv)}`);
  console.log(`verified:   ${outPath} matches the frame`);
  process.exit(0);
}

writeFileSync(outPath, csv);
console.log(`written:    ${outPath}`);
console.log(`order hash: ${sha256(csv)}`);
