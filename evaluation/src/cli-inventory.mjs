#!/usr/bin/env node
/**
 * Protocol section 7. Builds the neutral control inventory from captured pages.
 *
 *   node src/cli-inventory.mjs <captures-dir> --out data/inventory.json
 *
 * The captures directory holds one .html per page, named <pageId>.html. Parsing uses the
 * frozen instrument's own parse5, resolved from FORMFAIR_INSTRUMENT_DIR, so the source
 * positions match the ones the analyser will report.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { buildInventory } from './inventory.mjs';
import { loadInstrument, instrumentDirFromEnv } from './instrument-ref.mjs';

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
const capturesDir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
const outPath = flag('--out');
const synthetic = args.includes('--synthetic');

if (!capturesDir || !outPath) {
  fail('usage: node src/cli-inventory.mjs <captures-dir> --out data/inventory.json [--synthetic]');
}

const instrumentDir = instrumentDirFromEnv();
if (!instrumentDir) {
  fail(
    'FORMFAIR_INSTRUMENT_DIR is not set.\n' +
      'The inventory must be parsed by the frozen instrument\'s parse5, not by whatever\n' +
      'this checkout resolves. Run evaluation/scripts/setup-instrument.sh first.'
  );
}

let instrument;
try {
  instrument = await loadInstrument(instrumentDir);
} catch (error) {
  fail(error.message);
}

const pages = readdirSync(capturesDir).filter((f) => f.endsWith('.html')).sort();
if (pages.length === 0) fail(`no .html captures in ${capturesDir}`);

const inventories = pages.map((file) => {
  const pageId = basename(file, '.html');
  const html = readFileSync(join(capturesDir, file), 'utf8');
  return buildInventory({
    html,
    pageId,
    parseFragment: instrument.parse5.parseFragment,
    parserVersion: instrument.parserVersion,
  });
});

const output = {
  instrument: instrument.tag,
  // Declared here, not only on the command line, because this file is hash-covered by
  // the seal: a synthetic exercise cannot later be passed off as a held-out run, and a
  // held-out inventory cannot be previewed as though it were synthetic.
  ...(synthetic ? { synthetic: true } : {}),
  instrumentCommit: instrument.commit,
  parser: `parse5 ${instrument.parserVersion}`,
  pages: inventories,
};
const text = JSON.stringify(output, null, 2) + '\n';
writeFileSync(outPath, text);

const controls = inventories.reduce((n, i) => n + i.controls.length, 0);
console.log(`instrument: ${instrument.tag} (${instrument.commit.slice(0, 12)})`);
console.log(`pages:      ${inventories.length}`);
console.log(`controls:   ${controls}`);
console.log(`synthetic:  ${synthetic}`);
console.log(`written:    ${outPath}`);
console.log(`sha256:     ${createHash('sha256').update(text).digest('hex')}`);
